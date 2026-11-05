package external

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sharelib-jp/sharelib-book-detail-connector/record"
)

// CiNii returns summary search results; bibliography and volume details are in
// a second JSON-LD document. Never follow an arbitrary URL returned upstream.
var ciniiDetailPath = regexp.MustCompile(`^/crid/[0-9]+\.json$`)

var ErrCiNiiChallenge = errors.New("CiNii requires an AWS WAF challenge")
var ErrCiNiiCaptcha = errors.New("CiNii requires an AWS WAF CAPTCHA")

type ciniiSearch struct {
	Items []struct {
		ID      string `json:"@id"`
		SeeAlso struct {
			ID string `json:"@id"`
		} `json:"rdfs:seeAlso"`
	} `json:"items"`
}
type ciniiLiteral struct {
	Value    string `json:"@value"`
	Language string `json:"@language"`
	Type     string `json:"@type"`
}
type ciniiDetail struct {
	ID          string         `json:"@id"`
	Title       []ciniiLiteral `json:"dc:title"`
	Language    string         `json:"dc:language"`
	Date        string         `json:"dc:date"`
	CreatorText string         `json:"dc:creator"`
	Subjects    []string       `json:"dc:subject"`
	Creators    []struct {
		ID    string         `json:"@id"`
		Names []ciniiLiteral `json:"foaf:name"`
		IDs   []ciniiLiteral `json:"personIdentifier"`
	} `json:"creator"`
	Publishers []struct {
		Name string `json:"dc:publisher"`
	} `json:"dcterms:publisher"`
	Identifiers []struct {
		Identifier ciniiLiteral `json:"identifier"`
		Extra      []struct {
			Type  string `json:"type"`
			Value string `json:"value"`
		} `json:"extra"`
	} `json:"productIdentifier"`
}
type ciniiAuthor struct {
	Title         string            `json:"title"`
	Transcription string            `json:"transcription,omitempty"`
	Role          string            `json:"role,omitempty"`
	References    map[string]string `json:"references,omitempty"`
}
type ciniiVolume struct{ ISBN, Volume string }

func (s *Service) ciniiGet(ctx context.Context, target *url.URL, appid string, headers map[string]string, dst any) error {
	u := *target
	q := u.Query()
	q.Set("appid", appid)
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return errors.New("invalid CiNii request")
	}
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	userAgent := os.Getenv("CINII_USER_AGENT")
	if userAgent != "" {
		if len(userAgent) > 512 || strings.TrimSpace(userAgent) == "" {
			return fmt.Errorf("%w: invalid CINII_USER_AGENT", ErrSourceConfiguration)
		}
		for _, c := range userAgent {
			if c < 0x20 || c > 0x7e {
				return fmt.Errorf("%w: invalid CINII_USER_AGENT", ErrSourceConfiguration)
			}
		}
		req.Header.Set("User-Agent", userAgent)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "SharelibRepository/0.1 (+https://github.com/sharelib-jp/repository-service)")
	}
	client := *s.client
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return errors.New("CiNii redirects are not allowed") }
	resp, err := client.Do(req)
	if err != nil {
		if e, ok := err.(*url.Error); ok {
			return fmt.Errorf("CiNii request: %w", e.Err)
		}
		return errors.New("CiNii request failed")
	}
	defer resp.Body.Close()
	action := strings.ToLower(strings.TrimSpace(resp.Header.Get("X-Amzn-Waf-Action")))
	if resp.StatusCode == http.StatusAccepted && action == "challenge" {
		return ErrCiNiiChallenge
	}
	if resp.StatusCode == http.StatusMethodNotAllowed && action == "captcha" {
		return ErrCiNiiCaptcha
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("CiNii returned HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return err
	}
	if len(body) > maxBody {
		return errors.New("CiNii response exceeds 8 MiB")
	}
	if err := json.Unmarshal(body, dst); err != nil {
		return errors.New("invalid CiNii JSON response")
	}
	return nil
}

