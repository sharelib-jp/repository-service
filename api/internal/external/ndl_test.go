package external

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/sharelib-jp/repository-service/connectors"
	"github.com/sharelib-jp/sharelib-book-detail-connector/record"
	"gopkg.in/yaml.v3"
)

const ndlFixture = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcndl="http://ndl.go.jp/dcndl/terms/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:foaf="http://xmlns.com/foaf/0.1/" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#">
<dcndl:BibAdminResource rdf:about="https://ndlsearch.ndl.go.jp/books/R100000002-I025363549"/>
<dcndl:BibResource rdf:about="https://ndlsearch.ndl.go.jp/books/R100000002-I025363549#material">
 <dcterms:title>資料のタイトル</dcterms:title>
 <dc:title><rdf:Description><rdf:value>資料のタイトル</rdf:value><dcndl:transcription>シリョウ ノ タイトル</dcndl:transcription></rdf:Description></dc:title>
 <dcndl:volume><rdf:Description><rdf:value>2</rdf:value></rdf:Description></dcndl:volume>
 <dcterms:creator><foaf:Agent><foaf:name>有川, 浩</foaf:name><dcndl:transcription>アリカワ, ヒロ</dcndl:transcription><dcndl:role>著者</dcndl:role><rdfs:seeAlso rdf:resource="http://id.ndl.go.jp/auth/entity/00123456"/></foaf:Agent></dcterms:creator>
 <dcterms:creator><foaf:Agent><foaf:name>徒花, スクモ</foaf:name><dcndl:transcription>アダバナ, スクモ</dcndl:transcription><dcndl:role>イラストレーター</dcndl:role></foaf:Agent></dcterms:creator>
 <dc:creator>有川浩 [著] ; 徒花スクモ [絵]</dc:creator>
 <dcterms:publisher><foaf:Agent><foaf:name>出版者</foaf:name><dcndl:transcription>シュッパンシャ</dcndl:transcription></foaf:Agent></dcterms:publisher>
 <dcterms:subject rdf:resource="http://id.ndl.go.jp/class/ndc9/913.6"/>
 <dcterms:language>jpn</dcterms:language><dcterms:issued>2014</dcterms:issued>
 <dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/ISBN">978-4-04-866487-5</dcterms:identifier>
 <dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/NDLBibID">025363549</dcterms:identifier>
 <dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/TOHANMARCNO">33077501</dcterms:identifier>
 <dcterms:identifier rdf:datatype="http://ndl.go.jp/dcndl/terms/JPNO">22390166</dcterms:identifier>
</dcndl:BibResource>
<dcndl:Item><dcterms:publisher><foaf:Agent><foaf:name>個体の提供元</foaf:name></foaf:Agent></dcterms:publisher><dc:creator>個体の寄与者</dc:creator></dcndl:Item>
</rdf:RDF>`

func testNDLService(t *testing.T, base string) *Service {
	t.Helper()
	cat, _ := connectors.Files.ReadFile("ndl-books.yaml")
	projection, _ := connectors.Files.ReadFile("book-fields.yaml")
	fs := fstest.MapFS{"sources.yaml": {Data: []byte("sources:\n  library:\n    books: {catalog: catalog.yaml, projection: fields.yaml, detail: ndl}\n")}, "catalog.yaml": {Data: []byte(strings.Replace(string(cat), "https://ndlsearch.ndl.go.jp/api/sru", base+"/api/sru", 1))}, "fields.yaml": {Data: projection}}
	service, err := Load("", fs)
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func TestNDLSRUAndOAIShareDCNDLMapping(t *testing.T) {
	calls := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.URL.Path)
		switch r.URL.Path {
		case "/api/sru":
			if r.URL.Query().Get("recordSchema") != "dcndl_v3" || r.URL.Query().Get("recordPacking") != "xml" {
				t.Error("DC-NDL v3 XML not requested")
			}
			fmt.Fprintf(w, `<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/"><records><record><recordData>%s</recordData></record></records></searchRetrieveResponse>`, ndlFixture)
		case "/api/oaipmh":
			q := r.URL.Query()
			if q.Get("verb") != "GetRecord" || q.Get("metadataPrefix") != "dcndl_v3" || q.Get("identifier") != "oai:ndlsearch.ndl.go.jp:R100000002-I025363549" {
				t.Error("incorrect GetRecord request")
			}
			fmt.Fprintf(w, `<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/"><GetRecord><record><metadata>%s</metadata></record></GetRecord></OAI-PMH>`, ndlFixture)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	service := testNDLService(t, server.URL)
	page, err := service.Search(context.Background(), "books", "library", map[string]string{"isbn": "9784048664875"}, 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("items=%d", len(page.Items))
	}
	item := page.Items[0]
	if item.DetailID != "R100000002-I025363549" {
		t.Fatalf("detail ID=%s", item.DetailID)
	}
	if len(calls) != 1 {
		t.Fatal("search eagerly fetched details")
	}
	detail, err := service.Details(context.Background(), "library", item.DetailID)
	if err != nil {
		t.Fatal(err)
	}
	if len(calls) != 2 {
		t.Fatal("expected exactly one detail request")
	}
	for _, result := range []Result{item, detail} {
		if result.Data["titleTranscription"] != "シリョウ ノ タイトル" || result.Data["volume"] != "2" || result.Data["ndc"] != "913.6" || result.Data["ndcEdition"] != "9" {
			t.Fatalf("wrong fields: %#v", result.Data)
		}
		if result.Data["authorSummary"] != "有川, 浩 [著]; 徒花, スクモ [絵]" {
			t.Fatalf("summary=%v", result.Data["authorSummary"])
		}
		if result.Data["publisherSummary"] != "出版者" || result.Data["publisherSummaryTranscription"] != "シュッパンシャ" {
			t.Fatal("publisher mapping included Item data")
		}
		authors := result.Data["authors"].([]any)
		a := authors[0].(ndlAuthor)
		if a.Title != "有川, 浩" || a.References["NDLAuthorityID"] != "00123456" || a.Transcription != "アリカワ, ヒロ" {
			t.Fatalf("wrong authority: %+v", a)
		}
		refs := result.Data["reference"].(map[string]any)
		if refs["NDLBIBID"] != "025363549" || refs["TOHANMARCNO"] != "33077501" || refs["JPNO"] != "22390166" {
			t.Fatalf("wrong identifiers: %#v", refs)
		}
	}
	if _, err := service.Details(context.Background(), "library", "http://localhost/private"); !errors.Is(err, ErrQuery) {
		t.Fatalf("unsafe identifier accepted: %v", err)
	}
	if len(calls) != 2 {
		t.Fatal("invalid identifier caused an HTTP request")
	}
}

