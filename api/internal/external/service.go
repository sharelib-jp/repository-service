// Package external maps configured external catalogs to library-owned fields.
package external

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/PaesslerAG/jsonpath"
	"github.com/sharelib-jp/sharelib-book-detail-connector/catalog"
	"github.com/sharelib-jp/sharelib-book-detail-connector/extractor"
	"github.com/sharelib-jp/sharelib-book-detail-connector/mapping"
	"github.com/sharelib-jp/sharelib-book-detail-connector/record"
	"gopkg.in/yaml.v3"
)

var ErrQuery = errors.New("invalid external query")
var ErrSource = errors.New("unknown external source")
var ErrSourceConfiguration = errors.New("external source is not configured")
var ErrRecordNotFound = errors.New("external record was not found")

const maxBody = 8 << 20

type Definition struct {
	Catalog    string `yaml:"catalog"`
	Projection string `yaml:"projection"`
	Detail     string `yaml:"detail"`
}
type Registry struct {
	Sources map[string]map[string]Definition `yaml:"sources"`
}
type Rule struct {
	Field      string   `yaml:"field"`
	Identifier string   `yaml:"identifier"`
	Source     string   `yaml:"source"`
	Mode       string   `yaml:"mode"`
	Separator  string   `yaml:"separator"`
	Transform  []string `yaml:"transform"`
	Constant   any      `yaml:"constant"`
}
type Projection struct {
	Version string          `yaml:"version"`
	Mapping map[string]Rule `yaml:"mapping"`
}
type source struct {
	catalog    record.CatalogDefinition
	projection Projection
	detail     string
}
type Service struct {
	sources map[string]map[string]source
	client  *http.Client
}
type SourceInfo struct {
	Name            string   `json:"name"`
	Resource        string   `json:"resource"`
	Label           string   `json:"label"`
	QueryFields     []string `json:"queryFields"`
	SupportsDetails bool     `json:"supportsDetails,omitempty"`
}
type Result struct {
	Source         string         `json:"source"`
	DetailID       string         `json:"detailId,omitempty"`
	Record         record.Record  `json:"record"`
	Data           map[string]any `json:"data"`
	MappingVersion string         `json:"mappingVersion"`
}
type Page struct {
	Items    []Result `json:"items"`
	Source   string   `json:"source"`
	Page     int      `json:"page"`
	PageSize int      `json:"pageSize"`
}

