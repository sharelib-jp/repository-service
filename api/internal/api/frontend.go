package api

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// RegisterFrontend serves the production build on the same origin as the API.
func RegisterFrontend(mux *http.ServeMux, directory string) {
	pages := map[string]bool{"/": true, "/books": true, "/books/register": true, "/books/edit": true, "/books/history": true, "/authors": true, "/settings/users": true}
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/")
		path := strings.TrimSuffix(r.URL.Path, "/")
		if path == "" {
			path = "/"
		}
		if pages[path] || (strings.HasPrefix(path, "/books/edit/") && !strings.Contains(strings.TrimPrefix(path, "/books/edit/"), "/")) {
			name = "index.html"
		}
		for _, prefix := range []string{"/api", "/.well-known", "/auth", "/internal"} {
			if path == prefix || strings.HasPrefix(path, prefix+"/") {
				http.NotFound(w, r)
				return
			}
		}
		if !fs.ValidPath(name) {
			http.NotFound(w, r)
			return
		}
		file, err := os.Open(filepath.Join(directory, filepath.FromSlash(name)))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Security-Policy", "frame-ancestors 'none'")
		w.Header().Set("X-Frame-Options", "DENY")
		if name == "index.html" {
			w.Header().Set("Cache-Control", "no-cache")
		}
		http.ServeContent(w, r, info.Name(), info.ModTime(), file)
	})
}
