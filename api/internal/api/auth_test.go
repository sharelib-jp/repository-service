package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sharelib-jp/repository-service/config"
	"github.com/sharelib-jp/repository-service/internal/catalogstore"
)

func TestCatalogAuthIsFailClosed(t *testing.T) {
	store, _ := testCatalog(t)
	conf := &config.Config{OIDC: config.OIDCConfig{Enabled: true}}
	h := NewRouter(conf, Dependencies{Store: store})
	apiRequest(t, h, "GET", "/api/books", nil, 503)
	user, err := store.ResolveUser(context.Background(), "https://auth.example", "subject", "")
	if err != nil {
		t.Fatal(err)
	}
	h = NewRouter(conf, Dependencies{Store: store, Authenticate: AuthFunc(func(*http.Request) (catalogstore.User, error) { return user, nil })})
	apiRequest(t, h, "GET", "/api/books", nil, 403)
	apiRequest(t, h, "GET", "/api/me", nil, 200)
	apiRequest(t, h, "POST", "/api/books", map[string]any{"title": "no access"}, 403)
	h = NewRouter(conf, Dependencies{Store: store, Authenticate: AuthFunc(func(*http.Request) (catalogstore.User, error) { return catalogstore.User{}, errUnauthenticated })})
	apiRequest(t, h, "GET", "/api/me", nil, 401)
	user.Status = "suspended"
	h = NewRouter(conf, Dependencies{Store: store, Authenticate: AuthFunc(func(*http.Request) (catalogstore.User, error) { return user, nil })})
	apiRequest(t, h, "GET", "/api/me", nil, 403)
}
func TestCatalogActorComesFromAuthentication(t *testing.T) {
	store, _ := testCatalog(t)
	user, err := store.ResolveUser(context.Background(), "https://auth.example", "subject", "職員")
	if err != nil {
		t.Fatal(err)
	}
	user.Roles = []string{"admin"}
	h := NewRouter(&config.Config{OIDC: config.OIDCConfig{Enabled: true}}, Dependencies{Store: store, Authenticate: AuthFunc(func(*http.Request) (catalogstore.User, error) { return user, nil })})
	response := apiRequest(t, h, "POST", "/api/books", map[string]any{"title": "本", "createdBy": "00000000-0000-0000-0000-000000000001"}, 201)
	_ = response
	var batch catalogstore.Batch
	if err := store.DB.First(&batch).Error; err != nil {
		t.Fatal(err)
	}
	if batch.ActorID == nil || *batch.ActorID != user.ID || batch.ActorDisplayName != "職員" {
		t.Fatal("actor was not derived from authenticated identity")
	}
	missing := httptest.NewRecorder()
	h = NewRouter(&config.Config{OIDC: config.OIDCConfig{Enabled: true}}, Dependencies{Store: store, Authenticate: AuthFunc(func(*http.Request) (catalogstore.User, error) { return catalogstore.User{}, errUnauthenticated })})
	h.ServeHTTP(missing, httptest.NewRequest("GET", "/api/books", nil))
	if missing.Header().Get("WWW-Authenticate") == "" {
		t.Fatal("missing bearer challenge")
	}
}

func TestResourceIntrospectionValidatesAudienceIssuerAndExpiry(t *testing.T) {
	store, _ := testCatalog(t)
	var mode atomic.Int32
	secret := strings.Repeat("s", 32)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, password, ok := r.BasicAuth()
		if !ok || id != "resource-credential" || password != secret {
			t.Error("wrong resource authentication")
		}
		if err := r.ParseForm(); err != nil || r.Form.Get("token") != "access-token" {
			t.Error("missing introspection token")
		}
		aud := "https://repository.test/api"
		issuer := "https://auth.test"
		expires := time.Now().Add(time.Minute).Unix()
		switch mode.Load() {
		case 1:
			aud = "wrong-resource"
		case 2:
			issuer = "https://other.test"
		case 3:
			expires = 1
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"active": true, "sub": "subject", "iss": issuer, "aud": []string{aud}, "exp": expires})
	}))
	defer server.Close()
	t.Setenv("TEST_RESOURCE_SECRET", secret)
	conf := &config.Config{OIDC: config.OIDCConfig{Enabled: true, Issuer: "https://auth.test"}, APIAuth: config.APIAuthConfig{IntrospectionURL: strings.Replace(server.URL, "127.0.0.1", "localhost", 1), Audience: "https://repository.test/api", CredentialID: "resource-credential", SecretEnv: "TEST_RESOURCE_SECRET"}}
	auth, err := NewAuthenticator(conf, store)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("GET", "/api/me", nil)
	request.Header.Set("Authorization", "Bearer access-token")
	user, err := auth.Authenticate(request)
	if err != nil || user.ID == "" {
		t.Fatalf("valid token rejected: %v", err)
	}
	for _, value := range []int32{1, 2, 3} {
		mode.Store(value)
		if _, err := auth.Authenticate(request); !errors.Is(err, errUnauthenticated) {
			t.Fatalf("invalid claims accepted: %v", err)
		}
	}
}
