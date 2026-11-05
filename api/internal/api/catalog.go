package api

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"reflect"
	"strconv"
	"strings"

	"github.com/sharelib-jp/repository-service/internal/catalogstore"
	"github.com/sharelib-jp/repository-service/internal/external"
)

type Dependencies struct {
	Store        *catalogstore.Store
	External     *external.Service
	Authenticate Authenticator
	BrowserAuth  *BrowserAuth
}
type catalogAPI struct {
	Dependencies
	requireAuth bool
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if status != http.StatusNoContent {
		if err := json.NewEncoder(w).Encode(value); err != nil {
			log.Printf("encode API response: %v", err)
		}
	}
}
func apiError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
func fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, catalogstore.ErrNotFound):
		apiError(w, 404, "not_found", "指定されたデータが見つかりません。")
	case errors.Is(err, catalogstore.ErrAmbiguousAuthority):
		apiError(w, 409, "ambiguous_authority", "一致する館内典拠が複数あります。館内検索から利用する典拠を選択してください。")
	case errors.Is(err, catalogstore.ErrConflict):
		apiError(w, 409, "conflict", "データが更新されたか、識別子がすでに登録されています。再取得してください。")
	case errors.Is(err, catalogstore.ErrInvalid):
		apiError(w, 422, "invalid_record", err.Error())
	default:
		log.Printf("catalog API: %v", err)
		apiError(w, 500, "internal_error", "処理を完了できませんでした。")
	}
}
func decode(w http.ResponseWriter, r *http.Request, dest any) bool {
	mediaType, _, mediaError := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaError != nil || mediaType != "application/json" {
		apiError(w, 415, "unsupported_media_type", "application/json を指定してください。")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(dest); err != nil {
		apiError(w, 400, "invalid_json", "JSON の形式または項目を確認してください。")
		return false
	}
	if err := d.Decode(new(any)); err != io.EOF {
		apiError(w, 400, "invalid_json", "JSON オブジェクトは１件だけ指定してください。")
		return false
	}
	return true
}
func patchBody(w http.ResponseWriter, r *http.Request, dest any, required string) (map[string]json.RawMessage, bool) {
	var fields map[string]json.RawMessage
	if !decode(w, r, &fields) {
		return nil, false
	}
	if fields == nil {
		apiError(w, 400, "invalid_json", "JSON オブジェクトを指定してください。")
		return nil, false
	}
	if _, ok := fields[required]; !ok {
		apiError(w, 428, "precondition_required", required+" を指定してください。")
		return nil, false
	}
	current, err := json.Marshal(dest)
	if err != nil {
		fail(w, err)
		return nil, false
	}
	var merged map[string]json.RawMessage
	if err := json.Unmarshal(current, &merged); err != nil {
		fail(w, err)
		return nil, false
	}
	for key, value := range fields {
		merged[key] = value
	}
	raw, err := json.Marshal(merged)
	if err != nil {
		fail(w, err)
		return nil, false
	}
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	fresh := reflect.New(reflect.ValueOf(dest).Elem().Type())
	if err := d.Decode(fresh.Interface()); err != nil {
		apiError(w, 400, "invalid_json", "JSON の項目を確認してください。")
		return nil, false
	}
	reflect.ValueOf(dest).Elem().Set(fresh.Elem())
	return fields, true
}
func listOptions(w http.ResponseWriter, r *http.Request) (catalogstore.ListOptions, bool) {
	q := r.URL.Query()
	o := catalogstore.ListOptions{Query: q.Get("q"), AuthorID: q.Get("authorId"), Status: q.Get("condition"), Page: 1, PageSize: 20}
	if len(o.Query) > 1000 {
		apiError(w, 400, "invalid_query", "検索語が長すぎます。")
		return o, false
	}
	for key, dest := range map[string]*int{"page": &o.Page, "pageSize": &o.PageSize} {
		if value := q.Get(key); value != "" {
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 || (key == "pageSize" && n > 100) || n > 100000 {
				apiError(w, 400, "invalid_pagination", "ページ指定を確認してください。")
				return o, false
			}
			*dest = n
		}
	}
	if q.Has("hasLoanHistory") || q.Has("loanHistory") {
		apiError(w, 400, "unsupported_filter", "貸出履歴による検索はまだ利用できません。")
		return o, false
	}
	return o, true
}
func deleteVersion(w http.ResponseWriter, r *http.Request) (int64, bool) {
	v, err := strconv.ParseInt(r.URL.Query().Get("version"), 10, 64)
	if err != nil || v < 1 {
		apiError(w, 428, "precondition_required", "version を指定してください。")
		return 0, false
	}
	return v, true
}

func (a *catalogAPI) register(mux *http.ServeMux) {
	a.registerUserSettings(mux)
	handle := func(pattern string, h http.HandlerFunc) { mux.Handle(pattern, a.protect(h)) }
	mux.Handle("GET /api/me", a.authenticate(http.HandlerFunc(a.me)))
	handle("GET /api/books", a.listBooks)
	handle("POST /api/books", a.createBook)
	handle("GET /api/books/{id}", a.getBook)
	handle("PATCH /api/books/{id}", a.updateBook)
	handle("DELETE /api/books/{id}", a.deleteBook)
	handle("GET /api/books/{id}/history", a.bookHistory)
	handle("GET /api/copies", a.listCopies)
	handle("POST /api/copies", a.createCopy)
	handle("GET /api/copies/lookup", a.lookupCopy)
	handle("GET /api/copies/lookup/history", a.historyByCode)
	handle("GET /api/copies/{id}", a.getCopy)
	handle("PATCH /api/copies/{id}", a.updateCopy)
	handle("DELETE /api/copies/{id}", a.deleteCopy)
	handle("GET /api/copies/{id}/history", a.copyHistory)
	for _, kind := range []string{"author", "publisher"} {
		base := "/api/authorities/" + kind
		handle("GET "+base, func(w http.ResponseWriter, r *http.Request) {
			o, ok := listOptions(w, r)
			if !ok {
				return
			}
			v, err := a.Store.Authorities(r.Context(), kind, o)
			if err != nil {
				fail(w, err)
				return
			}
			writeJSON(w, 200, v)
		})
		handle("GET "+base+"/match", func(w http.ResponseWriter, r *http.Request) {
			v, err := a.Store.MatchAuthority(r.Context(), kind, r.URL.Query().Get("title"), r.URL.Query().Get("wikidata"))
			if err != nil {
				fail(w, err)
				return
			}
			writeJSON(w, 200, map[string]any{"item": v})
		})
		handle("GET "+base+"/{id}", func(w http.ResponseWriter, r *http.Request) {
			v, err := a.Store.Authority(r.Context(), kind, r.PathValue("id"))
			if err != nil {
				fail(w, err)
				return
			}
			writeJSON(w, 200, v)
		})
		handle("POST "+base, func(w http.ResponseWriter, r *http.Request) {
			var v catalogstore.Authority
			if !decode(w, r, &v) {
				return
			}
			if v.ID != "" {
				apiError(w, 422, "invalid_record", "新規典拠の ID はサーバーで採番します。")
				return
			}
			result, err := a.Store.SaveAuthority(r.Context(), kind, v, actorID(r), r.Header.Get("X-Change-Reason"))
			if err != nil {
				fail(w, err)
				return
			}
			w.Header().Set("Location", base+"/"+result.ID)
			writeJSON(w, 201, result)
		})
		handle("PATCH "+base+"/{id}", func(w http.ResponseWriter, r *http.Request) {
			v, err := a.Store.Authority(r.Context(), kind, r.PathValue("id"))
			if err != nil {
				fail(w, err)
				return
			}
			if _, ok := patchBody(w, r, &v, "updatedAt"); !ok {
				return
			}
			if v.ID != r.PathValue("id") {
				apiError(w, 422, "invalid_id", "ID は変更できません。")
				return
			}
			result, err := a.Store.SaveAuthority(r.Context(), kind, v, actorID(r), r.Header.Get("X-Change-Reason"))
			if err != nil {
				fail(w, err)
				return
			}
			writeJSON(w, 200, result)
		})
	}
	handle("GET /api/external/sources", a.externalSources)
	handle("GET /api/external/books", a.externalSearch)
	handle("GET /api/external/authorities", a.externalSearch)
}
func (a *catalogAPI) listBooks(w http.ResponseWriter, r *http.Request) {
	o, ok := listOptions(w, r)
	if !ok {
		return
	}
	v, err := a.Store.Books(r.Context(), o)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, v)
}
func (a *catalogAPI) getBook(w http.ResponseWriter, r *http.Request) {
	v, err := a.Store.Book(r.Context(), r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, v)
}
func (a *catalogAPI) createBook(w http.ResponseWriter, r *http.Request) {
	var b catalogstore.Book
	if !decode(w, r, &b) {
		return
	}
	if b.ID != "" {
		apiError(w, 422, "invalid_id", "新規書誌の ID はサーバーで採番します。")
		return
	}
	v, err := a.Store.SaveBook(r.Context(), b, actorID(r), r.Header.Get("X-Change-Reason"))
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Location", "/api/books/"+v.ID)
	writeJSON(w, 201, v)
}
func (a *catalogAPI) updateBook(w http.ResponseWriter, r *http.Request) {
	b, err := a.Store.Book(r.Context(), r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	fields, ok := patchBody(w, r, &b, "version")
	if !ok {
		return
	}
	if b.ID != r.PathValue("id") {
		apiError(w, 422, "invalid_id", "ID は変更できません。")
		return
	}
	if _, ok := fields["publisherId"]; ok {
		if _, nested := fields["publisher"]; !nested {
			b.Publisher = nil
		}
	}
	v, err := a.Store.SaveBook(r.Context(), b, actorID(r), r.Header.Get("X-Change-Reason"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, v)
}
func (a *catalogAPI) deleteBook(w http.ResponseWriter, r *http.Request) {
	version, ok := deleteVersion(w, r)
	if !ok {
		return
	}
	if err := a.Store.DeleteBook(r.Context(), r.PathValue("id"), version, actorID(r), r.Header.Get("X-Change-Reason")); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 204, nil)
}
func (a *catalogAPI) listCopies(w http.ResponseWriter, r *http.Request) {
	o, ok := listOptions(w, r)
	if !ok {
		return
	}
	v, err := a.Store.Copies(r.Context(), o)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, v)
}
func (a *catalogAPI) getCopy(w http.ResponseWriter, r *http.Request) {
	v, err := a.Store.Copy(r.Context(), r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, v)
}
func (a *catalogAPI) lookupCopy(w http.ResponseWriter, r *http.Request) {
	v, err := a.Store.CopyByCode(r.Context(), r.URL.Query().Get("code"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, v)
}
func (a *catalogAPI) createCopy(w http.ResponseWriter, r *http.Request) {
	var c catalogstore.Copy
	if !decode(w, r, &c) {
		return
	}
	if c.ID != "" {
		apiError(w, 422, "invalid_id", "新規蔵書の ID はサーバーで採番します。")
		return
	}
	v, err := a.Store.SaveCopy(r.Context(), c, actorID(r), r.Header.Get("X-Change-Reason"))
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Location", "/api/copies/"+v.ID)
	writeJSON(w, 201, v)
}
func (a *catalogAPI) updateCopy(w http.ResponseWriter, r *http.Request) {
	c, err := a.Store.Copy(r.Context(), r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	if _, ok := patchBody(w, r, &c, "version"); !ok {
		return
	}
	if c.ID != r.PathValue("id") {
		apiError(w, 422, "invalid_id", "ID は変更できません。")
		return
	}
	v, err := a.Store.SaveCopy(r.Context(), c, actorID(r), r.Header.Get("X-Change-Reason"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, v)
}
func (a *catalogAPI) deleteCopy(w http.ResponseWriter, r *http.Request) {
	version, ok := deleteVersion(w, r)
	if !ok {
		return
	}
	if err := a.Store.DeleteCopy(r.Context(), r.PathValue("id"), version, actorID(r), r.Header.Get("X-Change-Reason")); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 204, nil)
}
func (a *catalogAPI) history(w http.ResponseWriter, r *http.Request, kind, id string) {
	o, ok := listOptions(w, r)
	if !ok {
		return
	}
	v, err := a.Store.History(r.Context(), kind, id, o)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, v)
}
func (a *catalogAPI) copyHistory(w http.ResponseWriter, r *http.Request) {
	a.history(w, r, "copy", r.PathValue("id"))
}
func (a *catalogAPI) bookHistory(w http.ResponseWriter, r *http.Request) {
	a.history(w, r, "book", r.PathValue("id"))
}
func (a *catalogAPI) historyByCode(w http.ResponseWriter, r *http.Request) {
	v, err := a.Store.CopyByCode(r.Context(), r.URL.Query().Get("code"))
	if err != nil {
		fail(w, err)
		return
	}
	a.history(w, r, "copy", v.ID)
}
func (a *catalogAPI) externalSources(w http.ResponseWriter, r *http.Request) {
	if a.External == nil {
		apiError(w, 503, "external_unavailable", "外部ソースが設定されていません。")
		return
	}
	items := a.External.Sources()
	if resource := r.URL.Query().Get("resource"); resource != "" {
		filtered := []external.SourceInfo{}
		for _, item := range items {
			if item.Resource == resource {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
func (a *catalogAPI) externalSearch(w http.ResponseWriter, r *http.Request) {
	if a.External == nil {
		apiError(w, 503, "external_unavailable", "外部ソースが設定されていません。")
		return
	}
	o, ok := listOptions(w, r)
	if !ok {
		return
	}
	values := r.URL.Query()
	query := map[string]string{}
	for key, list := range values {
		if strings.HasPrefix(key, "q[") && strings.HasSuffix(key, "]") {
			if len(list) != 1 {
				apiError(w, 400, "invalid_query", "検索条件の重複はできません。")
				return
			}
			query[strings.TrimSuffix(strings.TrimPrefix(key, "q["), "]")] = list[0]
		}
	}
	resource := strings.TrimPrefix(r.URL.Path, "/api/external/")
	page, err := a.External.Search(r.Context(), resource, values.Get("source"), query, o.Page, o.PageSize)
	if err != nil {
		switch {
		case errors.Is(err, external.ErrSource):
			apiError(w, 404, "source_not_found", "対応する外部ソースがありません。")
		case errors.Is(err, external.ErrQuery):
			apiError(w, 400, "invalid_query", "source と対応する q[項目名] を指定してください。")
		default:
			log.Printf("external search: %v", err)
			apiError(w, 502, "external_error", "外部ソースから情報を取得できませんでした。")
		}
		return
	}
	writeJSON(w, 200, page)
}
