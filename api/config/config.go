package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/BurntSushi/toml"
)

type APIAuthConfig struct {
	IntrospectionURL string `toml:"INTROSPECTION_URL"`
	Audience         string `toml:"AUDIENCE"`
	CredentialID     string `toml:"CREDENTIAL_ID"`
	SecretEnv        string `toml:"SECRET_ENV"`
}

func (c APIAuthConfig) Secret() (string, error) {
	if !validEnvName(c.SecretEnv) {
		return "", fmt.Errorf("API_AUTH SECRET_ENV must name an environment variable")
	}
	secret := os.Getenv(c.SecretEnv)
	if len(secret) < 32 || len(secret) > 72 {
		return "", fmt.Errorf("API_AUTH credential secret must contain 32 to 72 bytes")
	}
	return secret, nil
}

type ExternalConfig struct {
	SourcesFile string `toml:"SOURCES_FILE"`
}

type Config struct {
	SCHEME   string
	HOSTNAME string
	PORT     string

	WEBAUTHN_RP_DISPLAY_NAME string
	WEBAUTHN_RP_ORIGIN       string
	DATABASE_DRIVER          string
	DATABASE_DSN             string
	APIAuth                  APIAuthConfig  `toml:"API_AUTH"`
	External                 ExternalConfig `toml:"EXTERNAL"`
	Metadata                 Metadata       `toml:"METADATA"`
	BrandResources           BrandResources `toml:"BRANDRESOURCES"`
	OIDC                     OIDCConfig     `toml:"OIDC"`
}

// OIDCConfig describes this application's client registration at an OpenID
// Provider. The client secret is loaded from the named environment variable.
type OIDCConfig struct {
	Enabled         bool     `toml:"ENABLED"`
	Issuer          string   `toml:"ISSUER"`
	ClientID        string   `toml:"CLIENT_ID"`
	RedirectURI     string   `toml:"REDIRECT_URI"`
	Scopes          []string `toml:"SCOPES"`
	ClientSecretEnv string   `toml:"CLIENT_SECRET_ENV"`
}

type BrandResources struct {
	Header     string `toml:"HEADER"`
	HeaderLogo string `toml:"HEADER_LOGO"`
}

func (b BrandResources) HeaderPath() string {
	if b.Header != "" {
		return b.Header
	}
	return b.HeaderLogo
}

type Contact struct {
	Name  string `toml:"name" json:"name"`
	Email string `toml:"email" json:"email"`
}

type Metadata struct {
	NodeName        string    `toml:"NODE_NAME" json:"nodeName"`
	ApplicationName string    `toml:"APPLICATION_NAME" json:"applicationName"`
	NodeDomain      string    `toml:"NODE_DOMAIN" json:"nodeDomain"`
	NodeAdmins      []Contact `toml:"NODE_ADMINS" json:"nodeAdmins"`
	Maintainer      []Contact `toml:"MAINTAINER" json:"maintainer"`
}

// LoadConfig loads ./config.toml by default or a caller-specified file.
func LoadConfig(paths ...string) (*Config, error) {
	if len(paths) > 1 {
		return nil, fmt.Errorf("at most one config path may be provided")
	}
	path := "./config.toml"
	if len(paths) == 1 {
		path = paths[0]
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	conf := &Config{DATABASE_DRIVER: "sqlite", DATABASE_DSN: "repository.db?_busy_timeout=5000&_foreign_keys=on&_txlock=immediate"}
	metadata, err := toml.Decode(string(data), conf)
	if err != nil {
		return nil, err
	}
	if metadata.IsDefined("OAUTH") {
		return nil, fmt.Errorf("OAUTH config is for an authorization server; use OIDC for this client")
	}
	if metadata.IsDefined("OIDC", "CLIENT_SECRET") {
		return nil, fmt.Errorf("set the OIDC client secret through its environment variable, not config.toml")
	}
	// A configured provider must not silently become disabled if ENABLED is omitted.
	if metadata.IsDefined("OIDC") && !metadata.IsDefined("OIDC", "ENABLED") {
		conf.OIDC.Enabled = true
	}
	var sections struct {
		Host struct {
			Scheme, Hostname, Port *string
		} `toml:"HOST"`
		WebAuthn struct {
			RPDisplayName *string `toml:"RP_DISPLAY_NAME"`
			RPOrigin      *string `toml:"RP_ORIGIN"`
		} `toml:"WEBAUTHN"`
		Database struct {
			Driver *string `toml:"DATABASE_DRIVER"`
			DSN    *string `toml:"DATABASE_DSN"`
		} `toml:"DATABASE"`
	}
	if _, err := toml.Decode(string(data), &sections); err != nil {
		return nil, err
	}
	for _, field := range []struct {
		src *string
		dst *string
	}{
		{sections.Host.Scheme, &conf.SCHEME},
		{sections.Host.Hostname, &conf.HOSTNAME},
		{sections.Host.Port, &conf.PORT},
		{sections.WebAuthn.RPDisplayName, &conf.WEBAUTHN_RP_DISPLAY_NAME},
		{sections.WebAuthn.RPOrigin, &conf.WEBAUTHN_RP_ORIGIN},
		{sections.Database.Driver, &conf.DATABASE_DRIVER},
		{sections.Database.DSN, &conf.DATABASE_DSN},
	} {
		if field.src != nil {
			*field.dst = *field.src
		}
	}
	if err := conf.Validate(); err != nil {
		return nil, err
	}
	return conf, nil
}

func (c *Config) Origin() string {
	if c.WEBAUTHN_RP_ORIGIN != "" {
		return c.WEBAUTHN_RP_ORIGIN
	}
	return c.SCHEME + c.HOSTNAME + c.PORT
}

func (c *Config) Validate() error {
	switch c.DATABASE_DRIVER {
	case "", "sqlite", "postgres":
	default:
		return fmt.Errorf("DATABASE_DRIVER must be sqlite or postgres")
	}
	u, err := url.Parse(c.Origin())
	if err != nil || c.HOSTNAME == "" || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("invalid application origin")
	}
	if u.Hostname() != c.HOSTNAME && !strings.HasSuffix(u.Hostname(), "."+c.HOSTNAME) {
		return fmt.Errorf("application origin must belong to HOSTNAME")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && u.Hostname() == "localhost" && c.HOSTNAME == "localhost") {
		return fmt.Errorf("application origin requires HTTPS (HTTP is allowed for localhost)")
	}
	port, err := strconv.Atoi(strings.TrimPrefix(c.PORT, ":"))
	if err != nil || !strings.HasPrefix(c.PORT, ":") || port < 1 || port > 65535 || c.DATABASE_DSN == "" {
		return fmt.Errorf("PORT and DATABASE_DSN are required")
	}
	if err := c.OIDC.Validate(); err != nil {
		return err
	}
	return nil
}