func (s *Service) searchCinii(ctx context.Context, src source, name, field, value string, page, limit int) (Page, error) {
	out := Page{Items: []Result{}, Source: name, Page: page, PageSize: limit}
	appid := strings.TrimSpace(os.Getenv("CINII_APP_ID"))
	if appid == "" {
		return out, fmt.Errorf("%w: CINII_APP_ID is not set", ErrSourceConfiguration)
	}
	base, err := url.Parse(src.catalog.Transport.BaseURL)
	if err != nil {
		return out, err
	}
	queryURL := *base
	query := queryURL.Query()
	for k, v := range src.catalog.Transport.StaticParams {
		query.Set(k, v)
	}
	param := field
	if field == "keyword" {
		param = "q"
	}
	query.Set(param, value)
	query.Set("start", strconv.Itoa((page-1)*limit+1))
	query.Set("count", strconv.Itoa(limit))
	queryURL.RawQuery = query.Encode()
	timeout := src.catalog.Transport.Timeout
	if timeout <= 0 || timeout > 12*time.Second {
		timeout = 12 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var search ciniiSearch
	if err := s.ciniiGet(ctx, &queryURL, appid, src.catalog.Transport.Headers, &search); err != nil {
		return out, err
	}
	if len(search.Items) > limit {
		search.Items = search.Items[:limit]
	}
	pages := make([][]Result, len(search.Items))
	errs := make([]error, len(search.Items))
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for i, item := range search.Items {
		i, item := i, item
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				errs[i] = ctx.Err()
				return
			}
			defer func() { <-sem }()
			raw := item.SeeAlso.ID
			if raw == "" {
				raw = strings.TrimSuffix(item.ID, "/") + ".json"
			}
			detail, err := url.Parse(raw)
			if err != nil || detail.Scheme != base.Scheme || detail.Host != base.Host || detail.User != nil || detail.RawQuery != "" || detail.Fragment != "" || !ciniiDetailPath.MatchString(detail.Path) {
				errs[i] = errors.New("invalid CiNii detail URL")
				return
			}
			var data ciniiDetail
			if err = s.ciniiGet(ctx, detail, appid, src.catalog.Transport.Headers, &data); err != nil {
				errs[i] = err
				return
			}
			pages[i] = projectCinii(data, src, name, detail, field, value)
		}()
	}
	wg.Wait()
	for i := range pages {
		if errs[i] != nil {
			return out, errs[i]
		}
		out.Items = append(out.Items, pages[i]...)
	}
	return out, nil
}

