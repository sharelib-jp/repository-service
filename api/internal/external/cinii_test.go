package external

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/sharelib-jp/repository-service/connectors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"testing/fstest"
)

func TestCiNiiSearchFetchesDetailsAndPreservesVolumes(t *testing.T) {
	t.Setenv("CINII_APP_ID", "test-app-id")
	t.Setenv("CINII_USER_AGENT", "")
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") != "SharelibRepository/0.1 (+https://github.com/sharelib-jp/repository-service)" || r.Header.Get("Accept") != "application/ld+json, application/json" {
			t.Errorf("unexpected request headers on %s", r.URL.Path)
		}
		if r.URL.Query().Get("appid") != "test-app-id" {
			t.Errorf("missing application ID")
		}
		switch r.URL.Path {
		case "/opensearch/v2/books":
			if r.URL.Query().Get("dataSourceType") != "NACSIS_CAT" || r.URL.Query().Get("format") != "json" || r.URL.Query().Get("count") != "20" {
				t.Error("incorrect search parameters")
			}
			fmt.Fprintf(w, `{"items":[{"rdfs:seeAlso":{"@id":%q}}]}`, upstream.URL+"/crid/12345.json")
		case "/crid/12345.json":
			fmt.Fprint(w, `{"dc:title":[{"@language":"ja","@value":"さくら荘"},{"@language":"ja-Kana","@value":"サクラソウ"}],"dc:date":"2010","dc:creator":"鴨志田一 [著] ; 溝口ケージイラスト","creator":[{"@id":"https://cir.nii.ac.jp/crid/1","personIdentifier":[{"@type":"CINII_AUTHOR_ID","@value":"DA1"}],"foaf:name":[{"@value":"鴨志田, 一"},{"@language":"ja-Kana","@value":"カモシダ, ハジメ"}]},{"foaf:name":[{"@value":"溝口, ケージ"}]}],"productIdentifier":[{"identifier":{"@type":"NCID","@value":"BB123"}},{"identifier":{"@type":"ISBN","@value":"9784048682800"},"extra":[{"type":"title","value":"[1]"}]},{"identifier":{"@type":"ISBN","@value":"9784048684637"},"extra":[{"type":"title","value":"2"}]}]}`)
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	service := testCiniiService(t, upstream.URL)
	result, err := service.Search(context.Background(), "books", "cinii", map[string]string{"isbn": "9784048684637"}, 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 1 {
		t.Fatalf("items = %d", len(result.Items))
	}
	data := result.Items[0].Data
	if data["title"] != "さくら荘" || data["titleTranscription"] != "サクラソウ" || data["volume"] != "2" {
		t.Fatalf("wrong mapped fields: %#v", data)
	}
	refs := data["reference"].(map[string]any)
	if refs["ISBN"] != "9784048684637" || refs["NCID"] != "BB123" {
		t.Fatalf("wrong reference: %#v", refs)
	}
	authors := data["authors"].([]ciniiAuthor)
	if len(authors) != 2 || authors[0].Role != "著" || authors[1].Role != "絵" || authors[0].Transcription != "カモシダ, ハジメ" {
		t.Fatalf("wrong authors: %#v", authors)
	}
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), "test-app-id") {
		t.Fatal("application ID leaked")
	}
	result, err = service.Search(context.Background(), "books", "cinii", map[string]string{"title": "さくら荘"}, 1, 20)
	if err != nil || len(result.Items) != 2 {
		t.Fatalf("title search should return both volumes: %#v %v", result, err)
	}
	result, err = service.Search(context.Background(), "books", "cinii", map[string]string{"isbn": "9780000000000"}, 1, 20)
	if err != nil || len(result.Items) != 0 {
		t.Fatalf("unmatched ISBN should not select a volume: %#v %v", result, err)
	}
}

