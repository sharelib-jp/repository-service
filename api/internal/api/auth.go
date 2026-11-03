package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/sharelib-jp/repository-service/config"
	"github.com/sharelib-jp/repository-service/internal/catalogstore"
)

type Authenticator interface {
	Authenticate(*http.Request) (catalogstore.User, error)
}
type AuthFunc func(*http.Request) (catalogstore.User, error)

func (f AuthFunc) Authenticate(r *http.Request) (catalogstore.User, error) { return f(r) }

type userKey struct{}

var errUnauthenticated = errors.New("invalid access token")

func actorID(r *http.Request) *string {
	u, ok := r.Context().Value(userKey{}).(catalogstore.User)
	if !ok {
		return nil
	}
	return &u.ID
}
func (a *catalogAPI) protect(next http.Handler) http.Handler {
	return a.authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.requireAuth {
			user, _ := r.Context().Value(userKey{}).(catalogstore.User)
			allowed := false
			for _, role := range user.Roles {
				if role == "admin" {
					allowed = true
				}
			}
			if !allowed {
				apiError(w, 403, "forbidden", "この操作には管理者権限が必要です。")
				return
			}
		}
		next.ServeHTTP(w, r)
	}))
}
func (a *catalogAPI) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.requireAuth {
			next.ServeHTTP(w, r)
			return
		}
		if a.Authenticate == nil {
			apiError(w, 503, "auth_unavailable", "認証連携が設定されていません。")
			return
		}
		user, err := a.Authenticate.Authenticate(r)
		if err != nil {
			if errors.Is(err, errCSRF) {
				apiError(w, 403, "csrf_failed", "画面を再読み込みしてやり直してください。")
			} else if errors.Is(err, errUnauthenticated) {
				w.Header().Set("WWW-Authenticate", `Bearer error="invalid_token"`)
				apiError(w, 401, "unauthorized", "認証が必要です。")
			} else {
				apiError(w, 503, "auth_unavailable", "認証情報を確認できませんでした。")
			}
			return
		}
		if user.Status != "active" {
			apiError(w, 403, "forbidden", "この利用者は停止されています。")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey{}, user)))
	})
}
func (a *catalogAPI) me(w http.ResponseWriter, r *http.Request) {
	if user, ok := r.Context().Value(userKey{}).(catalogstore.User); ok {
		writeJSON(w, 200, user)
	} else {
		writeJSON(w, 200, map[string]any{"authenticated": false, "development": true})
	}
}

type introspectionAuth struct {
	issuer, endpoint, audience, credentialID, secret string
	client                                           *http.Client
	store                                            *catalogstore.Store
}

func NewAuthenticator(conf *config.Config, store *catalogstore.Store) (Authenticator, error) {
	if !conf.OIDC.Enabled {
		return nil, nil
	}
	c := conf.APIAuth
	if c.IntrospectionURL == "" && c.Audience == "" && c.CredentialID == "" && c.SecretEnv == "" {
		return nil, nil
	}
	if c.IntrospectionURL == "" || c.Audience == "" || c.CredentialID == "" {
		return nil, errors.New("OIDC is enabled: configure API_AUTH introspection URL, resource audience and resource credential")
	}
	secret, err := c.Secret()
	if err != nil {
		return nil, err
	}
	u, err := url.Parse(c.IntrospectionURL)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && !(u.Scheme == "http" && u.Hostname() == "localhost")) {
		return nil, errors.New("invalid API_AUTH introspection URL")
	}
	return &introspectionAuth{issuer: conf.OIDC.Issuer, endpoint: c.IntrospectionURL, audience: c.Audience, credentialID: c.CredentialID, secret: secret, store: store, client: &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (a *introspectionAuth) Authenticate(r *http.Request) (catalogstore.User, error) {
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || len(parts[1]) > 4096 {
		return catalogstore.User{}, errUnauthenticated
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, a.endpoint, strings.NewReader(url.Values{"token": {parts[1]}}.Encode()))
	if err != nil {
		return catalogstore.User{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(a.credentialID, a.secret)
	response, err := a.client.Do(req)
	if err != nil {
		return catalogstore.User{}, errors.New("introspection service unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return catalogstore.User{}, errors.New("introspection service rejected resource credentials")
	}
	var claims struct {
		Active   bool            `json:"active"`
		Subject  string          `json:"sub"`
		Issuer   string          `json:"iss"`
		Audience json.RawMessage `json:"aud"`
		Expires  int64           `json:"exp"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&claims); err != nil {
		return catalogstore.User{}, errors.New("invalid introspection response")
	}
	var audiences []string
	if err := json.Unmarshal(claims.Audience, &audiences); err != nil {
		var single string
		if json.Unmarshal(claims.Audience, &single) == nil {
			audiences = []string{single}
		}
	}
	matches := false
	for _, aud := range audiences {
		if aud == a.audience {
			matches = true
		}
	}
	if !claims.Active || claims.Subject == "" || claims.Issuer != a.issuer || claims.Expires <= time.Now().Unix() || !matches {
		return catalogstore.User{}, errUnauthenticated
	}
	return a.store.ResolveUser(r.Context(), claims.Issuer, claims.Subject, "")
}