func TestNDLUnavailableOrWrongRecord(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		notFound   bool
	}{
		{"missing", `<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/"><error code="idDoesNotExist">missing</error></OAI-PMH>`, true},
		{"deleted", `<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/"><GetRecord><record><header status="deleted"/></record></GetRecord></OAI-PMH>`, true},
		{"mismatch", `<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/"><GetRecord><record><metadata>` + strings.ReplaceAll(ndlFixture, "I025363549", "I999999999") + `</metadata></record></GetRecord></OAI-PMH>`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, tc.body) }))
			defer server.Close()
			s := testNDLService(t, server.URL)
			_, err := s.Details(context.Background(), "library", "R100000002-I025363549")
			if err == nil {
				t.Fatal("expected error")
			}
			if tc.notFound && !errors.Is(err, ErrRecordNotFound) {
				t.Fatalf("wrong error %v", err)
			}
		})
	}
}

func TestNDLLive(t *testing.T) {
	if os.Getenv("NDL_LIVE_TEST") == "" {
		t.Skip("set NDL_LIVE_TEST to query NDL")
	}
	s, err := Load("", connectors.Files)
	if err != nil {
		t.Fatal(err)
	}
	page, err := s.Search(context.Background(), "books", "ndl", map[string]string{"isbn": "9784048664875"}, 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) == 0 || page.Items[0].DetailID == "" {
		t.Fatal("no identifiable search results")
	}
	d, err := s.Details(context.Background(), "ndl", page.Items[0].DetailID)
	if err != nil {
		t.Fatal(err)
	}
	if d.Data["title"] != page.Items[0].Data["title"] {
		t.Fatal("title mismatch")
	}
	if d.Data["titleTranscription"] == nil || d.Data["authors"] == nil || d.Data["reference"].(map[string]any)["NDLBIBID"] == nil {
		t.Fatalf("missing detailed fields: %#v", d.Data)
	}
}

func TestNDLAuthorityHeadingDatesAndLiteralRoles(t *testing.T) {
	catBytes, err := connectors.Files.ReadFile("ndl-books.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var cat record.CatalogDefinition
	if err := yaml.Unmarshal(catBytes, &cat); err != nil {
		t.Fatal(err)
	}
	rdf := strings.Replace(ndlFixture, "<foaf:name>有川, 浩</foaf:name>", "<foaf:name>有川, 浩, 1972-</foaf:name>", 1)
	rdf = strings.Replace(rdf, "<dcndl:role>著者</dcndl:role>", "", 1)
	xml := `<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/"><records><record><recordData>` + rdf + `</recordData></record></records></searchRetrieveResponse>`
	records, err := mapRecords(cat, []byte(xml), "https://ndlsearch.ndl.go.jp/api/sru", "books")
	if err != nil {
		t.Fatal(err)
	}
	a := records[0].Fields["creator.authority"][0].Value.(ndlAuthor)
	if a.Title != "有川, 浩" || a.Role != "著" {
		t.Fatalf("wrong heading or role: %+v", a)
	}
}
