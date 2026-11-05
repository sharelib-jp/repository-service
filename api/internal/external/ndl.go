package external

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/antchfx/xmlquery"
	"github.com/antchfx/xpath"
	"github.com/sharelib-jp/sharelib-book-detail-connector/record"
)

var ndlIDPattern = regexp.MustCompile(`^R[0-9]{9}-I[A-Za-z0-9._-]{1,160}$`)
var ndlClassification = regexp.MustCompile(`^https?://id\.ndl\.go\.jp/class/ndc([0-9]+)/([^/?#]+)$`)
var headingDates = regexp.MustCompile(`,\s*[0-9]{4}-(?:[0-9]{4})?\s*$`)
var dcndlNamespaces = map[string]string{
	"n": "http://ndl.go.jp/dcndl/terms/", "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
	"dc": "http://purl.org/dc/elements/1.1/", "d": "http://purl.org/dc/terms/",
	"f": "http://xmlns.com/foaf/0.1/", "r": "http://www.w3.org/2000/01/rdf-schema#",
	"o": "http://www.openarchives.org/OAI/2.0/",
}

func ndlRecordID(raw string) string {
	if ndlIDPattern.MatchString(raw) {
		return raw
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() != "ndlsearch.ndl.go.jp" || u.User != nil || u.RawQuery != "" {
		return ""
	}
	id := strings.TrimPrefix(u.Path, "/books/")
	if ndlIDPattern.MatchString(id) {
		return id
	}
	return ""
}

// Details resolves a validated provider identifier against the configured NDL
// origin. URLs supplied by callers are never used as request targets.
func (s *Service) Details(ctx context.Context, name, id string) (Result, error) {
	src, ok := s.sources[name]["books"]
	if !ok || src.detail != "ndl" {
		return Result{}, ErrSource
	}
	if !ndlIDPattern.MatchString(id) {
		return Result{}, ErrQuery
	}
	target, err := url.Parse(src.catalog.Transport.BaseURL)
	if err != nil {
		return Result{}, err
	}
	target.Path = "/api/oaipmh"
	target.RawPath = ""
	target.Fragment = ""
	target.RawQuery = url.Values{"verb": {"GetRecord"}, "metadataPrefix": {"dcndl_v3"}, "identifier": {"oai:ndlsearch.ndl.go.jp:" + id}}.Encode()
	timeout := src.catalog.Transport.Timeout
	if timeout <= 0 || timeout > 12*time.Second {
		timeout = 12 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return Result{}, err
	}
	for key, value := range src.catalog.Transport.Headers {
		req.Header.Set(key, value)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "SharelibRepository/0.1")
	}
	client := *s.client
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return errors.New("NDL detail redirects are not allowed") }
	resp, err := client.Do(req)
	if err != nil {
		if e, ok := err.(*url.Error); ok {
			return Result{}, fmt.Errorf("NDL request: %w", e.Err)
		}
		return Result{}, errors.New("NDL request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Result{}, fmt.Errorf("NDL returned HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return Result{}, err
	}
	if len(body) > maxBody {
		return Result{}, errors.New("NDL response exceeds 8 MiB")
	}
	doc, err := xmlquery.Parse(strings.NewReader(string(body)))
	if err != nil {
		return Result{}, err
	}
	reader := dcndlReader{}
	for _, node := range reader.all(doc, "//o:error") {
		if node.SelectAttr("code") == "idDoesNotExist" {
			return Result{}, ErrRecordNotFound
		}
		return Result{}, errors.New("NDL could not return this DC-NDL record")
	}
	for _, node := range reader.all(doc, "//o:GetRecord/o:record/o:header") {
		if node.SelectAttr("status") == "deleted" {
			return Result{}, ErrRecordNotFound
		}
	}
	if reader.err != nil {
		return Result{}, reader.err
	}
	records, err := mapRecords(src.catalog, body, target.Scheme+"://"+target.Host+target.Path, "books")
	if err != nil {
		return Result{}, err
	}
	if len(records) != 1 {
		return Result{}, ErrRecordNotFound
	}
	rec := records[0]
	if ndlRecordID(rec.Source.RecordID) != id {
		return Result{}, errors.New("NDL returned an unexpected record identifier")
	}
	data, warnings := project(rec, src.projection)
	rec.Warnings = append(rec.Warnings, warnings...)
	return Result{Source: name, DetailID: id, Record: rec, Data: data, MappingVersion: src.projection.Version}, nil
}

type dcndlReader struct{ err error }

func (r *dcndlReader) all(node *xmlquery.Node, expression string) []*xmlquery.Node {
	if r.err != nil {
		return nil
	}
	expr, err := xpath.CompileWithNS(expression, dcndlNamespaces)
	if err != nil {
		r.err = err
		return nil
	}
	return xmlquery.QuerySelectorAll(node, expr)
}
func (r *dcndlReader) text(node *xmlquery.Node, expression string) string {
	for _, n := range r.all(node, expression) {
		if text := strings.TrimSpace(n.InnerText()); text != "" {
			return text
		}
	}
	return ""
}

