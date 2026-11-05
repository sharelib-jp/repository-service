package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/sharelib-jp/repository-service/internal/catalogstore"
)

func editorBook(t *testing.T, response []byte) catalogstore.Book {
	t.Helper()
	var book catalogstore.Book
	if err := json.Unmarshal(response, &book); err != nil {
		t.Fatal(err)
	}
	return book
}

func TestBookEditorAggregateUpdateAndDeletion(t *testing.T) {
	_, h := testCatalog(t)
	created := apiRequest(t, h, http.MethodPost, "/api/books", map[string]any{
		"title": "登録した本", "volume": "5.5", "titleTranscription": "トウロクシタホン",
		"authorSummary": "有川, 浩 [著]", "publisherSummary": "出版社", "publisherId": nil,
		"authors":          []any{map[string]any{"role": "著", "position": 1, "authority": map[string]any{"title": "有川, 浩", "type": "Person", "references": map[string]any{"Wikidata": "Q1"}}}},
		"publisher":        map[string]any{"title": "出版社", "type": "Organization"},
		"reference":        map[string]any{"ISBN": "9784003101018", "custom": []any{1, nil}},
		"otherAttributes":  map[string]any{"materialType": "図書", "custom": map[string]any{"edition": "初版"}},
		"firstPublishDate": "2024-02", "firstPublishDatePrecision": "year_month", "language": "ja",
		"copies": []any{map[string]any{"managementCode": "A001", "condition": "normal", "loanPolicy": "available", "deliveredAt": "2026-11-05T12:23:45.123Z"}}, "deletedCopies": []any{},
	}, http.StatusCreated)
	book := editorBook(t, created.Body.Bytes())
	if len(book.Copies) != 1 || len(book.Authors) != 1 || book.Publisher == nil {
		t.Fatalf("incomplete editor data: %+v", book)
	}
	apiRequest(t, h, http.MethodDelete, "/api/books/"+book.ID+"?version=1", nil, http.StatusUnprocessableEntity)
	copy := book.Copies[0]
	author := *book.Authors[0].Authority
	author.Title = "有川, ひろ"
	response := apiRequest(t, h, http.MethodPatch, "/api/books/"+book.ID, map[string]any{
		"version": book.Version, "title": "更新した本", "volume": "6",
		"authors":       []any{map[string]any{"authorityId": author.ID, "authority": author, "role": "著", "position": 1}},
		"authorSummary": "有川, ひろ [著]", "publisher": nil, "publisherId": nil, "publisherSummary": "",
		"copies":    []any{map[string]any{"id": copy.ID, "version": copy.Version, "managementCode": "A001", "condition": "damaged", "loanPolicy": "in_library_only", "deliveredAt": copy.DeliveredAt}, map[string]any{"managementCode": "A002", "condition": "normal", "loanPolicy": "available", "deliveredAt": nil}},
		"reference": map[string]any{"ISBN": "9784003101018", "custom": []any{1, nil}}, "deletedCopies": []any{},
	}, http.StatusOK)
	updated := editorBook(t, response.Body.Bytes())
	if updated.Version != 2 || updated.Volume != "6" || updated.PublisherID != nil || updated.Publisher != nil || len(updated.Copies) != 2 || updated.Authors[0].Authority.Title != "有川, ひろ" {
		t.Fatalf("aggregate update failed: %+v", updated)
	}
	if string(updated.OtherAttributes) != string(book.OtherAttributes) {
		t.Fatal("untouched attributes changed")
	}
	var removals []catalogstore.CopyDeletion
	for _, c := range updated.Copies {
		if c.ManagementCode == "A001" && (c.Version != copy.Version+1 || !c.DeliveredAt.Equal(*copy.DeliveredAt)) {
			t.Fatal("copy version or delivery time changed incorrectly")
		}
		removals = append(removals, catalogstore.CopyDeletion{ID: c.ID, Version: c.Version})
	}
	response = apiRequest(t, h, http.MethodPatch, "/api/books/"+book.ID, map[string]any{"version": updated.Version, "copies": []any{}, "deletedCopies": removals}, http.StatusOK)
	empty := editorBook(t, response.Body.Bytes())
	if len(empty.Copies) != 0 {
		t.Fatal("removed copies were not deleted")
	}
	apiRequest(t, h, http.MethodDelete, "/api/books/"+book.ID+"?version=3", nil, http.StatusNoContent)
	apiRequest(t, h, http.MethodGet, "/api/copies/"+copy.ID+"/history", nil, http.StatusOK)
	apiRequest(t, h, http.MethodGet, "/api/authorities/author/"+author.ID, nil, http.StatusOK)
}

func TestBookEditorStaleCopyAndAuthorityRollBackAllChanges(t *testing.T) {
	store, h := testCatalog(t)
	book := createFixture(t, h)
	oldCopy := book.Copies[0]
	response := apiRequest(t, h, http.MethodPatch, "/api/copies/"+oldCopy.ID, map[string]any{"version": oldCopy.Version, "condition": "lost"}, http.StatusOK)
	var newerCopy catalogstore.Copy
	if err := json.Unmarshal(response.Body.Bytes(), &newerCopy); err != nil {
		t.Fatal(err)
	}
	apiRequest(t, h, http.MethodPatch, "/api/books/"+book.ID, map[string]any{"version": book.Version, "title": "must roll back", "copies": []any{}, "deletedCopies": []catalogstore.CopyDeletion{{ID: oldCopy.ID, Version: oldCopy.Version}}}, http.StatusConflict)
	current, err := store.Book(context.Background(), book.ID)
	if err != nil || current.Version != book.Version || current.Title != book.Title || len(current.Copies) != 1 || current.Copies[0].Condition != "lost" {
		t.Fatalf("stale copy removal changed aggregate: %+v %v", current, err)
	}
	author := *book.Authors[0].Authority
	apiRequest(t, h, http.MethodPatch, "/api/authorities/author/"+author.ID, map[string]any{"updatedAt": author.UpdatedAt, "title": "他画面で更新"}, http.StatusOK)
	author.Title = "stale edit"
	apiRequest(t, h, http.MethodPatch, "/api/books/"+book.ID, map[string]any{"version": book.Version, "title": "must also roll back", "copies": []any{newerCopy}, "authors": []any{map[string]any{"authorityId": author.ID, "authority": author, "role": "著"}}}, http.StatusConflict)
	current, err = store.Book(context.Background(), book.ID)
	if err != nil || current.Title != book.Title || current.Version != book.Version || current.Authors[0].Authority.Title != "他画面で更新" {
		t.Fatalf("stale authority edit changed aggregate: %+v %v", current, err)
	}
	if !current.Copies[0].UpdatedAt.Equal(newerCopy.UpdatedAt) {
		t.Fatal("failed save modified a copy")
	}
}
