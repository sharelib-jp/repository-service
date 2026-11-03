package config

import (
	"strings"
	"testing"
)

func TestApplicationNameInMetadata(t *testing.T) {
	t.Setenv("TEST_REPOSITORY_OIDC_SECRET", strings.Repeat("s", 32))
	conf, err := loadTestConfig(t, validConfig+"\n[METADATA]\nAPPLICATION_NAME = \"Repository Service\"\n")
	if err != nil {
		t.Fatal(err)
	}
	if conf.Metadata.ApplicationName != "Repository Service" {
		t.Fatalf("application name = %q", conf.Metadata.ApplicationName)
	}
}
