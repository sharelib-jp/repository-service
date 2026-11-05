package api

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sharelib-jp/repository-service/config"
	"github.com/sharelib-jp/repository-service/internal/catalogstore"
)

func TestBrowserLoginSessionPermissionsAndLogout(t *testing.T) {
	store, _ := testCatalog(t)
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var nonce, challenge atomic.Value
	var revoked atomic.Bool
	var omitRefresh atomic.Bool
	var issuer string
	secret := strings.Repeat("s", 32)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			json.NewEncoder(w).Encode(map[string]any{"issuer": issuer, "authorization_endpoint": issuer + "/authorize", "token_endpoint": issuer + "/token", "userinfo_endpoint": issuer + "/userinfo", "jwks_uri": issuer + "/jwks", "revocation_endpoint": issuer + "/revoke", "id_token_signing_alg_values_supported": []string{"RS256"}})
		case "/jwks":
			json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]string{"kty": "RSA", "use": "sig", "alg": "RS256", "kid": "test", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())}}})
		case "/token":
			id, password, ok := r.BasicAuth()
			if !ok || id != "repository-service" || password != secret {
				t.Error("client authentication failed")
			}
			r.ParseForm()
			digest := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
			if base64.RawURLEncoding.EncodeToString(digest[:]) != challenge.Load() || r.Form.Get("redirect_uri") != "https://repository.test/auth/callback" || r.Form.Has("resource") {
				t.Error("invalid token exchange")
			}
			header, _ := json.Marshal(map[string]string{"alg": "RS256", "kid": "test"})
			claims, _ := json.Marshal(map[string]any{"iss": issuer, "aud": "repository-service", "sub": "external-user", "nonce": nonce.Load(), "exp": time.Now().Add(5 * time.Minute).Unix(), "iat": time.Now().Unix()})
			unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)
			hash := sha256.Sum256([]byte(unsigned))
			signature, e := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, hash[:])
			if e != nil {
				t.Error(e)
			}
			payload := map[string]any{"access_token": "opaque-access-token", "token_type": "Bearer", "expires_in": 300, "id_token": unsigned + "." + base64.RawURLEncoding.EncodeToString(signature)}
			if !omitRefresh.Load() {
				payload["refresh_token"] = "opaque-refresh-token"
			}
			json.NewEncoder(w).Encode(payload)
		case "/userinfo":
			if revoked.Load() {
				w.WriteHeader(401)
				return
			}
			if r.Header.Get("Authorization") != "Bearer opaque-access-token" {
				t.Error("userinfo bearer missing")
			}
			json.NewEncoder(w).Encode(map[string]string{"sub": "external-user", "name": "図書館職員"})
		case "/revoke":
			revoked.Store(true)
			w.WriteHeader(200)
		default:
			w.WriteHeader(404)
		}
	}))
	defer provider.Close()
	issuer = strings.Replace(provider.URL, "127.0.0.1", "localhost", 1)
	t.Setenv("TEST_BROWSER_SECRET", secret)
	conf := &config.Config{OIDC: config.OIDCConfig{Enabled: true, Issuer: issuer, ClientID: "repository-service", ClientSecretEnv: "TEST_BROWSER_SECRET", RedirectURI: "https://repository.test/auth/callback", Scopes: []string{"openid", "profile", "email", "offline_access"}}}
	browser, err := NewBrowserAuth(conf, store, nil)
	if err != nil {
		t.Fatal(err)
	}
	h := NewRouter(conf, Dependencies{Store: store, Authenticate: browser, BrowserAuth: browser})
	request := func(method, path string, cookie *http.Cookie, csrf string, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "https://repository.test"+path, strings.NewReader(body))
		if cookie != nil {
			r.AddCookie(cookie)
		}
		if csrf != "" {
			r.Header.Set("X-CSRF-Token", csrf)
		}
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", "https://repository.test")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s: %d wanted %d: %s", method, path, w.Code, status, w.Body.String())
		}
		return w
	}
	request("GET", "/api/auth/session", nil, "", "", 200)
	login := request("GET", "/api/auth/login?returnTo=%2Fsettings%2Fusers", nil, "", "", 303)
	authorization, _ := url.Parse(login.Header().Get("Location"))
	values := authorization.Query()
	nonce.Store(values.Get("nonce"))
	challenge.Store(values.Get("code_challenge"))
	if values.Get("code_challenge_method") != "S256" || values.Get("scope") != "openid profile email offline_access" || values.Get("prompt") != "consent" || len(values.Get("state")) < 32 {
		t.Fatal("missing OIDC security parameters")
	}
	loginCookie := login.Result().Cookies()[0]
	callback := "/auth/callback?" + url.Values{"code": {"code"}, "state": {values.Get("state")}}.Encode()
	request("GET", callback, nil, "", "", 400)
	result := request("GET", callback, loginCookie, "", "", 303)
	if result.Header().Get("Location") != "/settings/users" {
		t.Fatal("lost return path")
	}
	var cookie *http.Cookie
	for _, c := range result.Result().Cookies() {
		if c.Name == browser.cookieName(false) {
			cookie = c
		}
	}
	if cookie == nil || !cookie.Secure || !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" || cookie.Domain != "" {
		t.Fatal("insecure session cookie")
	}
	var session struct {
		Authenticated bool              `json:"authenticated"`
		User          catalogstore.User `json:"user"`
		CSRF          string            `json:"csrfToken"`
	}
	json.Unmarshal(request("GET", "/api/auth/session", cookie, "", "", 200).Body.Bytes(), &session)
	if !session.Authenticated || session.CSRF == "" || session.User.DisplayNameCache != "図書館職員" {
		t.Fatal("session missing")
	}
	for _, path := range []string{"/api/books", "/api/copies", "/api/authorities/author", "/api/roles", "/api/users", "/api/external/sources"} {
		request("GET", path, cookie, "", "", 403)
	}
	store.DB.Exec("INSERT INTO user_roles(user_id,role_id) VALUES (?,?)", session.User.ID, "editor")
	request("GET", "/api/books", cookie, "", "", 403)
	store.DB.Exec("INSERT INTO user_roles(user_id,role_id) VALUES (?,?)", session.User.ID, "admin")
	request("GET", "/api/books", cookie, "", "", 200)
	request("POST", "/api/books", cookie, "", `{"title":"本"}`, 403)
	request("POST", "/api/books", cookie, session.CSRF, `{"title":"本"}`, 201)
	var row authRecord
	store.DB.Table(sessionTable).Take(&row)
	if strings.Contains(row.Data, "opaque-access-token") || row.Hash == cookie.Value {
		t.Fatal("plaintext session secret in database")
	}
	request("GET", callback, loginCookie, "", "", 400)
	request("POST", "/api/auth/logout", cookie, "", "", 403)
	request("POST", "/api/auth/logout", cookie, session.CSRF, "", 204)
	request("GET", "/api/me", cookie, "", "", 401)
	// A validly signed token with a different nonce must not create a session.
	login = request("GET", "/api/auth/login?returnTo=https%3A%2F%2Fevil.test", nil, "", "", 303)
	authorization, _ = url.Parse(login.Header().Get("Location"))
	values = authorization.Query()
	nonce.Store("different-nonce")
	challenge.Store(values.Get("code_challenge"))
	callback = "/auth/callback?" + url.Values{"code": {"code"}, "state": {values.Get("state")}}.Encode()
	request("GET", callback, login.Result().Cookies()[0], "", "", 401)
	// Do not silently create another short session if the provider omits refresh.
	revoked.Store(false)
	omitRefresh.Store(true)
	login = request("GET", "/api/auth/login", nil, "", "", 303)
	authorization, _ = url.Parse(login.Header().Get("Location"))
	values = authorization.Query()
	nonce.Store(values.Get("nonce"))
	challenge.Store(values.Get("code_challenge"))
	callback = "/auth/callback?" + url.Values{"code": {"code"}, "state": {values.Get("state")}}.Encode()
	missing := request("GET", callback, login.Result().Cookies()[0], "", "", 401)
	if !strings.Contains(missing.Body.String(), "refresh_unavailable") {
		t.Fatal("missing refresh token did not report the registration problem")
	}
}
