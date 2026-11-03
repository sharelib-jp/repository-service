// Package api provides the repository service's HTTP endpoints.
package api

import (
	"net/http"

	"github.com/sharelib-jp/repository-service/config"
)

// NewRouter mounts public metadata and, when dependencies are supplied, catalog APIs.
// Provider-only OIDC endpoints remain owned by auth-service.
func NewRouter(conf *config.Config, dependencies ...Dependencies) *http.ServeMux {
	mux := http.NewServeMux()
	RegisterWellKnownRoutes(mux, conf)
	if len(dependencies) > 0 && dependencies[0].Store != nil {
		service := &catalogAPI{Dependencies: dependencies[0], requireAuth: conf.OIDC.Enabled}
		service.register(mux)
		if dependencies[0].BrowserAuth != nil {
			dependencies[0].BrowserAuth.register(mux)
		} else {
			mux.HandleFunc("GET /api/auth/session", func(w http.ResponseWriter, r *http.Request) {
				if conf.OIDC.Enabled {
					apiError(w, 503, "auth_unavailable", "ログイン連携が設定されていません。")
					return
				}
				writeJSON(w, 200, map[string]any{"authenticated": false, "development": true})
			})
		}
	}
	return mux
}
