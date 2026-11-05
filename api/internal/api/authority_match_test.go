package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"

	"github.com/sharelib-jp/repository-service/internal/catalogstore"
)

func createAuthorityForMatch(t *testing.T, h http.Handler, kind, title, qid string) catalogstore.Authority {
	t.Helper()
	response := apiRequest(t, h, "POST", "/api/authorities/"+kind, map[string]any{
		"title": title, "transcription": "カンナイヨミ", "type": "Other", "references": map[string]any{"Wikidata": qid, "Local": "retained"},
	}, 201)
	var a catalogstore.Authority
	if err := json.Unmarshal(response.Body.Bytes(), &a); err != nil {
		t.Fatal(err)
	}
	return a
}

func matchAuthorityRequest(t *testing.T, h http.Handler, kind, title, qid string, status int) *catalogstore.Authority {
	t.Helper()
	params := url.Values{"title": {title}, "wikidata": {qid}}
	response := apiRequest(t, h, "GET", "/api/authorities/"+kind+"/match?"+params.Encode(), nil, status)
	if status != 200 {
		return nil
	}
	var result struct {
		Item *catalogstore.Authority `json:"item"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result.Item
}

func TestAuthorityMatchPrefersExactTitleThenWikidata(t *testing.T) {
	for _, kind := range []string{"author", "publisher"} {
		t.Run(kind, func(t *testing.T) {
			_, h := testCatalog(t)
			first := createAuthorityForMatch(t, h, kind, "館内タイトル", "Q1")
			other := createAuthorityForMatch(t, h, kind, "別表記", "Q12")
			if a := matchAuthorityRequest(t, h, kind, " 館内タイトル ", "Q12", 200); a == nil || a.ID != first.ID {
				t.Fatalf("title did not take priority: %+v", a)
			}
			if a := matchAuthorityRequest(t, h, kind, "外部タイトル", "Q12", 200); a == nil || a.ID != other.ID || !a.UpdatedAt.Equal(other.UpdatedAt) {
				t.Fatalf("Wikidata match lost identity/version: %+v", a)
			}
			if a := matchAuthorityRequest(t, h, kind, "", "Q1", 200); a == nil || a.ID != first.ID {
				t.Fatalf("Q-only match failed: %+v", a)
			}
			if a := matchAuthorityRequest(t, h, kind, "館内", "", 200); a != nil {
				t.Fatal("substring title matched")
			}
			if a := matchAuthorityRequest(t, h, kind, "missing", "Q123", 200); a != nil {
				t.Fatal("substring Q ID matched")
			}
			matchAuthorityRequest(t, h, kind, "", "", 422)
			matchAuthorityRequest(t, h, kind, "title", "Q1;DROP", 422)
			matchAuthorityRequest(t, h, kind, "title", "Q0", 422)
		})
	}
}

func TestAuthorityMatchUsesOnlyWikidataReferenceAndKeepsKindsSeparate(t *testing.T) {
	_, h := testCatalog(t)
	createAuthorityForMatch(t, h, "author", "共通名", "Q1")
	if a := matchAuthorityRequest(t, h, "publisher", "共通名", "Q1", 200); a != nil {
		t.Fatal("author was used as a publisher")
	}
	apiRequest(t, h, "POST", "/api/authorities/author", map[string]any{"title": "unrelated", "references": map[string]any{"NDL": "Q123", "Wikidata": []string{"Q123"}}}, 201)
	if a := matchAuthorityRequest(t, h, "author", "missing", "Q123", 200); a != nil {
		t.Fatal("wrong reference key/type matched")
	}
	response := apiRequest(t, h, "POST", "/api/authorities/author", map[string]any{"title": "lower-key", "references": map[string]any{"wikidata": "Q999"}}, 201)
	var lower catalogstore.Authority
	_ = json.Unmarshal(response.Body.Bytes(), &lower)
	if a := matchAuthorityRequest(t, h, "author", "missing", "Q999", 200); a == nil || a.ID != lower.ID {
		t.Fatal("lowercase Wikidata key was missed")
	}
}

func TestBookImportReusesLibraryAuthorityWithoutOverwritingIt(t *testing.T) {
	store, h := testCatalog(t)
	author := createAuthorityForMatch(t, h, "author", "館内著者", "Q1")
	publisher := createAuthorityForMatch(t, h, "publisher", "館内出版社", "Q2")
	response := apiRequest(t, h, "POST", "/api/books", map[string]any{
		"title": "本", "authorSummary": "外部著者 [絵]", "publisherSummary": "外部出版社",
		"authors":   []any{map[string]any{"role": "絵", "authority": map[string]any{"title": "外部著者", "type": "Person", "transcription": "ソト", "references": map[string]any{"Wikidata": "Q1", "Other": "not merged"}}}},
		"publisher": map[string]any{"title": "館内出版社", "type": "Organization", "references": map[string]any{"Wikidata": "Q999"}},
	}, 201)
	book := editorBook(t, response.Body.Bytes())
	if len(book.Authors) != 1 || book.Authors[0].AuthorityID != author.ID || book.PublisherID == nil || *book.PublisherID != publisher.ID {
		t.Fatalf("library IDs not reused: %+v", book)
	}
	if book.AuthorSummary != "館内著者 [絵]" || book.AuthorSummaryTranscription != "カンナイヨミ [絵]" || book.PublisherSummary != publisher.Title {
		t.Fatal("summaries did not use library data")
	}
	if !book.Authors[0].Authority.UpdatedAt.Equal(author.UpdatedAt) || !book.Publisher.UpdatedAt.Equal(publisher.UpdatedAt) || string(book.Authors[0].Authority.References) != string(author.References) || book.Authors[0].Authority.Type != author.Type {
		t.Fatal("import overwrote shared library authority data")
	}
	for _, table := range []string{"AuthorAuthority", "PublisherAuthority"} {
		var count int64
		if err := store.DB.Table(table).Count(&count).Error; err != nil || count != 1 {
			t.Fatalf("duplicate authority in %s: %d %v", table, count, err)
		}
	}
	// ID-based edits still use optimistic concurrency and may intentionally change a title.
	apiRequest(t, h, "PATCH", "/api/authorities/publisher/"+publisher.ID, map[string]any{"updatedAt": publisher.UpdatedAt, "title": "更新後出版社"}, 200)
	list := apiRequest(t, h, "GET", "/api/authorities/publisher?q="+url.QueryEscape("更新後"), nil, 200)
	var page catalogstore.Page[catalogstore.Authority]
	if err := json.Unmarshal(list.Body.Bytes(), &page); err != nil || page.Total != 1 || page.Items[0].ID != publisher.ID {
		t.Fatal("publisher list/edit integration failed")
	}
}

func TestAmbiguousAuthorityRequiresExplicitLibrarySelection(t *testing.T) {
	store, h := testCatalog(t)
	a := createAuthorityForMatch(t, h, "author", "同名", "Q1")
	createAuthorityForMatch(t, h, "author", "同名", "Q2")
	matchAuthorityRequest(t, h, "author", "同名", "Q1", 409)
	createAuthorityForMatch(t, h, "author", "別名", "Q1")
	matchAuthorityRequest(t, h, "author", "none", "Q1", 409)
	apiRequest(t, h, "POST", "/api/books", map[string]any{"title": "blocked", "authors": []any{map[string]any{"role": "著", "authority": map[string]any{"title": "同名"}}}}, 409)
	var count int64
	store.DB.Model(&catalogstore.Book{}).Count(&count)
	if count != 0 {
		t.Fatal("ambiguous import was partially saved")
	}
	apiRequest(t, h, "POST", "/api/books", map[string]any{"title": "chosen", "authors": []any{map[string]any{"role": "著", "authorityId": a.ID}}}, 201)
}