func testCiniiService(t *testing.T, base string) *Service {
	t.Helper()
	catalog, _ := connectors.Files.ReadFile("cinii-books.yaml")
	projection, _ := connectors.Files.ReadFile("book-fields.yaml")
	fs := fstest.MapFS{"sources.yaml": {Data: []byte("sources:\n  cinii:\n    books: {catalog: catalog.yaml, projection: fields.yaml, detail: cinii}\n")}, "catalog.yaml": {Data: []byte(strings.Replace(string(catalog), "https://cir.nii.ac.jp", base, 1))}, "fields.yaml": {Data: projection}}
	service, err := Load("", fs)
	if err != nil {
		t.Fatal(err)
	}
	return service
}
func TestCiNiiRejectsExternalDetailURLs(t *testing.T) {
	t.Setenv("CINII_APP_ID", "test-app-id")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"items":[{"rdfs:seeAlso":{"@id":"http://127.0.0.1:1/crid/123.json"}}]}`)
	}))
	defer upstream.Close()
	service := testCiniiService(t, upstream.URL)
	if _, err := service.Search(context.Background(), "books", "cinii", map[string]string{"isbn": "1"}, 1, 20); err == nil {
		t.Fatal("unsafe detail URL was accepted")
	}
}

func TestCiNiiLive(t *testing.T) {
	if os.Getenv("CINII_LIVE_TEST") == "" {
		t.Skip("set CINII_LIVE_TEST and CINII_APP_ID to query CiNii")
	}
	service, err := Load("", connectors.Files)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ isbn, volume string }{{"9784048664875", ""}, {"9784048684637", "2"}} {
		t.Run(tc.isbn, func(t *testing.T) {
			result, err := service.Search(context.Background(), "books", "cinii", map[string]string{"isbn": tc.isbn}, 1, 20)
			if err != nil {
				t.Fatal(err)
			}
			if len(result.Items) == 0 {
				t.Fatal("no results")
			}
			if result.Items[0].Data["volume"] != tc.volume {
				t.Fatalf("unexpected volume: %v", result.Items[0].Data["volume"])
			}
		})
	}
}

func TestCiNiiUserAgentOverrideAndInvalidValue(t *testing.T) {
	t.Setenv("CINII_APP_ID", "test-app-id")
	t.Setenv("CINII_USER_AGENT", "LibrarySearch/1.0 (+https://example.org/contact)")
	paths := make(chan string, 2)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") != "LibrarySearch/1.0 (+https://example.org/contact)" {
			t.Errorf("unexpected user agent on %s", r.URL.Path)
		}
		paths <- r.URL.Path
		if r.URL.Path == "/opensearch/v2/books" {
			fmt.Fprintf(w, `{"items":[{"rdfs:seeAlso":{"@id":%q}}]}`, server.URL+"/crid/123.json")
			return
		}
		fmt.Fprint(w, `{"dc:title":[{"@value":"title"}],"productIdentifier":[{"identifier":{"@type":"ISBN","@value":"123"}}]}`)
	}))
	defer server.Close()
	service := testCiniiService(t, server.URL)
	if _, err := service.Search(context.Background(), "books", "cinii", map[string]string{"isbn": "123"}, 1, 20); err != nil {
		t.Fatal(err)
	}
	if len(paths) != 2 {
		t.Fatalf("expected search and detail requests, got %d", len(paths))
	}
	t.Setenv("CINII_USER_AGENT", "bad\r\nheader")
	if _, err := service.Search(context.Background(), "books", "cinii", map[string]string{"isbn": "123"}, 1, 20); !errors.Is(err, ErrSourceConfiguration) {
		t.Fatalf("invalid user agent should fail configuration: %v", err)
	}
}

func TestCiNiiWAFResponses(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		action string
		want   error
	}{
		{"challenge", http.StatusAccepted, "challenge", ErrCiNiiChallenge},
		{"captcha", http.StatusMethodNotAllowed, "captcha", ErrCiNiiCaptcha},
		{"ordinary 202", http.StatusAccepted, "", nil},
		{"ordinary 405", http.StatusMethodNotAllowed, "", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tc.action != "" {
					w.Header().Set("X-Amzn-Waf-Action", tc.action)
				}
				w.WriteHeader(tc.status)
			}))
			defer server.Close()
			target, err := url.Parse(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			service := testCiniiService(t, server.URL)
			err = service.ciniiGet(context.Background(), target, "secret", nil, new(any))
			if err == nil {
				t.Fatal("expected error")
			}
			if tc.want != nil && !errors.Is(err, tc.want) {
				t.Fatalf("unexpected error: %v", err)
			}
			if tc.want == nil && (errors.Is(err, ErrCiNiiChallenge) || errors.Is(err, ErrCiNiiCaptcha)) {
				t.Fatalf("incorrect WAF classification: %v", err)
			}
		})
	}
}