func normalizeISBN(s string) string {
	return strings.ToUpper(strings.NewReplacer("-", "", " ", "", "　", "").Replace(strings.TrimSpace(s)))
}
func projectCinii(d ciniiDetail, src source, name string, detail *url.URL, field, query string) []Result {
	title, transcription := "", ""
	for _, v := range d.Title {
		if strings.EqualFold(v.Language, "ja-Kana") {
			if transcription == "" {
				transcription = v.Value
			}
		} else if title == "" {
			title = v.Value
		}
	}
	authors := []ciniiAuthor{}
	rec := record.Record{SchemaVersion: "1", RecordType: "bibliographic", Fields: record.Fields{}, Source: record.Source{CatalogID: src.catalog.ID, CatalogVersion: src.catalog.Version, RequestURL: detail.Scheme + "://" + detail.Host + detail.Path, RecordID: detail.Scheme + "://" + detail.Host + detail.Path, RetrievedAt: time.Now().UTC()}}
	for _, c := range d.Creators {
		a := ciniiAuthor{References: map[string]string{}}
		for _, n := range c.Names {
			if strings.EqualFold(n.Language, "ja-Kana") {
				if a.Transcription == "" {
					a.Transcription = n.Value
				}
			} else if a.Title == "" {
				a.Title = n.Value
			}
		}
		if a.Title == "" {
			continue
		}
		a.Role = responsibilityRole(a.Title, d.CreatorText)
		a.Title = catalogName(a.Title)
		a.Transcription = catalogName(a.Transcription)
		for _, id := range c.IDs {
			if id.Type == "CINII_AUTHOR_ID" {
				a.References["CiNiiAuthorID"] = id.Value
			}
		}
		if c.ID != "" {
			a.References["CiNiiResearchURI"] = c.ID
		}
		authors = append(authors, a)
		rec.Fields["creator"] = append(rec.Fields["creator"], record.Value{Value: a.Title})
	}
	rec.Fields["title.main"] = []record.Value{{Value: title}}
	if d.Date != "" {
		rec.Fields["publication.date"] = []record.Value{{Value: d.Date}}
	}
	if d.Language != "" {
		rec.Fields["language"] = []record.Value{{Value: d.Language}}
	}
	for _, p := range d.Publishers {
		if p.Name != "" {
			rec.Fields["publication.publisher"] = append(rec.Fields["publication.publisher"], record.Value{Value: p.Name})
		}
	}
	volumes := []ciniiVolume{}
	ncid := ""
	for _, id := range d.Identifiers {
		switch id.Identifier.Type {
		case "NCID":
			ncid = id.Identifier.Value
		case "ISBN":
			v := ciniiVolume{ISBN: id.Identifier.Value}
			for _, extra := range id.Extra {
				if extra.Type == "title" {
					v.Volume = extra.Value
					break
				}
			}
			volumes = append(volumes, v)
		}
	}
	if field == "isbn" {
		matches := []ciniiVolume{}
		for _, v := range volumes {
			if normalizeISBN(v.ISBN) == normalizeISBN(query) {
				matches = append(matches, v)
			}
		}
		volumes = matches
		if len(volumes) == 0 {
			return nil
		}
	}
	if len(volumes) == 0 {
		volumes = []ciniiVolume{{}}
	}
	results := make([]Result, 0, len(volumes))
	for _, v := range volumes {
		copyRec := rec
		copyRec.Identifiers = nil
		if v.ISBN != "" {
			copyRec.Identifiers = []record.Identifier{{Scheme: "isbn", Value: v.ISBN}}
		}
		data, warnings := project(copyRec, src.projection)
		copyRec.Warnings = append(copyRec.Warnings, warnings...)
		data["titleTranscription"] = transcription
		data["volume"] = v.Volume
		data["authors"] = authors
		summary := make([]string, 0, len(authors))
		readings := make([]string, 0, len(authors))
		for _, author := range authors {
			value := author.Title
			reading := author.Transcription
			if author.Role != "" {
				value += " [" + author.Role + "]"
				if reading != "" {
					reading += " [" + author.Role + "]"
				}
			}
			summary = append(summary, value)
			if reading != "" {
				readings = append(readings, reading)
			}
		}
		if len(summary) > 0 {
			data["authorSummary"] = strings.Join(summary, "; ")
		}
		if len(readings) > 0 {
			data["authorSummaryTranscription"] = strings.Join(readings, "; ")
		}
		refs, _ := data["reference"].(map[string]any)
		if refs == nil {
			refs = map[string]any{}
		}
		delete(refs, "NDLRecordURI")
		refs["CiNiiResearchURI"] = detail.Scheme + "://" + detail.Host + detail.Path
		if ncid != "" {
			refs["NCID"] = ncid
		}
		data["reference"] = refs
		for _, subject := range d.Subjects {
			if i := strings.Index(subject, ":"); i >= 0 && strings.HasPrefix(strings.ToUpper(subject[:i]), "NDC") {
				data["ndc"] = strings.TrimSpace(subject[i+1:])
				break
			}
		}
		results = append(results, Result{Source: name, Record: copyRec, Data: data, MappingVersion: src.projection.Version})
	}
	return results
}
