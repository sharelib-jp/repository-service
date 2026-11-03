package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const validConfig = `
[HOST]
SCHEME = "http://"
HOSTNAME = "localhost"
PORT = ":8081"
[DATABASE]
DATABASE_DRIVER = "sqlite"
DATABASE_DSN = "test.db"
[OIDC]
ENABLED = true
ISSUER = "https://auth.example.com"
CLIENT_ID = "repository-service"
REDIRECT_URI = "http://localhost:8081/auth/callback"
SCOPES = ["openid", "profile", "email"]
CLIENT_SECRET_ENV = "TEST_REPOSITORY_OIDC_SECRET"
`

func loadTestConfig(t *testing.T, content string) (*Config, error) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.toml")
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return LoadConfig(path)
}

func TestLoadOIDCClient(t *testing.T) {
	secret := strings.Repeat("s", 32)
	t.Setenv("TEST_REPOSITORY_OIDC_SECRET", secret)
	conf, err := loadTestConfig(t, validConfig)
	if err != nil {
		t.Fatal(err)
	}
	if conf.OIDC.Issuer != "https://auth.example.com" || conf.OIDC.ClientID != "repository-service" || conf.OIDC.RedirectURI != "http://localhost:8081/auth/callback" || len(conf.OIDC.Scopes) != 3 || conf.Origin() != "http://localhost:8081" {
		t.Fatalf("unexpected configuration: %+v", conf)
	}
	got, err := conf.OIDC.ClientSecret()
	if err != nil || got != secret {
		t.Fatalf("secret retrieval failed: %v", err)
	}
}

func TestInvalidOIDCClient(t *testing.T) {
	t.Setenv("TEST_REPOSITORY_OIDC_SECRET", strings.Repeat("s", 32))
	for _, tc := range []struct{ name, old, replacement string }{
		{"issuer with path", "https://auth.example.com", "https://auth.example.com/path"},
		{"issuer without TLS", "https://auth.example.com", "http://auth.example.com"},
		{"issuer with fragment", "https://auth.example.com", "https://auth.example.com/#fragment"},
		{"redirect without TLS", "http://localhost:8081/auth/callback", "http://example.com/auth/callback"},
		{"redirect with fragment", "http://localhost:8081/auth/callback", "https://repo.example.com/callback#"},
		{"missing openid", `SCOPES = ["openid", "profile", "email"]`, `SCOPES = ["profile"]`},
		{"duplicate scope", `SCOPES = ["openid", "profile", "email"]`, `SCOPES = ["openid", "openid"]`},
		{"invalid scope", `SCOPES = ["openid", "profile", "email"]`, `SCOPES = ["openid", "profile email"]`},
		{"invalid client id", `CLIENT_ID = "repository-service"`, `CLIENT_ID = "bad/client"`},
		{"invalid env name", "TEST_REPOSITORY_OIDC_SECRET", "1INVALID"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := loadTestConfig(t, strings.Replace(validConfig, tc.old, tc.replacement, 1))
			if err == nil {
				t.Fatal("invalid config accepted")
			}
		})
	}
}

func TestSecretMustComeFromEnvironment(t *testing.T) {
	for _, secret := range []string{"", strings.Repeat("s", 31), strings.Repeat("s", 73)} {
		t.Setenv("TEST_REPOSITORY_OIDC_SECRET", secret)
		_, err := loadTestConfig(t, validConfig)
		if err == nil || (secret != "" && strings.Contains(err.Error(), secret)) {
			t.Fatalf("invalid secret accepted or leaked: %v", err)
		}
	}
	t.Setenv("TEST_REPOSITORY_OIDC_SECRET", strings.Repeat("s", 32))
	if _, err := loadTestConfig(t, validConfig+"\nCLIENT_SECRET = \"unsafe\"\n"); err == nil {
		t.Fatal("plaintext client secret in config accepted")
	}
	if _, err := loadTestConfig(t, validConfig+"\n[OAUTH]\nENABLED = true\n"); err == nil {
		t.Fatal("authorization server config accepted")
	}
}

func TestDisabledOIDCDoesNotNeedSecret(t *testing.T) {
	input := strings.Replace(validConfig, "ENABLED = true", "ENABLED = false", 1)
	t.Setenv("TEST_REPOSITORY_OIDC_SECRET", "")
	if _, err := loadTestConfig(t, input); err != nil {
		t.Fatal(err)
	}
}

func TestConfiguredOIDCDefaultsToEnabled(t *testing.T) {
	input := strings.Replace(validConfig, "ENABLED = true\n", "", 1)
	t.Setenv("TEST_REPOSITORY_OIDC_SECRET", "")
	if _, err := loadTestConfig(t, input); err == nil {
		t.Fatal("OIDC config silently disabled when ENABLED was omitted")
	}
	t.Setenv("TEST_REPOSITORY_OIDC_SECRET", strings.Repeat("s", 32))
	conf, err := loadTestConfig(t, input)
	if err != nil || !conf.OIDC.Enabled {
		t.Fatalf("configured OIDC should be enabled: %v", err)
	}
}
