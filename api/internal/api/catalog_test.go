package api

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sharelib-jp/repository-service/config"
	"github.com/sharelib-jp/repository-service/connectors"
	"github.com/sharelib-jp/repository-service/internal/catalogstore"
	"github.com/sharelib-jp/repository-service/internal/database"
	"github.com/sharelib-jp/repository-service/internal/external"
	"github.com/sharelib-jp/repository-service/migrations"
)

func testCatalog(t *testing.T) (*catalogstore.Store, http.Handler) {
	t.Helper()
	driver := "sqlite"
	dsn := filepath.Join(t.TempDir(), "catalog.db") + "?_foreign_keys=on&_txlock=immediate"
	if postgres := os.Getenv("TEST_CATALOG_POSTGRES_DSN"); postgres != "" {
		driver = "postgres"
		admin, err := database.OpenWithDriver(driver, postgres)
		if err != nil {
			t.Fatal(err)
		}
		schema := "catalog_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		if err := admin.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_ = admin.Exec(`DROP SCHEMA "` + schema + `" CASCADE`).Error
			pool, _ := admin.DB()
			_ = pool.Close()
		})
		dsn = postgres + " search_path=" + schema
	}
	db, err := database.OpenWithDriver(driver, dsn)
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	t.Cleanup(func() { _ = pool.Close() })
	if err := migrations.Apply(db); err != nil {
		t.Fatal(err)
	}
	if err := migrations.Apply(db); err != nil {
		t.Fatal(err)
	}
	store := catalogstore.New(db)
	sources, err := external.Load("", connectors.Files)
	if err != nil {
		t.Fatal(err)
	}
	return store, NewRouter(&config.Config{}, Dependencies{Store: store, External: sources})
}
func apiRequest(t *testing.T, h http.Handler, method, path string, body any, status int) *httptest.ResponseRecorder {
	t.Helper()
	var data []byte
	var err error
	if body != nil {
		data, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	h.ServeHTTP(response, req)
	if response.Code != status {
		t.Fatalf("%s %s: status %d, wanted %d, response %s", method, path, response.Code, status, response.Body.String())
	}
	return response
}
func createFixture(t *testing.T, h http.Handler) catalogstore.Book {
	t.Helper()
	response := apiRequest(t, h, "POST", "/api/books", map[string]any{
		"title": "図書館の本", "authorSummary": "著者, 著", "reference": map[string]any{"ISBN": "9784003101018"}, "otherAttributes": map[string]any{"custom": "value"},
		"authors":   []any{map[string]any{"role": "著", "authority": map[string]any{"title": "著者", "type": "Person"}}},
		"publisher": map[string]any{"title": "出版社", "type": "Organization"},
		"copies":    []any{map[string]any{"managementCode": "A001", "condition": "normal", "loanPolicy": "available"}},
	}, 201)
	var book catalogstore.Book
	if err := json.Unmarshal(response.Body.Bytes(), &book); err != nil {
		t.Fatal(err)
	}
	return book
}
func TestCatalogCRUDAtomicHistory(t *testing.T) {
	store, h := testCatalog(t)
	book := createFixture(t, h)
	if book.ID == "" || book.Version != 1 || len(book.Authors) != 1 || len(book.Copies) != 1 || book.PublisherID == nil {
		t.Fatalf("bad aggregate: %+v", book)
	}
	copyID := book.Copies[0].ID
	apiRequest(t, h, "GET", "/api/books/"+book.ID, nil, 200)
	list := apiRequest(t, h, "GET", "/api/copies?authorId="+book.Authors[0].AuthorityID, nil, 200)
	if !bytes.Contains(list.Body.Bytes(), []byte("A001")) {
		t.Fatal("copy was not found by authority ID")
	}
	apiRequest(t, h, "GET", "/api/copies/lookup?code=A001", nil, 200)
	apiRequest(t, h, "GET", "/api/authorities/author?q=著者", nil, 200)
	apiRequest(t, h, "GET", "/api/authorities/publisher", nil, 200)
	response := apiRequest(t, h, "PATCH", "/api/books/"+book.ID, map[string]any{"version": 1, "title": "変更後", "authorSummary": ""}, 200)
	var updated catalogstore.Book
	_ = json.Unmarshal(response.Body.Bytes(), &updated)
	if updated.Version != 2 || updated.Title != "変更後" || updated.AuthorSummary != "" {
		t.Fatal("partial update or empty string clearing failed")
	}
	apiRequest(t, h, "PATCH", "/api/books/"+book.ID, map[string]any{"version": 1, "title": "stale"}, 409)
	apiRequest(t, h, "PATCH", "/api/books/"+book.ID, map[string]any{"title": "no version"}, 428)
	history := apiRequest(t, h, "GET", "/api/copies/"+copyID+"/history", nil, 200)
	if !bytes.Contains(history.Body.Bytes(), []byte("beforeData")) || !bytes.Contains(history.Body.Bytes(), []byte("変更後")) {
		t.Fatal("missing snapshots")
	}
	apiRequest(t, h, "DELETE", "/api/copies/"+copyID+"?version=1", nil, 204)
	apiRequest(t, h, "GET", "/api/copies/"+copyID, nil, 404)
	apiRequest(t, h, "GET", "/api/copies/"+copyID+"/history", nil, 200)
	apiRequest(t, h, "DELETE", "/api/books/"+book.ID+"?version=2", nil, 204)
	apiRequest(t, h, "GET", "/api/books/"+book.ID, nil, 404)
	saved, err := store.History(context.Background(), "book", book.ID, catalogstore.ListOptions{})
	if err != nil || len(saved.Items) < 3 {
		t.Fatalf("deleted book history lost: %+v %v", saved, err)
	}
}
func TestCatalogRollbackAndConstraints(t *testing.T) {
	store, h := testCatalog(t)
	book := createFixture(t, h)
	var before int64
	store.DB.Model(&catalogstore.Change{}).Count(&before)
	apiRequest(t, h, "PATCH", "/api/books/"+book.ID, map[string]any{"version": 1, "title": "rollback", "copies": []any{map[string]any{"managementCode": "A001"}}}, 409)
	current, err := store.Book(context.Background(), book.ID)
	if err != nil || current.Version != 1 || current.Title != book.Title {
		t.Fatal("book update was not rolled back")
	}
	var after int64
	store.DB.Model(&catalogstore.Change{}).Count(&after)
	if after != before {
		t.Fatal("history update was not rolled back")
	}
	apiRequest(t, h, "PATCH", "/api/copies/"+book.Copies[0].ID, map[string]any{"version": 1, "condition": "invalid"}, 422)
	apiRequest(t, h, "POST", "/api/books", map[string]any{"title": "bad", "firstPublishDate": "2026-99-99", "firstPublishDatePrecision": "exact"}, 422)
	apiRequest(t, h, "POST", "/api/books", map[string]any{"title": "bad", "reference": []any{}}, 422)
	apiRequest(t, h, "GET", "/api/copies?hasLoanHistory=yes", nil, 400)
	apiRequest(t, h, "GET", "/api/books?page=-1", nil, 400)
	for _, name := range []string{"Book", "Copy", "BookAuthor", "AuthorAuthority", "PublisherAuthority", "BookReference", "BookOtherAttribute", "ChangeBatch", "ChangeHistory"} {
		if !store.DB.Migrator().HasTable(name) {
			t.Fatalf("missing schema table %s", name)
		}
	}
	if store.DB.Migrator().HasColumn(&catalogstore.Book{}, "DeletedAt") {
		t.Fatal("unrequested soft-delete column")
	}
}
func TestAuthorityTimestampConcurrency(t *testing.T) {
	_, h := testCatalog(t)
	response := apiRequest(t, h, "POST", "/api/authorities/author", map[string]any{"title": "名前", "type": "Person", "birthDate": "2000", "birthDatePrecision": "year_only", "references": map[string]string{"Wikidata": "Q1"}}, 201)
	var a catalogstore.Authority
	_ = json.Unmarshal(response.Body.Bytes(), &a)
	apiRequest(t, h, "PATCH", "/api/authorities/author/"+a.ID, map[string]any{"title": "別の名前"}, 428)
	apiRequest(t, h, "PATCH", "/api/authorities/author/"+a.ID, map[string]any{"updatedAt": a.UpdatedAt, "title": "更新"}, 200)
	apiRequest(t, h, "PATCH", "/api/authorities/author/"+a.ID, map[string]any{"updatedAt": a.UpdatedAt, "title": "競合"}, 409)
	apiRequest(t, h, "GET", "/api/external/sources", nil, 200)
	apiRequest(t, h, "GET", "/api/external/books?source=unknown&q[isbn]=9784003101018", nil, 404)
	apiRequest(t, h, "GET", "/api/external/books?source=ndl&q[title]=a&q[isbn]=1", nil, 400)
}

func TestProvidedSchemaNullDatesAndAuthorityAliases(t *testing.T) {
	store, h := testCatalog(t)
	response := apiRequest(t, h, "POST", "/api/authorities/author", map[string]any{"title": "作者", "alternativeTitles": []any{map[string]any{"title": "別名", "transcription": "ベツメイ", "language": "ja"}}}, 201)
	var a catalogstore.Authority
	_ = json.Unmarshal(response.Body.Bytes(), &a)
	var row struct {
		Alias string
		Birth *string
	}
	if err := store.DB.Table("AuthorAuthority").Select(`CAST("TitleAlternative" AS TEXT) AS alias, "BirthDate" AS birth`).Where(`"Id" = ?`, a.ID).Scan(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Birth != nil || !strings.Contains(row.Alias, "TitleTranscription") {
		t.Fatalf("schema representation differs: %+v", row)
	}
	for _, col := range []string{"Version", "CreatedBy", "DeletedAt"} {
		if store.DB.Migrator().HasColumn("AuthorAuthority", col) {
			t.Fatalf("unrequested authority column %s", col)
		}
	}
	for _, path := range []string{"/api/book-copies", "/api/author-authorities", "/api/publisher-authorities"} {
		apiRequest(t, h, "GET", path, nil, 404)
	}
}

func TestConcurrentBookUpdatesHaveOneWinner(t *testing.T) {
	_, h := testCatalog(t)
	book := createFixture(t, h)
	results := make(chan int, 2)
	for i := 0; i < 2; i++ {
		go func() {
			body := bytes.NewBufferString(`{"version":1,"title":"concurrent"}`)
			req := httptest.NewRequest("PATCH", "/api/books/"+book.ID, body)
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			results <- w.Code
		}()
	}
	counts := map[int]int{}
	for i := 0; i < 2; i++ {
		counts[<-results]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatalf("concurrent update results: %v", counts)
	}
}

func TestBookVolumePersists(t *testing.T) {
	_, h := testCatalog(t)
	created := apiRequest(t, h, "POST", "/api/books", map[string]any{"title": "書籍", "volume": "2"}, 201)
	var book catalogstore.Book
	if err := json.Unmarshal(created.Body.Bytes(), &book); err != nil {
		t.Fatal(err)
	}
	if book.Volume != "2" {
		t.Fatalf("created volume = %q", book.Volume)
	}
	fetched := apiRequest(t, h, "GET", "/api/books/"+book.ID, nil, 200)
	if err := json.Unmarshal(fetched.Body.Bytes(), &book); err != nil {
		t.Fatal(err)
	}
	if book.Volume != "2" {
		t.Fatalf("persisted volume = %q", book.Volume)
	}
	patched := apiRequest(t, h, "PATCH", "/api/books/"+book.ID, map[string]any{"version": book.Version, "volume": "5.5"}, 200)
	if err := json.Unmarshal(patched.Body.Bytes(), &book); err != nil {
		t.Fatal(err)
	}
	if book.Volume != "5.5" {
		t.Fatalf("updated volume = %q", book.Volume)
	}
}

func TestExternalDetailsValidateSourceAndIdentifier(t *testing.T) {
	_, h := testCatalog(t)
	apiRequest(t, h, "GET", "/api/external/books/ndl/invalid", nil, 400)
	apiRequest(t, h, "GET", "/api/external/books/missing/R100000002-I025363549", nil, 404)
	apiRequest(t, h, "GET", "/api/external/books/cinii/R100000002-I025363549", nil, 404)
}
