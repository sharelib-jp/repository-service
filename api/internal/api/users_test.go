package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/sharelib-jp/repository-service/config"
	"github.com/sharelib-jp/repository-service/internal/catalogstore"
)

func TestUserAndRoleSettings(t *testing.T) {
	store, h := testCatalog(t)
	alice, err := store.ResolveUser(context.Background(), "https://auth.test", "alice", "職員 A")
	if err != nil {
		t.Fatal(err)
	}
	bob, err := store.ResolveUser(context.Background(), "https://auth.test", "bob", "職員 B")
	if err != nil {
		t.Fatal(err)
	}
	var initialRoles struct {
		Items []catalogstore.RoleSetting `json:"items"`
	}
	json.Unmarshal(apiRequest(t, h, "GET", "/api/roles", nil, 200).Body.Bytes(), &initialRoles)
	if len(initialRoles.Items) != 2 || !initialRoles.Items[0].System {
		t.Fatalf("missing system roles: %+v", initialRoles)
	}
	apiRequest(t, h, "POST", "/api/roles", map[string]any{"id": "volunteer", "name": "ボランティア"}, 201)
	apiRequest(t, h, "POST", "/api/roles", map[string]any{"id": "volunteer", "name": "重複"}, 409)
	apiRequest(t, h, "POST", "/api/roles", map[string]any{"id": "ADMIN", "name": "無効"}, 422)
	apiRequest(t, h, "PATCH", "/api/roles/volunteer", map[string]any{"name": "支援員"}, 428)
	apiRequest(t, h, "PATCH", "/api/roles/volunteer", map[string]any{"name": "支援員", "previousName": "ボランティア"}, 200)
	apiRequest(t, h, "PATCH", "/api/roles/volunteer", map[string]any{"name": "古い更新", "previousName": "ボランティア"}, 409)
	var page catalogstore.Page[catalogstore.UserSetting]
	json.Unmarshal(apiRequest(t, h, "GET", "/api/users?q=alice&pageSize=1", nil, 200).Body.Bytes(), &page)
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].Subject != "alice" || page.Items[0].Issuer != "https://auth.test" {
		t.Fatalf("user search: %+v", page)
	}
	var updated catalogstore.UserSetting
	json.Unmarshal(apiRequest(t, h, "PATCH", "/api/users/"+alice.ID, map[string]any{"displayName": "管理者 A", "roles": []string{"volunteer", "admin"}, "updatedAt": alice.UpdatedAt}, 200).Body.Bytes(), &updated)
	if updated.DisplayNameCache != "管理者 A" || len(updated.Roles) != 2 || !updated.UpdatedAt.After(alice.UpdatedAt) {
		t.Fatalf("update failed: %+v", updated)
	}
	apiRequest(t, h, "PATCH", "/api/users/"+alice.ID, map[string]any{"displayName": "古い更新", "updatedAt": alice.UpdatedAt}, 409)
	apiRequest(t, h, "PATCH", "/api/users/"+alice.ID, map[string]any{"displayName": "時刻なし"}, 428)
	apiRequest(t, h, "PATCH", "/api/users/"+alice.ID, map[string]any{"displayName": "保存されない名前", "roles": []string{"missing"}, "updatedAt": updated.UpdatedAt}, 422)
	apiRequest(t, h, "PATCH", "/api/users/"+alice.ID, map[string]any{"roles": []string{"admin", "admin"}, "updatedAt": updated.UpdatedAt}, 422)
	apiRequest(t, h, "PATCH", "/api/users/"+alice.ID, map[string]any{"authSubject": "other", "updatedAt": updated.UpdatedAt}, 400)
	apiRequest(t, h, "PATCH", "/api/users/"+alice.ID, map[string]any{"status": "deleted", "updatedAt": updated.UpdatedAt}, 422)
	apiRequest(t, h, "DELETE", "/api/roles/volunteer?name="+url.QueryEscape("支援員"), nil, 422)
	apiRequest(t, h, "DELETE", "/api/roles/admin?name="+url.QueryEscape("管理者"), nil, 422)
	apiRequest(t, h, "PATCH", "/api/users/"+alice.ID, map[string]any{"status": "suspended", "updatedAt": updated.UpdatedAt}, 422)
	apiRequest(t, h, "PATCH", "/api/users/"+alice.ID, map[string]any{"roles": []string{}, "updatedAt": updated.UpdatedAt}, 422)
	apiRequest(t, h, "PATCH", "/api/users/"+bob.ID, map[string]any{"roles": []string{"admin"}, "updatedAt": bob.UpdatedAt}, 200)
	apiRequest(t, h, "PATCH", "/api/users/"+alice.ID, map[string]any{"status": "suspended", "roles": []string{}, "updatedAt": updated.UpdatedAt}, 200)
	json.Unmarshal(apiRequest(t, h, "GET", "/api/users?status=suspended", nil, 200).Body.Bytes(), &page)
	if page.Total != 1 || page.Items[0].DisplayNameCache != "管理者 A" || len(page.Items[0].Roles) != 0 {
		t.Fatalf("atomic update/filter: %+v", page)
	}
	apiRequest(t, h, "GET", "/api/users?status=deleted", nil, 422)
	apiRequest(t, h, "DELETE", "/api/roles/volunteer", nil, 428)
	apiRequest(t, h, "DELETE", "/api/roles/volunteer?name=stale", nil, 409)
	apiRequest(t, h, "DELETE", "/api/roles/volunteer?name="+url.QueryEscape("支援員"), nil, 204)
	var histories []catalogstore.Change
	if err := store.DB.Where(`"EntityType" IN ?`, []string{"user", "role"}).Find(&histories).Error; err != nil {
		t.Fatal(err)
	}
	if len(histories) != 6 {
		t.Fatalf("expected successful user/role edits only, got %d history events", len(histories))
	}
	var versions int64
	store.DB.Table("repository_schema_migrations").Count(&versions)
	if versions != 4 {
		t.Fatalf("migration versions: %d", versions)
	}
}