func Load(filename string, defaults fs.FS) (*Service, error) {
	var registry Registry
	var data []byte
	var err error
	var read func(string) ([]byte, error)
	if filename == "" {
		data, err = fs.ReadFile(defaults, "sources.yaml")
		read = func(name string) ([]byte, error) { return fs.ReadFile(defaults, path.Clean(name)) }
	} else {
		data, err = os.ReadFile(filename)
		base := filepath.Dir(filename)
		read = func(name string) ([]byte, error) { return os.ReadFile(filepath.Join(base, name)) }
	}
	if err != nil {
		return nil, fmt.Errorf("read external sources: %w", err)
	}
	decoder := yaml.NewDecoder(strings.NewReader(string(data)))
	decoder.KnownFields(true)
	if err := decoder.Decode(&registry); err != nil {
		return nil, err
	}
	s := &Service{sources: map[string]map[string]source{}, client: &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 || req.URL.Host != via[0].URL.Host {
			return errors.New("external source redirected to a different host")
		}
		return nil
	}}}
	validName := regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)
	for name, resources := range registry.Sources {
		if !validName.MatchString(name) {
			return nil, fmt.Errorf("invalid source name")
		}
		s.sources[name] = map[string]source{}
		for resource, def := range resources {
			if resource != "books" && resource != "authorities" {
				return nil, fmt.Errorf("invalid external resource %q", resource)
			}
			if def.Detail != "" && ((def.Detail != "cinii" && def.Detail != "ndl") || resource != "books") {
				return nil, fmt.Errorf("unknown detail adapter")
			}
			raw, err := read(def.Catalog)
			if err != nil {
				return nil, err
			}
			var cat record.CatalogDefinition
			if err := yaml.Unmarshal(raw, &cat); err != nil {
				return nil, err
			}
			if err := cat.Validate(); err != nil {
				return nil, err
			}
			if cat.Transport.Method != "" && cat.Transport.Method != "GET" {
				return nil, fmt.Errorf("only GET catalogs are supported")
			}
			raw, err = read(def.Projection)
			if err != nil {
				return nil, err
			}
			var projection Projection
			d := yaml.NewDecoder(strings.NewReader(string(raw)))
			d.KnownFields(true)
			if err := d.Decode(&projection); err != nil {
				return nil, err
			}
			if projection.Version == "" {
				return nil, fmt.Errorf("projection version is required")
			}
			if len(projection.Mapping) == 0 {
				return nil, fmt.Errorf("projection mapping is required")
			}
			if cat.Response.Format == record.ResponseFormatJSON {
				if _, err := jsonpath.New(cat.Records.Path); err != nil {
					return nil, fmt.Errorf("invalid record JSONPath: %w", err)
				}
				paths := []string{}
				for _, rule := range cat.Mapping {
					if len(rule.JSONPath) == 0 {
						return nil, fmt.Errorf("JSON mapping requires json_path")
					}
					paths = append(paths, rule.JSONPath...)
				}
				for _, rule := range cat.Identifiers {
					paths = append(paths, rule.JSONPath...)
				}
				if cat.Records.RecordID != nil {
					paths = append(paths, cat.Records.RecordID.JSONPath...)
				}
				for _, expression := range paths {
					if _, err := jsonpath.New(expression); err != nil {
						return nil, fmt.Errorf("invalid JSONPath: %w", err)
					}
				}
			}
			targets := []string{}
			for target := range projection.Mapping {
				targets = append(targets, target)
			}
			sort.Strings(targets)
			for i := 1; i < len(targets); i++ {
				if strings.HasPrefix(targets[i], targets[i-1]+".") {
					return nil, fmt.Errorf("overlapping projection targets")
				}
			}
			transforms := transformers()
			for target, rule := range projection.Mapping {
				if target == "" || strings.Contains(target, "..") || strings.HasPrefix(target, ".") || strings.HasSuffix(target, ".") {
					return nil, fmt.Errorf("invalid mapping target")
				}
				selectors := 0
				for _, present := range []bool{rule.Field != "", rule.Identifier != "", rule.Source != "", rule.Constant != nil} {
					if present {
						selectors++
					}
				}
				if selectors != 1 {
					return nil, fmt.Errorf("projection requires exactly one value source")
				}
				if rule.Source != "" && rule.Source != "record_id" && rule.Source != "record" {
					return nil, fmt.Errorf("unknown projection source")
				}
				if rule.Mode != "" && rule.Mode != "first" && rule.Mode != "all" && rule.Mode != "join" {
					return nil, fmt.Errorf("invalid projection mode")
				}
				for _, name := range rule.Transform {
					if _, err := transforms.Apply(name, ""); err != nil && strings.Contains(err.Error(), "unknown transformer") {
						return nil, err
					}
				}
			}
			s.sources[name][resource] = source{catalog: cat, projection: projection, detail: def.Detail}
		}
	}
	return s, nil
}
func (s *Service) Sources() []SourceInfo {
	out := []SourceInfo{}
	for name, resources := range s.sources {
		for resource, source := range resources {
			fields := []string{}
			for key := range source.catalog.Search.Fields {
				fields = append(fields, key)
			}
			sort.Strings(fields)
			out = append(out, SourceInfo{Name: name, Resource: resource, Label: source.catalog.Name, QueryFields: fields, SupportsDetails: source.detail == "ndl"})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Resource+out[i].Name < out[j].Resource+out[j].Name })
	return out
}
func (s *Service) Search(ctx context.Context, resource, name string, query map[string]string, page, limit int) (Page, error) {
	out := Page{Items: []Result{}, Source: name, Page: page, PageSize: limit}
	source, ok := s.sources[name][resource]
	if !ok {
		return out, ErrSource
	}
	if page > 1 && (source.catalog.Search.Pagination == nil || source.catalog.Search.Pagination.StartParam == "") {
		return out, fmt.Errorf("%w: source does not support offset pagination", ErrQuery)
	}
	if page < 1 || limit < 1 || limit > 100 {
		return out, ErrQuery
	}
	if len(query) != 1 {
		return out, fmt.Errorf("%w: provide exactly one q[field]", ErrQuery)
	}
	var field, value string
	for field, value = range query {
	}
	if _, ok := source.catalog.Search.Fields[field]; !ok || strings.TrimSpace(value) == "" || len(value) > 1000 || strings.ContainsAny(value, "\x00\r\n") {
		return out, ErrQuery
	}
	// The connector interpolates CQL templates. Escape literals before interpolation.
	if strings.Contains(source.catalog.Search.Fields[field].CQL, `"{value}"`) {
		value = strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(value)
	}
	q := catalog.SearchQuery{Start: (page-1)*limit + 1, Limit: limit}
	switch field {
	case "isbn":
		q.ISBN = value
	case "title":
		q.Title = value
	case "creator":
		q.Creator = value
	case "keyword":
		q.Keyword = value
	default:
		return out, ErrQuery
	}
	if source.detail == "cinii" {
		return s.searchCinii(ctx, source, name, field, value, page, limit)
	}
	params := catalog.BuildSearchParams(source.catalog, q)
	u, err := url.Parse(source.catalog.Transport.BaseURL)
	if err != nil {
		return out, err
	}
	values := u.Query()
	for k, v := range source.catalog.Transport.StaticParams {
		values.Set(k, v)
	}
	for k, v := range params {
		values.Set(k, v)
	}
	u.RawQuery = values.Encode()
	timeout := source.catalog.Transport.Timeout
	if timeout <= 0 || timeout > 12*time.Second {
		timeout = 12 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return out, err
	}
	for k, v := range source.catalog.Transport.Headers {
		req.Header.Set(k, v)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "SharelibRepository/0.1")
	}
	response, err := s.client.Do(req)
	if err != nil {
		if upstream, ok := err.(*url.Error); ok {
			return out, fmt.Errorf("external request: %w", upstream.Err)
		}
		return out, errors.New("external request failed")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return out, fmt.Errorf("external source returned HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxBody+1))
	if err != nil {
		return out, err
	}
	if len(body) > maxBody {
		return out, errors.New("external response exceeds 8 MiB")
	}
	records, err := mapRecords(source.catalog, body, u.String(), resource)
	if err != nil {
		return out, err
	}
	if len(records) > limit {
		records = records[:limit]
	}
	for _, rec := range records {
		publicURL := *u
		publicURL.RawQuery = ""
		publicURL.User = nil
		rec.Source.RequestURL = publicURL.String()
		data, warnings := project(rec, source.projection)
		rec.Warnings = append(rec.Warnings, warnings...)
		item := Result{Source: name, Record: rec, Data: data, MappingVersion: source.projection.Version}
		if source.detail == "ndl" {
			item.DetailID = ndlRecordID(rec.Source.RecordID)
		}
		out.Items = append(out.Items, item)
	}
	return out, nil
}
func transformers() *mapping.TransformerRegistry {
	registry := mapping.NewTransformerRegistry()
	registry.Register("partial_date", func(v string) (string, error) {
		for _, layout := range []string{"2006", "2006-01", "2006-01-02"} {
			if len(v) == len(layout) {
				if _, err := time.Parse(layout, v); err == nil {
					return v, nil
				}
			}
		}
		return "", fmt.Errorf("unrecognized date")
	})
	registry.Register("date_precision", func(v string) (string, error) {
		for layout, precision := range map[string]string{"2006": "year_only", "2006-01": "year_month", "2006-01-02": "exact"} {
			if len(layout) == len(v) {
				if _, err := time.Parse(layout, v); err == nil {
					return precision, nil
				}
			}
		}
		return "", fmt.Errorf("unrecognized date")
	})
	return registry
}

func mapRecords(def record.CatalogDefinition, body []byte, requestURL, resource string) ([]record.Record, error) {
	now := time.Now().UTC()
	out := []record.Record{}
	if def.Response.Format == record.ResponseFormatXML {
		extract := extractor.NewXMLExtractor(def.Namespaces)
		nodes, err := extract.ExtractRecords(body, def.Records.Path)
		if err != nil {
			return nil, err
		}
		mapper := mapping.NewMapper(extract, nil)
		for _, node := range nodes {
			data, err := extract.ExtractRecordData(node, def.Records.DataPath)
			if err != nil {
				return nil, err
			}
			rec, err := mapper.MapRecord(node, data, def, requestURL, now)
			if err != nil {
				return nil, err
			}
			if resource == "authorities" {
				rec.RecordType = "authority"
			}
			if resource == "books" {
				if err := enrichDCNDL(data, &rec); err != nil {
					return nil, err
				}
			}
			out = append(out, rec)
		}
		return out, nil
	}
	var document any
	if err := json.Unmarshal(body, &document); err != nil {
		return nil, err
	}
	nodes, err := jsonpath.Get(def.Records.Path, document)
	if err != nil {
		return nil, err
	}
	items, ok := nodes.([]any)
	if !ok {
		items = []any{nodes}
	}
	transforms := mapping.NewTransformerRegistry()
	structurers := mapping.NewStructurerRegistry()
	for _, node := range items {
		rec := record.Record{SchemaVersion: "1", RecordType: "authority", Fields: record.Fields{}, Source: record.Source{CatalogID: def.ID, CatalogVersion: def.Version, RequestURL: requestURL, RetrievedAt: now}}
		if resource == "books" {
			rec.RecordType = "bibliographic"
		}
		for field, rule := range def.Mapping {
			values, err := jsonValues(node, rule.JSONPath, rule.Transform, transforms)
			if err != nil {
				return nil, err
			}
			if rule.Mode != "all" && len(values) > 1 {
				values = values[:1]
			}
			for _, value := range values {
				var v any = value
				if rule.Parse != "" {
					v, err = structurers.Apply(rule.Parse, value)
					if err != nil {
						return nil, err
					}
				}
				rec.Fields[field] = append(rec.Fields[field], record.Value{Value: v, Lang: rule.Lang, Scheme: rule.Scheme, Qualifier: rule.Qualifier})
			}
			if rule.Required && len(values) == 0 {
				rec.Warnings = append(rec.Warnings, record.Warning{Code: "required_field_missing", Message: "required field was not found", Field: field})
			}
		}
		if def.Records.RecordID != nil {
			values, err := jsonValues(node, def.Records.RecordID.JSONPath, def.Records.RecordID.Transform, transforms)
			if err != nil {
				return nil, err
			}
			if len(values) > 0 {
				rec.Source.RecordID = values[0]
			}
		}
		for name, rule := range def.Identifiers {
			values, err := jsonValues(node, rule.JSONPath, rule.Transform, transforms)
			if err != nil {
				return nil, err
			}
			scheme := rule.Scheme
			if scheme == "" {
				scheme = name
			}
			for _, value := range values {
				rec.Identifiers = append(rec.Identifiers, record.Identifier{Scheme: scheme, Value: value})
			}
		}
		out = append(out, rec)
	}
	return out, nil
}
func jsonValues(node any, paths []string, names []string, registry *mapping.TransformerRegistry) ([]string, error) {
	result := []string{}
	for _, path := range paths {
		value, err := jsonpath.Get(path, node)
		if err != nil {
			continue
		}
		values, ok := value.([]any)
		if !ok {
			values = []any{value}
		}
		for _, v := range values {
			if v == nil {
				continue
			}
			text, ok := v.(string)
			if !ok {
				raw, err := json.Marshal(v)
				if err != nil {
					return nil, err
				}
				text = string(raw)
			}
			for _, name := range names {
				text, err = registry.Apply(name, text)
				if err != nil {
					return nil, err
				}
			}
			if strings.TrimSpace(text) != "" {
				result = append(result, text)
			}
		}
	}
	return result, nil
}
func project(rec record.Record, projection Projection) (map[string]any, []record.Warning) {
	out := map[string]any{}
	warnings := []record.Warning{}
	keys := []string{}
	for target := range projection.Mapping {
		keys = append(keys, target)
	}
	sort.Strings(keys)
	for _, target := range keys {
		rule := projection.Mapping[target]
		values := []any{}
		switch {
		case rule.Field != "":
			for _, v := range rec.Fields[rule.Field] {
				values = append(values, v.Value)
			}
		case rule.Identifier != "":
			for _, v := range rec.Identifiers {
				if v.Scheme == rule.Identifier {
					values = append(values, v.Value)
				}
			}
		case rule.Source == "record_id":
			if rec.Source.RecordID != "" {
				values = append(values, rec.Source.RecordID)
			}
		case rule.Source == "record":
			values = append(values, rec)
		case rule.Constant != nil:
			values = append(values, rule.Constant)
		}
		transformed := []any{}
		for _, value := range values {
			valid := true
			for _, name := range rule.Transform {
				text, ok := value.(string)
				if !ok {
					valid = false
					break
				}
				v, err := transformers().Apply(name, text)
				if err != nil {
					warnings = append(warnings, record.Warning{Code: "projection_failed", Message: err.Error(), Field: target})
					valid = false
					break
				}
				value = v
			}
			if valid {
				transformed = append(transformed, value)
			}
		}
		values = transformed
		if len(values) == 0 {
			continue
		}
		var value any = values[0]
		switch rule.Mode {
		case "all":
			value = values
		case "join":
			texts := []string{}
			for _, v := range values {
				if text, ok := v.(string); ok {
					texts = append(texts, text)
				} else {
					raw, _ := json.Marshal(v)
					texts = append(texts, string(raw))
				}
			}
			separator := rule.Separator
			if separator == "" {
				separator = " ; "
			}
			value = strings.Join(texts, separator)
		}
		node := out
		parts := strings.Split(target, ".")
		for _, part := range parts[:len(parts)-1] {
			child, ok := node[part].(map[string]any)
			if !ok {
				child = map[string]any{}
				node[part] = child
			}
			node = child
		}
		node[parts[len(parts)-1]] = value
	}
	return out, warnings
}
