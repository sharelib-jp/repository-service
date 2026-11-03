package api

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/sharelib-jp/repository-service/config"
	"github.com/sharelib-jp/repository-service/internal/catalogstore"
	"golang.org/x/oauth2"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const sessionTable = "repository_web_sessions"
const loginTable = "repository_oidc_requests"

type authRecord struct {
	Hash      string `gorm:"primaryKey"`
	Data      string
	ExpiresAt time.Time
}
type pendingLogin struct {
	Verifier    string
	Nonce       string
	BrowserHash string
	ReturnTo    string
}
type browserSession struct {
	Token   *oauth2.Token
	Subject string
	CSRF    string
}
type sessionContextKey struct{}
type BrowserAuth struct {
	conf          config.OIDCConfig
	store         *catalogstore.Store
	client        *http.Client
	aead          cipher.AEAD
	origin        string
	secure        bool
	mu            sync.Mutex
	provider      *oidc.Provider
	oauth         oauth2.Config
	revocationURL string
	bearer        Authenticator
	audience      string
}

func NewBrowserAuth(conf *config.Config, store *catalogstore.Store, bearer Authenticator) (*BrowserAuth, error) {
	if !conf.OIDC.Enabled {
		return nil, nil
	}
	if err := conf.OIDC.Validate(); err != nil {
		return nil, err
	}
	redirect, _ := url.Parse(conf.OIDC.RedirectURI)
	if redirect.RawQuery != "" || redirect.Path == "" || strings.HasPrefix(redirect.Path, "/api/") || strings.HasPrefix(redirect.Path, "/.well-known/") {
		return nil, errors.New("OIDC REDIRECT_URI must have a dedicated callback path without a query")
	}
	secret, err := conf.OIDC.ClientSecret()
	if err != nil {
		return nil, err
	}
	key := sha256.Sum256([]byte("sharelib-repository-session-v1\x00" + secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &BrowserAuth{conf: conf.OIDC, store: store, aead: aead, origin: redirect.Scheme + "://" + redirect.Host, secure: redirect.Scheme == "https", bearer: bearer, audience: conf.APIAuth.Audience, client: &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func randomAuthValue() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}
func authHash(value string) string {
	v := sha256.Sum256([]byte(value))
	return hex.EncodeToString(v[:])
}
func (b *BrowserAuth) seal(table, hash string, value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := b.aead.Seal(nonce, nonce, raw, []byte(table+":"+hash))
	return base64.RawURLEncoding.EncodeToString(sealed), nil
}
func (b *BrowserAuth) open(table string, row authRecord, value any) error {
	raw, err := base64.RawURLEncoding.DecodeString(row.Data)
	if err != nil || len(raw) < b.aead.NonceSize() {
		return errUnauthenticated
	}
	plain, err := b.aead.Open(nil, raw[:b.aead.NonceSize()], raw[b.aead.NonceSize():], []byte(table+":"+row.Hash))
	if err != nil || json.Unmarshal(plain, value) != nil {
		return errUnauthenticated
	}
	return nil
}
func (b *BrowserAuth) providerConfig(ctx context.Context) (*oidc.Provider, oauth2.Config, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.provider != nil {
		return b.provider, b.oauth, nil
	}
	ctx = oidc.ClientContext(ctx, b.client)
	provider, err := oidc.NewProvider(ctx, b.conf.Issuer)
	if err != nil {
		return nil, oauth2.Config{}, errors.New("OIDC discovery unavailable")
	}
	var metadata struct {
		Authorization string `json:"authorization_endpoint"`
		Token         string `json:"token_endpoint"`
		UserInfo      string `json:"userinfo_endpoint"`
		JWKS          string `json:"jwks_uri"`
		Revoke        string `json:"revocation_endpoint"`
	}
	if err := provider.Claims(&metadata); err != nil {
		return nil, oauth2.Config{}, err
	}
	for _, endpoint := range []string{metadata.Authorization, metadata.Token, metadata.UserInfo, metadata.JWKS, metadata.Revoke} {
		u, err := url.Parse(endpoint)
		if err != nil || u.User != nil || u.Fragment != "" || u.RawQuery != "" || u.Scheme+"://"+u.Host != b.conf.Issuer {
			return nil, oauth2.Config{}, errors.New("OIDC endpoints must belong to the configured auth-service issuer")
		}
	}
	secret, err := b.conf.ClientSecret()
	if err != nil {
		return nil, oauth2.Config{}, err
	}
	endpoint := provider.Endpoint()
	endpoint.AuthStyle = oauth2.AuthStyleInHeader
	b.oauth = oauth2.Config{ClientID: b.conf.ClientID, ClientSecret: secret, RedirectURL: b.conf.RedirectURI, Scopes: b.conf.Scopes, Endpoint: endpoint}
	b.provider = provider
	b.revocationURL = metadata.Revoke
	return provider, b.oauth, nil
}
func (b *BrowserAuth) cookieName(login bool) string {
	name := "repository_session"
	if login {
		name = "repository_login"
	}
	if b.secure {
		name = "__Host-" + name
	}
	return name
}
func (b *BrowserAuth) cookie(w http.ResponseWriter, login bool, value string, expires time.Time) {
	maxAge := int(time.Until(expires).Seconds())
	if value == "" {
		maxAge = -1
		expires = time.Unix(1, 0)
	}
	http.SetCookie(w, &http.Cookie{Name: b.cookieName(login), Value: value, Path: "/", Secure: b.secure, HttpOnly: true, SameSite: http.SameSiteLaxMode, Expires: expires, MaxAge: maxAge})
}
func authHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
}
func safeReturnTo(value string) string {
	if value == "" {
		return "/"
	}
	u, err := url.Parse(value)
	if err != nil || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") || strings.ContainsAny(value, "\\\r\n\x00") || u.IsAbs() || u.Host != "" {
		return "/"
	}
	if strings.HasPrefix(u.Path, "/api/") || strings.HasPrefix(u.Path, "/auth/") {
		return "/"
	}
	return value
}
func (b *BrowserAuth) register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/login", b.login)
	u, _ := url.Parse(b.conf.RedirectURI)
	mux.HandleFunc("GET "+u.Path, b.callback)
	mux.HandleFunc("GET /api/auth/session", b.session)
	mux.HandleFunc("POST /api/auth/logout", b.logout)
}
func (b *BrowserAuth) login(w http.ResponseWriter, r *http.Request) {
	authHeaders(w)
	_, oauth, err := b.providerConfig(r.Context())
	if err != nil {
		apiError(w, 503, "auth_unavailable", "認証サービスに接続できませんでした。")
		return
	}
	state, browser := randomAuthValue(), randomAuthValue()
	pending := pendingLogin{Verifier: randomAuthValue(), Nonce: randomAuthValue(), BrowserHash: authHash(browser), ReturnTo: safeReturnTo(r.URL.Query().Get("returnTo"))}
	row := authRecord{Hash: authHash(state), ExpiresAt: time.Now().UTC().Add(10 * time.Minute)}
	row.Data, err = b.seal(loginTable, row.Hash, pending)
	if err != nil {
		fail(w, err)
		return
	}
	err = b.store.DB.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		for _, table := range []string{loginTable, sessionTable} {
			if err := tx.Table(table).Where("expires_at < ?", time.Now().UTC()).Delete(&authRecord{}).Error; err != nil {
				return err
			}
		}
		return tx.Table(loginTable).Create(&row).Error
	})
	if err != nil {
		fail(w, err)
		return
	}
	b.cookie(w, true, browser, row.ExpiresAt)
	options := []oauth2.AuthCodeOption{oauth2.S256ChallengeOption(pending.Verifier), oidc.Nonce(pending.Nonce)}
	if b.audience != "" {
		options = append(options, oauth2.SetAuthURLParam("resource", b.audience))
	}
	http.Redirect(w, r, oauth.AuthCodeURL(state, options...), http.StatusSeeOther)
}
func (b *BrowserAuth) consumeLogin(r *http.Request) (pendingLogin, error) {
	var pending pendingLogin
	if len(r.URL.RawQuery) > 8192 {
		return pending, errUnauthenticated
	}
	for _, values := range r.URL.Query() {
		if len(values) != 1 {
			return pending, errUnauthenticated
		}
	}
	state := r.URL.Query().Get("state")
	cookie, err := r.Cookie(b.cookieName(true))
	if err != nil || len(state) != 43 || len(cookie.Value) != 43 {
		return pending, errUnauthenticated
	}
	err = b.store.DB.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		var row authRecord
		q := tx.Table(loginTable)
		if tx.Dialector.Name() == "postgres" {
			q = q.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := q.Where("hash = ?", authHash(state)).Take(&row).Error; err != nil {
			return errUnauthenticated
		}
		if !row.ExpiresAt.After(time.Now()) || b.open(loginTable, row, &pending) != nil || subtle.ConstantTimeCompare([]byte(pending.BrowserHash), []byte(authHash(cookie.Value))) != 1 {
			return errUnauthenticated
		}
		return tx.Table(loginTable).Where("hash = ?", row.Hash).Delete(&authRecord{}).Error
	})
	return pending, err
}
func (b *BrowserAuth) verifyToken(ctx context.Context, p *oidc.Provider, token *oauth2.Token, nonce, subject string) (string, error) {
	if token == nil || token.AccessToken == "" || len(token.AccessToken) > 4096 || len(token.RefreshToken) > 4096 || !strings.EqualFold(token.TokenType, "Bearer") || token.Expiry.IsZero() || !token.Expiry.After(time.Now()) {
		return "", errUnauthenticated
	}
	raw, _ := token.Extra("id_token").(string)
	id, err := p.Verifier(&oidc.Config{ClientID: b.conf.ClientID, SupportedSigningAlgs: []string{"RS256"}}).Verify(oidc.ClientContext(ctx, b.client), raw)
	if err != nil || id.Subject == "" {
		return "", errUnauthenticated
	}
	if nonce != "" && subtle.ConstantTimeCompare([]byte(id.Nonce), []byte(nonce)) != 1 {
		return "", errUnauthenticated
	}
	if subject != "" && id.Subject != subject {
		return "", errUnauthenticated
	}
	var claims struct {
		AuthorizedParty string `json:"azp"`
	}
	if id.Claims(&claims) != nil || (len(id.Audience) > 1 && claims.AuthorizedParty != b.conf.ClientID) || (claims.AuthorizedParty != "" && claims.AuthorizedParty != b.conf.ClientID) {
		return "", errUnauthenticated
	}
	if id.AccessTokenHash != "" && id.VerifyAccessToken(token.AccessToken) != nil {
		return "", errUnauthenticated
	}
	return id.Subject, nil
}
func (b *BrowserAuth) userInfo(ctx context.Context, p *oidc.Provider, token *oauth2.Token, subject string) (catalogstore.User, error) {
	info, err := p.UserInfo(oidc.ClientContext(ctx, b.client), oauth2.StaticTokenSource(token))
	if err != nil {
		var retrieve *oauth2.RetrieveError
		if errors.As(err, &retrieve) && (retrieve.Response.StatusCode == 401 || retrieve.Response.StatusCode == 403) {
			return catalogstore.User{}, errUnauthenticated
		}
		// The UserInfo implementation reports HTTP status in a plain error.
		if strings.HasPrefix(err.Error(), "401 ") || strings.HasPrefix(err.Error(), "403 ") {
			return catalogstore.User{}, errUnauthenticated
		}
		return catalogstore.User{}, errors.New("OIDC userinfo unavailable")
	}
	if info.Subject != subject {
		return catalogstore.User{}, errUnauthenticated
	}
	var profile struct {
		Name     string `json:"name"`
		Username string `json:"preferred_username"`
	}
	if info.Claims(&profile) != nil {
		return catalogstore.User{}, errUnauthenticated
	}
	if profile.Name == "" {
		profile.Name = profile.Username
	}
	return b.store.ResolveUser(ctx, b.conf.Issuer, subject, profile.Name)
}
func (b *BrowserAuth) callback(w http.ResponseWriter, r *http.Request) {
	authHeaders(w)
	pending, err := b.consumeLogin(r)
	if err != nil {
		apiError(w, 400, "invalid_login", "ログイン要求が無効か期限切れです。ログインをやり直してください。")
		return
	}
	b.cookie(w, true, "", time.Time{})
	if r.URL.Query().Get("error") != "" {
		u, _ := url.Parse(pending.ReturnTo)
		q := u.Query()
		q.Set("authError", "access_denied")
		u.RawQuery = q.Encode()
		http.Redirect(w, r, u.String(), http.StatusSeeOther)
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" || len(code) > 4096 {
		apiError(w, 400, "invalid_login", "認可コードを確認できませんでした。")
		return
	}
	provider, oauth, err := b.providerConfig(r.Context())
	if err != nil {
		apiError(w, 503, "auth_unavailable", "認証サービスに接続できませんでした。")
		return
	}
	token, err := oauth.Exchange(oidc.ClientContext(r.Context(), b.client), code, oauth2.VerifierOption(pending.Verifier))
	if err != nil {
		apiError(w, 401, "invalid_login", "ログインを完了できませんでした。連携設定を確認してやり直してください。")
		return
	}
	subject, err := b.verifyToken(r.Context(), provider, token, pending.Nonce, "")
	if err != nil {
		apiError(w, 401, "invalid_login", "認証結果を検証できませんでした。")
		return
	}
	if _, err := b.userInfo(r.Context(), provider, token, subject); err != nil {
		apiError(w, 401, "invalid_login", "利用者情報を確認できませんでした。")
		return
	}
	session := browserSession{Token: token, Subject: subject, CSRF: randomAuthValue()}
	handle := randomAuthValue()
	row := authRecord{Hash: authHash(handle), ExpiresAt: time.Now().UTC().Add(24 * time.Hour)}
	row.Data, err = b.seal(sessionTable, row.Hash, session)
	if err == nil {
		err = b.store.DB.WithContext(r.Context()).Table(sessionTable).Create(&row).Error
	}
	if err != nil {
		fail(w, err)
		return
	}
	if old, err := r.Cookie(b.cookieName(false)); err == nil {
		b.store.DB.WithContext(r.Context()).Table(sessionTable).Where("hash = ?", authHash(old.Value)).Delete(&authRecord{})
	}
	b.cookie(w, false, handle, row.ExpiresAt)
	http.Redirect(w, r, pending.ReturnTo, http.StatusSeeOther)
}
func (b *BrowserAuth) loadSession(r *http.Request) (browserSession, error) {
	var session browserSession
	cookie, err := r.Cookie(b.cookieName(false))
	if err != nil || len(cookie.Value) != 43 {
		return session, errUnauthenticated
	}
	var invalid bool
	err = b.store.DB.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		var row authRecord
		query := tx.Table(sessionTable)
		if tx.Dialector.Name() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.Where("hash = ?", authHash(cookie.Value)).Take(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errUnauthenticated
			}
			return err
		}
		if !row.ExpiresAt.After(time.Now()) || b.open(sessionTable, row, &session) != nil || session.Token == nil {
			invalid = true
			return tx.Table(sessionTable).Where("hash = ?", row.Hash).Delete(&authRecord{}).Error
		}
		if session.Token.Expiry.After(time.Now().Add(10 * time.Second)) {
			return nil
		}
		if session.Token.RefreshToken == "" {
			invalid = true
			return tx.Table(sessionTable).Where("hash = ?", row.Hash).Delete(&authRecord{}).Error
		}
		_, oauth, err := b.providerConfig(r.Context())
		if err != nil {
			return err
		}
		old := *session.Token
		old.Expiry = time.Now().Add(-time.Minute)
		token, err := oauth.TokenSource(oidc.ClientContext(r.Context(), b.client), &old).Token()
		if err != nil {
			var retrieve *oauth2.RetrieveError
			if errors.As(err, &retrieve) && retrieve.ErrorCode == "invalid_grant" {
				invalid = true
				return tx.Table(sessionTable).Where("hash = ?", row.Hash).Delete(&authRecord{}).Error
			}
			return errors.New("OIDC token refresh unavailable")
		}
		if token.AccessToken == "" || len(token.AccessToken) > 4096 || len(token.RefreshToken) > 4096 || !strings.EqualFold(token.TokenType, "Bearer") || token.Expiry.IsZero() || !token.Expiry.After(time.Now()) {
			return errUnauthenticated
		}
		session.Token = token
		row.Data, err = b.seal(sessionTable, row.Hash, session)
		if err != nil {
			return err
		}
		return tx.Table(sessionTable).Where("hash = ?", row.Hash).Update("data", row.Data).Error
	})
	if invalid {
		return session, errUnauthenticated
	}
	return session, err
}
func (b *BrowserAuth) sameOrigin(r *http.Request) bool {
	if origin := r.Header.Get("Origin"); origin != "" && origin != b.origin {
		return false
	}
	return r.Header.Get("Sec-Fetch-Site") != "cross-site"
}
func (b *BrowserAuth) Authenticate(r *http.Request) (catalogstore.User, error) {
	if r.Header.Get("Authorization") != "" {
		if b.bearer == nil {
			return catalogstore.User{}, errUnauthenticated
		}
		return b.bearer.Authenticate(r)
	}
	session, err := b.loadSession(r)
	if err != nil {
		return catalogstore.User{}, err
	}
	if r.Method != "GET" && r.Method != "HEAD" && (!b.sameOrigin(r) || subtle.ConstantTimeCompare([]byte(session.CSRF), []byte(r.Header.Get("X-CSRF-Token"))) != 1) {
		return catalogstore.User{}, errCSRF
	}
	p, _, err := b.providerConfig(r.Context())
	if err != nil {
		return catalogstore.User{}, err
	}
	user, err := b.userInfo(r.Context(), p, session.Token, session.Subject)
	if err == nil {
		*r = *r.WithContext(context.WithValue(r.Context(), sessionContextKey{}, session))
	}
	return user, err
}