func validEnvName(name string) bool {
	if len(name) == 0 {
		return false
	}
	for i, ch := range name {
		if !((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch == '_' || (i > 0 && ch >= '0' && ch <= '9')) {
			return false
		}
	}
	return true
}

// Validate rejects insecure or incomplete OIDC client configuration.
func (c OIDCConfig) Validate() error {
	if !c.Enabled {
		return nil
	}
	issuer, err := url.Parse(c.Issuer)
	if err != nil || issuer.Hostname() == "" || issuer.User != nil || issuer.Opaque != "" || issuer.Path != "" || issuer.RawQuery != "" || issuer.ForceQuery || strings.Contains(c.Issuer, "#") || (issuer.Scheme != "https" && !(issuer.Scheme == "http" && issuer.Hostname() == "localhost")) {
		return fmt.Errorf("OIDC ISSUER must be an HTTPS origin (HTTP is allowed for localhost)")
	}
	redirect, err := url.Parse(c.RedirectURI)
	if err != nil || redirect.Hostname() == "" || redirect.User != nil || redirect.Opaque != "" || strings.Contains(c.RedirectURI, "#") || (redirect.Scheme != "https" && !(redirect.Scheme == "http" && redirect.Hostname() == "localhost")) {
		return fmt.Errorf("OIDC REDIRECT_URI must be an HTTPS URL without a fragment (HTTP is allowed for localhost)")
	}
	if len(c.ClientID) == 0 || len(c.ClientID) > 128 {
		return fmt.Errorf("OIDC CLIENT_ID must be a valid identifier")
	}
	for _, ch := range c.ClientID {
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' || ch == '.') {
			return fmt.Errorf("OIDC CLIENT_ID must be a valid identifier")
		}
	}
	if _, err := c.ClientSecret(); err != nil {
		return err
	}
	seen := make(map[string]bool, len(c.Scopes))
	for _, scope := range c.Scopes {
		if scope == "" || strings.TrimSpace(scope) != scope || strings.ContainsAny(scope, " \t\r\n\"\\") || seen[scope] {
			return fmt.Errorf("OIDC SCOPES must contain distinct valid scope values")
		}
		for _, ch := range scope {
			if ch < 0x21 || ch > 0x7e {
				return fmt.Errorf("OIDC SCOPES must contain distinct valid scope values")
			}
		}
		seen[scope] = true
	}
	if !seen["openid"] {
		return fmt.Errorf("OIDC SCOPES must include openid")
	}
	return nil
}

// ClientSecret returns the confidential-client secret without storing it in
// the configuration structure. It must also be registered at the provider.
func (c OIDCConfig) ClientSecret() (string, error) {
	if !validEnvName(c.ClientSecretEnv) {
		return "", fmt.Errorf("OIDC CLIENT_SECRET_ENV must name an environment variable")
	}
	secret := os.Getenv(c.ClientSecretEnv)
	if len(secret) < 32 || len(secret) > 72 {
		return "", fmt.Errorf("OIDC client secret in %s must be 32 to 72 bytes", c.ClientSecretEnv)
	}
	return secret, nil
}
