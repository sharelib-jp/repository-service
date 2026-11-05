package api

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sharelib-jp/repository-service/config"
	"golang.org/x/oauth2"
)

type refreshFixture struct {
	browser *BrowserAuth
	cookie  *http.Cookie
	record  authRecord
	initial browserSession
	issuer  string
	key     *rsa.PrivateKey
	calls   atomic.Int64
	reply   func(*http.Request) (map[string]any, int)
}

func newRefreshFixture(t *testing.T) *refreshFixture {
	t.Helper()
	store, _ := testCatalog(t)
	f := &refreshFixture{}
	var err error
	f.key, err = rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]any{"issuer": f.issuer, "authorization_endpoint": f.issuer + "/authorize", "token_endpoint": f.issuer + "/token", "userinfo_endpoint": f.issuer + "/userinfo", "jwks_uri": f.issuer + "/jwks", "revocation_endpoint": f.issuer + "/revoke", "id_token_signing_alg_values_supported": []string{"RS256"}})
		case "/jwks":
			_ = json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]string{"kty": "RSA", "use": "sig", "alg": "RS256", "kid": "refresh-key", "n": base64.RawURLEncoding.EncodeToString(f.key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(f.key.E)).Bytes())}}})
		case "/token":
			f.calls.Add(1)
			id, secret, ok := r.BasicAuth()
			if !ok || id != "repository-service" || secret != strings.Repeat("s", 32) {
				t.Error("refresh did not authenticate the client")
			}
			if r.ParseForm() != nil || r.Form.Get("grant_type") != "refresh_token" || r.Form.Get("refresh_token") != "refresh-0" {
				t.Error("invalid refresh request")
			}
			body, status := f.reply(r)
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(body)
		case "/userinfo":
			if r.Header.Get("Authorization") != "Bearer refreshed-access" {
				t.Error("userinfo did not use the refreshed access token")
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"sub": "external-user", "name": "職員"})
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(provider.Close)
	f.issuer = strings.Replace(provider.URL, "127.0.0.1", "localhost", 1)
	t.Setenv("TEST_REFRESH_SECRET", strings.Repeat("s", 32))
	conf := &config.Config{OIDC: config.OIDCConfig{Enabled: true, Issuer: f.issuer, ClientID: "repository-service", ClientSecretEnv: "TEST_REFRESH_SECRET", RedirectURI: "https://repository.test/auth/callback", Scopes: []string{"openid", "profile", "email", "offline_access"}}}
	f.browser, err = NewBrowserAuth(conf, store, nil)
	if err != nil {
		t.Fatal(err)
	}
	f.initial = browserSession{Token: &oauth2.Token{AccessToken: "expired-access", RefreshToken: "refresh-0", TokenType: "Bearer", Expiry: time.Now().Add(-time.Minute)}, Subject: "external-user", CSRF: "unchanged-csrf", Nonce: "original-nonce"}
	handle := randomAuthValue()
	f.cookie = &http.Cookie{Name: f.browser.cookieName(false), Value: handle}
	f.record = authRecord{Hash: authHash(handle), ExpiresAt: time.Now().Add(24 * time.Hour).UTC().Truncate(time.Microsecond)}
	f.writeSession(t, f.initial)
	if err := store.DB.Table(sessionTable).Create(&f.record).Error; err != nil {
		t.Fatal(err)
	}
	f.reply = func(*http.Request) (map[string]any, int) {
		return map[string]any{"access_token": "refreshed-access", "refresh_token": "refresh-1", "token_type": "Bearer", "expires_in": 300}, 200
	}
	return f
}
func (f *refreshFixture) writeSession(t *testing.T, session browserSession) {
	t.Helper()
	data, err := f.browser.seal(sessionTable, f.record.Hash, session)
	if err != nil {
		t.Fatal(err)
	}
	f.record.Data = data
}
func (f *refreshFixture) request() *http.Request {
	r := httptest.NewRequest("GET", "https://repository.test/api/auth/session", nil)
	r.AddCookie(f.cookie)
	return r
}
func (f *refreshFixture) idToken(t *testing.T, changes map[string]any) string {
	t.Helper()
	claims := map[string]any{"iss": f.issuer, "aud": "repository-service", "sub": "external-user", "iat": time.Now().Unix(), "exp": time.Now().Add(5 * time.Minute).Unix()}
	for key, value := range changes {
		claims[key] = value
	}
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "kid": "refresh-key"})
	body, _ := json.Marshal(claims)
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(body)
	digest := sha256.Sum256([]byte(unsigned))
	signed, err := rsa.SignPKCS1v15(rand.Reader, f.key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(signed)
}

