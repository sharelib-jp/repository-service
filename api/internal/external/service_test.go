package external

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/sharelib-jp/repository-service/connectors"
)

func TestConfiguredXMLMapping(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("query") != `isbn="9784003101018"` {
			t.Errorf("query = %q", r.URL.Query().Get("query"))
		}
		fmt.Fprint(w, `<srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/"><srw:records><srw:record><srw:recordData><resource xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><dc:title> 本の名前 </dc:title><dc:creator>著者 著</dc:creator><dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/ISBN">9784003101018</dcterms:identifier></resource></srw:recordData></srw:record></srw:records></srw:searchRetrieveResponse>`)
	}))
	defer server.Close()
	catalog, _ := connectors.Files.ReadFile("ndl-books.yaml")
	projection, _ := connectors.Files.ReadFile("book-fields.yaml")
	fs := fstest.MapFS{"sources.yaml": {Data: []byte("sources:\n  custom:\n    books: {catalog: catalog.yaml, projection: fields.yaml}\n")}, "catalog.yaml": {Data: []byte(strings.Replace(string(catalog), "https://ndlsearch.ndl.go.jp/api/sru", server.URL, 1))}, "fields.yaml": {Data: projection}}
	service, err := Load("", fs)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.Search(context.Background(), "books", "custom", map[string]string{"isbn": "9784003101018"}, 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 1 || result.Items[0].Data["title"] != "本の名前" {
		t.Fatalf("wrong projection: %#v", result)
	}
	reference := result.Items[0].Data["reference"].(map[string]any)
	if reference["ISBN"] != "9784003101018" {
		t.Fatalf("identifiers were not mapped: %#v", reference)
	}
	if result.Items[0].Record.Fields["title.main"][0].Value != "本の名前" {
		t.Fatal("portable connector record was lost")
	}
}
func TestConfiguredJSONMappingIsNotProviderSpecific(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("search") != "writer" {
			t.Error("query missing")
		}
		fmt.Fprint(w, `{"search":[{"id":"Q123","label":"作者","description":"説明"}]}`)
	}))
	defer server.Close()
	catalog, _ := connectors.Files.ReadFile("wikidata-authorities.yaml")
	fs := fstest.MapFS{"sources.yaml": {Data: []byte("sources:\n  independent:\n    authorities: {catalog: catalog.yaml, projection: fields.yaml}\n")}, "catalog.yaml": {Data: []byte(strings.Replace(string(catalog), "https://www.wikidata.org/w/api.php", server.URL, 1))}, "fields.yaml": {Data: []byte("version: '2'\nmapping:\n  title: {field: authority.title}\n  references.LocalIdentifier: {source: record_id}\n  extra: {field: authority.description}\n")}}
	service, err := Load("", fs)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.Search(context.Background(), "authorities", "independent", map[string]string{"keyword": "writer"}, 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	data := result.Items[0].Data
	if data["title"] != "作者" || data["extra"] != "説明" || data["references"].(map[string]any)["LocalIdentifier"] != "Q123" {
		t.Fatalf("custom mapping not respected: %#v", data)
	}
	if result.Items[0].MappingVersion != "2" {
		t.Fatal("mapping version missing")
	}
}
func TestInvalidQueriesDoNotReachUpstream(t *testing.T) {
	service, err := Load("", connectors.Files)
	if err != nil {
		t.Fatal(err)
	}
	for _, query := range []map[string]string{{}, {"isbn": "1", "title": "2"}, {"url": "https://example.com"}, {"isbn": ""}} {
		if _, err := service.Search(context.Background(), "books", "ndl", query, 1, 20); err == nil {
			t.Fatal("bad query accepted")
		}
	}
	if _, err := service.Search(context.Background(), "books", "https://internal", map[string]string{"isbn": "1"}, 1, 20); err != ErrSource {
		t.Fatal("source is not allowlisted")
	}
}