func TestUserSettingsRequireAdminForReadsAndWrites(t *testing.T) {
	store, _ := testCatalog(t)
	user, err := store.ResolveUser(context.Background(), "https://auth.test", "editor", "編集者")
	if err != nil {
		t.Fatal(err)
	}
	user.Roles = []string{"editor"}
	conf := &config.Config{OIDC: config.OIDCConfig{Enabled: true}}
	h := NewRouter(conf, Dependencies{Store: store, Authenticate: AuthFunc(func(*http.Request) (catalogstore.User, error) { return user, nil })})
	apiRequest(t, h, "GET", "/api/users", nil, 403)
	apiRequest(t, h, "GET", "/api/roles", nil, 403)
	apiRequest(t, h, "PATCH", "/api/users/"+user.ID, map[string]any{"roles": []string{"admin"}, "updatedAt": user.UpdatedAt}, 403)
	apiRequest(t, h, "POST", "/api/roles", map[string]any{"id": "custom", "name": "分類"}, 403)
	apiRequest(t, h, "PATCH", "/api/roles/editor", map[string]any{"name": "変更", "previousName": "編集者"}, 403)
	apiRequest(t, h, "DELETE", "/api/roles/custom?name=test", nil, 403)
	user.Roles = []string{"admin"}
	apiRequest(t, h, "GET", "/api/users", nil, 200)
	apiRequest(t, h, "POST", "/api/roles", map[string]any{"id": "custom", "name": "分類"}, 201)
	var batch catalogstore.Batch
	if err := store.DB.First(&batch).Error; err != nil {
		t.Fatal(err)
	}
	if batch.ActorID == nil || *batch.ActorID != user.ID {
		t.Fatal("missing authenticated audit actor")
	}
}

func TestConcurrentAdminDemotionsKeepOneAdministrator(t *testing.T) {
	store, h := testCatalog(t)
	users := []catalogstore.User{}
	for _, subject := range []string{"admin-a", "admin-b"} {
		u, err := store.ResolveUser(context.Background(), "https://auth.test", subject, subject)
		if err != nil {
			t.Fatal(err)
		}
		if err := store.DB.Exec("INSERT INTO user_roles(user_id,role_id) VALUES (?,?)", u.ID, "admin").Error; err != nil {
			t.Fatal(err)
		}
		users = append(users, u)
	}
	results := make(chan int, 2)
	for _, user := range users {
		go func(u catalogstore.User) {
			raw, _ := json.Marshal(map[string]any{"roles": []string{}, "updatedAt": u.UpdatedAt})
			r := httptest.NewRequest("PATCH", "/api/users/"+u.ID, bytes.NewReader(raw))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			results <- w.Code
		}(user)
	}
	counts := map[int]int{}
	for range users {
		counts[<-results]++
	}
	if counts[200] != 1 || counts[422] != 1 {
		t.Fatalf("concurrent demotions: %v", counts)
	}
}

func TestUsersWithDatabaseDefaultTimestampsCanBeEdited(t *testing.T) {
	store, h := testCatalog(t)
	id := "00000000-0000-0000-0000-000000000001"
	if err := store.DB.Exec("INSERT INTO users(id,auth_issuer,auth_subject) VALUES (?,?,?)", id, "https://auth.test", "default-timestamp").Error; err != nil {
		t.Fatal(err)
	}
	var page catalogstore.Page[catalogstore.UserSetting]
	json.Unmarshal(apiRequest(t, h, "GET", "/api/users?q=default-timestamp", nil, 200).Body.Bytes(), &page)
	if len(page.Items) != 1 {
		t.Fatal("missing user")
	}
	apiRequest(t, h, "PATCH", "/api/users/"+id, map[string]any{"displayName": "表示名を変更", "updatedAt": page.Items[0].UpdatedAt}, 200)
}