func TestBrowserRefreshPersistsRotationAndSerializesConcurrentRequests(t *testing.T) {
	f := newRefreshFixture(t)
	type result struct {
		session browserSession
		err     error
	}
	results := make(chan result, 2)
	for i := 0; i < 2; i++ {
		go func() { session, err := f.browser.loadSession(f.request()); results <- result{session, err} }()
	}
	for i := 0; i < 2; i++ {
		r := <-results
		if r.err != nil || r.session.Token.AccessToken != "refreshed-access" || r.session.Token.RefreshToken != "refresh-1" || r.session.CSRF != f.initial.CSRF {
			t.Fatalf("refresh failed or session lost: %v", r.err)
		}
	}
	if f.calls.Load() != 1 {
		t.Fatalf("rotating token submitted concurrently %d times", f.calls.Load())
	}
	var row authRecord
	if err := f.browser.store.DB.Table(sessionTable).Where("hash = ?", f.record.Hash).Take(&row).Error; err != nil {
		t.Fatal(err)
	}
	if !row.ExpiresAt.Equal(f.record.ExpiresAt) || strings.Contains(row.Data, "refresh-1") || strings.Contains(row.Data, "refreshed-access") {
		t.Fatal("refresh extended the absolute session expiry or exposed a token")
	}
	var persisted browserSession
	if err := f.browser.open(sessionTable, row, &persisted); err != nil || persisted.Token.RefreshToken != "refresh-1" {
		t.Fatal("rotated refresh token not persisted")
	}
	// Verify the refreshed token works through the normal session API as well.
	mux := http.NewServeMux()
	f.browser.register(mux)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, f.request())
	var body struct {
		Authenticated bool `json:"authenticated"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &body) != nil || !body.Authenticated || strings.Contains(w.Body.String(), "refreshed-access") {
		t.Fatal("refreshed session not available to the application")
	}
}

func TestBrowserRefreshFailureAndAbsoluteExpiry(t *testing.T) {
	for _, mode := range []string{"invalid_grant", "expired_session", "missing_refresh", "transient"} {
		t.Run(mode, func(t *testing.T) {
			f := newRefreshFixture(t)
			switch mode {
			case "invalid_grant":
				f.reply = func(*http.Request) (map[string]any, int) { return map[string]any{"error": "invalid_grant"}, 400 }
			case "expired_session":
				if err := f.browser.store.DB.Table(sessionTable).Where("hash = ?", f.record.Hash).Update("expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
					t.Fatal(err)
				}
			case "missing_refresh":
				f.initial.Token.RefreshToken = ""
				f.writeSession(t, f.initial)
				if err := f.browser.store.DB.Table(sessionTable).Where("hash = ?", f.record.Hash).Update("data", f.record.Data).Error; err != nil {
					t.Fatal(err)
				}
			case "transient":
				f.reply = func(*http.Request) (map[string]any, int) {
					return map[string]any{"error": "temporarily_unavailable"}, 503
				}
			}
			_, err := f.browser.loadSession(f.request())
			var count int64
			if e := f.browser.store.DB.Table(sessionTable).Where("hash = ?", f.record.Hash).Count(&count).Error; e != nil {
				t.Fatal(e)
			}
			if mode == "transient" {
				if err == nil || errors.Is(err, errUnauthenticated) || count != 1 {
					t.Fatal("transient provider error deleted the session")
				}
				f.reply = func(*http.Request) (map[string]any, int) {
					return map[string]any{"access_token": "refreshed-access", "refresh_token": "refresh-1", "token_type": "Bearer", "expires_in": 300}, 200
				}
				if _, err := f.browser.loadSession(f.request()); err != nil {
					t.Fatal("session could not recover after provider error")
				}
			} else if !errors.Is(err, errUnauthenticated) || count != 0 {
				t.Fatal("invalid or expired session survived")
			}
			if (mode == "expired_session" || mode == "missing_refresh") && f.calls.Load() != 0 {
				t.Fatal("invalid session attempted a token refresh")
			}
		})
	}
}

func TestBrowserRefreshValidatesOptionalIDToken(t *testing.T) {
	for _, mode := range []string{"nonce_omitted", "nonce_retained", "wrong_nonce", "wrong_subject", "wrong_audience", "expired"} {
		t.Run(mode, func(t *testing.T) {
			f := newRefreshFixture(t)
			changes := map[string]any{}
			valid := mode == "nonce_omitted" || mode == "nonce_retained"
			switch mode {
			case "nonce_retained":
				changes["nonce"] = f.initial.Nonce
			case "wrong_nonce":
				changes["nonce"] = "other-nonce"
			case "wrong_subject":
				changes["sub"] = "other-user"
			case "wrong_audience":
				changes["aud"] = "other-client"
			case "expired":
				changes["exp"] = time.Now().Add(-time.Hour).Unix()
			}
			token := f.idToken(t, changes)
			f.reply = func(*http.Request) (map[string]any, int) {
				return map[string]any{"access_token": "refreshed-access", "refresh_token": "refresh-1", "token_type": "Bearer", "expires_in": 300, "id_token": token}, 200
			}
			_, err := f.browser.loadSession(f.request())
			if valid && err != nil {
				t.Fatalf("valid refreshed ID token rejected: %v", err)
			}
			if !valid && !errors.Is(err, errUnauthenticated) {
				t.Fatal("invalid refreshed identity accepted")
			}
		})
	}
}
