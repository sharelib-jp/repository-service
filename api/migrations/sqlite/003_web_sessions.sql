CREATE TABLE repository_web_sessions (hash TEXT NOT NULL PRIMARY KEY, data TEXT NOT NULL, expires_at DATETIME NOT NULL);
CREATE INDEX repository_web_sessions_expiry ON repository_web_sessions(expires_at);
CREATE TABLE repository_oidc_requests (hash TEXT NOT NULL PRIMARY KEY, data TEXT NOT NULL, expires_at DATETIME NOT NULL);
CREATE INDEX repository_oidc_requests_expiry ON repository_oidc_requests(expires_at);