type ndlAuthor struct {
	Title         string            `json:"title"`
	Transcription string            `json:"transcription,omitempty"`
	Role          string            `json:"role,omitempty"`
	References    map[string]string `json:"references,omitempty"`
}

// DC-NDL's structured agents retain the association between name, reading,
// role and authority URI. BibResource is deliberately separate from Item.
func enrichDCNDL(root *xmlquery.Node, rec *record.Record) error {
	r := dcndlReader{}
	bibs := r.all(root, ".//n:BibResource")
	if len(bibs) == 0 {
		return r.err
	}
	bib := bibs[0]
	if id := r.text(root, ".//n:BibAdminResource/@rdf:about"); id != "" {
		rec.Source.RecordID = id
	}
	statements := []string{}
	for _, node := range r.all(bib, "./dc:creator") {
		if v := strings.TrimSpace(node.InnerText()); v != "" {
			statements = append(statements, v)
		}
	}
	statement := strings.Join(statements, " ; ")
	authors := []record.Value{}
	summaries := []record.Value{}
	readings := []record.Value{}
	headings := []record.Value{}
	for _, agent := range r.all(bib, "./d:creator/f:Agent") {
		heading := r.text(agent, "./f:name")
		if heading == "" {
			continue
		}
		author := ndlAuthor{Title: catalogName(headingDates.ReplaceAllString(heading, "")), Transcription: catalogName(r.text(agent, "./n:transcription")), References: map[string]string{}}
		role := r.text(agent, "./n:role")
		switch role {
		case "著者", "著":
			author.Role = "著"
		case "編者", "編":
			author.Role = "編"
		case "訳者", "翻訳者", "訳":
			author.Role = "訳"
		case "イラストレーター", "画家", "絵", "画":
			author.Role = "絵"
		default:
			author.Role = role
		}
		if author.Role == "" {
			author.Role = responsibilityRole(author.Title, statement)
		}
		for _, uri := range r.all(agent, "./r:seeAlso/@rdf:resource | ./@rdf:about") {
			u, err := url.Parse(strings.TrimSpace(uri.InnerText()))
			if err != nil || u.Hostname() != "id.ndl.go.jp" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
				continue
			}
			id := strings.TrimPrefix(u.Path, "/auth/entity/")
			if id == u.Path || id == "" || strings.ContainsAny(id, "/?#") {
				continue
			}
			author.References["NDLAuthorityID"] = id
			author.References["NDLAuthorityURI"] = u.String()
			break
		}
		authors = append(authors, record.Value{Value: author})
		headings = append(headings, record.Value{Value: heading})
		name := author.Title
		reading := author.Transcription
		if author.Role != "" {
			name += " [" + author.Role + "]"
			if reading != "" {
				reading += " [" + author.Role + "]"
			}
		}
		summaries = append(summaries, record.Value{Value: name})
		if reading != "" {
			readings = append(readings, record.Value{Value: reading})
		}
	}
	if len(authors) > 0 {
		rec.Fields["creator.authority"] = authors
		rec.Fields["creator.heading"] = headings
		rec.Fields["creator"] = summaries
		rec.Fields["creator.transcription"] = readings
	}
	if len(statements) > 0 {
		values := []record.Value{}
		for _, v := range statements {
			values = append(values, record.Value{Value: v})
		}
		rec.Fields["creator.statement"] = values
	}
	publishers := []record.Value{}
	publisherReadings := []record.Value{}
	for _, agent := range r.all(bib, "./d:publisher/f:Agent") {
		if name := r.text(agent, "./f:name"); name != "" {
			publishers = append(publishers, record.Value{Value: name})
		}
		if reading := r.text(agent, "./n:transcription"); reading != "" {
			publisherReadings = append(publisherReadings, record.Value{Value: reading})
		}
	}
	if len(publishers) > 0 {
		rec.Fields["publication.publisher"] = publishers
	}
	if len(publisherReadings) > 0 {
		rec.Fields["publication.publisherTranscription"] = publisherReadings
	}
	best := -1
	for _, uri := range r.all(bib, "./d:subject/@rdf:resource") {
		parts := ndlClassification.FindStringSubmatch(uri.InnerText())
		if len(parts) != 3 {
			continue
		}
		edition, _ := strconv.Atoi(parts[1])
		if edition < best {
			continue
		}
		best = edition
		rec.Fields["classification.ndc"] = []record.Value{{Value: parts[2]}}
		rec.Fields["classification.ndcEdition"] = []record.Value{{Value: parts[1]}}
	}
	return r.err
}
