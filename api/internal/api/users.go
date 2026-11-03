package api

import (
	"net/http"

	"github.com/sharelib-jp/repository-service/internal/catalogstore"
)

func (a *catalogAPI) administrator(next http.HandlerFunc) http.Handler {
	return a.protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.requireAuth {
			user, ok := r.Context().Value(userKey{}).(catalogstore.User)
			allowed := false
			if ok {
				for _, role := range user.Roles {
					if role == "admin" {
						allowed = true
					}
				}
			}
			if !allowed {
				apiError(w, 403, "forbidden", "ユーザー・ロールの設定には管理者権限が必要です。")
				return
			}
		}
		next(w, r)
	}))
}
func (a *catalogAPI) registerUserSettings(mux *http.ServeMux) {
	mux.Handle("GET /api/users", a.administrator(a.listUsers))
	mux.Handle("PATCH /api/users/{id}", a.administrator(a.updateUser))
	mux.Handle("GET /api/roles", a.administrator(a.listRoles))
	mux.Handle("POST /api/roles", a.administrator(a.createRole))
	mux.Handle("PATCH /api/roles/{id}", a.administrator(a.updateRole))
	mux.Handle("DELETE /api/roles/{id}", a.administrator(a.deleteRole))
}
func (a *catalogAPI) listUsers(w http.ResponseWriter, r *http.Request) {
	opts, ok := listOptions(w, r)
	if !ok {
		return
	}
	opts.Status = r.URL.Query().Get("status")
	result, err := a.Store.Users(r.Context(), opts)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (a *catalogAPI) updateUser(w http.ResponseWriter, r *http.Request) {
	var update catalogstore.UserUpdate
	if !decode(w, r, &update) {
		return
	}
	if update.UpdatedAt.IsZero() {
		apiError(w, 428, "precondition_required", "updatedAt を指定してください。")
		return
	}
	result, err := a.Store.UpdateUser(r.Context(), r.PathValue("id"), update, actorID(r), r.Header.Get("X-Change-Reason"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (a *catalogAPI) listRoles(w http.ResponseWriter, r *http.Request) {
	roles, err := a.Store.Roles(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": roles})
}
func (a *catalogAPI) createRole(w http.ResponseWriter, r *http.Request) {
	var role catalogstore.Role
	if !decode(w, r, &role) {
		return
	}
	result, err := a.Store.SaveRole(r.Context(), role, nil, actorID(r), r.Header.Get("X-Change-Reason"))
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Location", "/api/roles/"+result.ID)
	writeJSON(w, 201, result)
}
func (a *catalogAPI) updateRole(w http.ResponseWriter, r *http.Request) {
	var update struct {
		Name         string  `json:"name"`
		PreviousName *string `json:"previousName"`
	}
	if !decode(w, r, &update) {
		return
	}
	if update.PreviousName == nil {
		apiError(w, 428, "precondition_required", "previousName を指定してください。")
		return
	}
	role := catalogstore.Role{ID: r.PathValue("id"), Name: update.Name}
	result, err := a.Store.SaveRole(r.Context(), role, update.PreviousName, actorID(r), r.Header.Get("X-Change-Reason"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 200, result)
}
func (a *catalogAPI) deleteRole(w http.ResponseWriter, r *http.Request) {
	if !r.URL.Query().Has("name") {
		apiError(w, 428, "precondition_required", "name を指定してください。")
		return
	}
	if err := a.Store.DeleteRole(r.Context(), r.PathValue("id"), r.URL.Query().Get("name"), actorID(r), r.Header.Get("X-Change-Reason")); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, 204, nil)
}