var errCSRF = errors.New("invalid CSRF token")

func (b *BrowserAuth) session(w http.ResponseWriter, r *http.Request) {
	authHeaders(w)
	user, err := b.Authenticate(r)
	if errors.Is(err, errUnauthenticated) {
		b.cookie(w, false, "", time.Time{})
		writeJSON(w, 200, map[string]any{"authenticated": false, "loginURL": "/api/auth/login"})
		return
	}
	if err != nil {
		apiError(w, 503, "auth_unavailable", "認証情報を確認できませんでした。")
		return
	}
	session, _ := r.Context().Value(sessionContextKey{}).(browserSession)
	writeJSON(w, 200, map[string]any{"authenticated": true, "user": user, "csrfToken": session.CSRF, "loginURL": "/api/auth/login"})
}
func (b *BrowserAuth) logout(w http.ResponseWriter, r *http.Request) {
	authHeaders(w)
	session, err := b.loadSession(r)
	if err != nil && !errors.Is(err, errUnauthenticated) {
		apiError(w, 503, "auth_unavailable", "ログアウトを完了できませんでした。")
		return
	}
	if !b.sameOrigin(r) || (err == nil && subtle.ConstantTimeCompare([]byte(session.CSRF), []byte(r.Header.Get("X-CSRF-Token"))) != 1) {
		apiError(w, 403, "csrf_failed", "画面を再読み込みしてやり直してください。")
		return
	}
	cookie, _ := r.Cookie(b.cookieName(false))
	if cookie != nil {
		if e := b.store.DB.WithContext(r.Context()).Table(sessionTable).Where("hash = ?", authHash(cookie.Value)).Delete(&authRecord{}).Error; e != nil {
			fail(w, e)
			return
		}
	}
	b.cookie(w, false, "", time.Time{})
	if err == nil {
		_, oauth, e := b.providerConfig(r.Context())
		if e == nil {
			for _, token := range []string{session.Token.AccessToken, session.Token.RefreshToken} {
				if token == "" {
					continue
				}
				request, _ := http.NewRequestWithContext(r.Context(), "POST", b.revocationURL, strings.NewReader(url.Values{"token": {token}}.Encode()))
				request.SetBasicAuth(oauth.ClientID, oauth.ClientSecret)
				request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
				response, e := b.client.Do(request)
				if e == nil {
					response.Body.Close()
				}
			}
		}
	}
	writeJSON(w, 204, nil)
}
