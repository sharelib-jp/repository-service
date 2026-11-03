package migrations

import (
	"crypto/sha256"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sharelib-jp/repository-service/internal/database"
)

func TestUpgradeSeedsRolesWithoutChangingExistingSettings(t *testing.T) {
	db, err := database.OpenWithDriver("sqlite", filepath.Join(t.TempDir(), "upgrade.db")+"?_foreign_keys=on")
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	defer pool.Close()
	initial, err := files.ReadFile("sqlite/001_catalog.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range strings.Split(string(initial), ";") {
		if strings.TrimSpace(statement) != "" {
			if err := db.Exec(statement).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := db.Exec("CREATE TABLE repository_schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO repository_schema_migrations VALUES (1,?)", fmt.Sprintf("%x", sha256.Sum256(initial))).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO roles(id,name) VALUES ('editor','図書館員')").Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := Apply(db); err != nil {
			t.Fatal(err)
		}
	}
	var role struct{ Name string }
	if err := db.Table("roles").Where("id = ?", "editor").Take(&role).Error; err != nil {
		t.Fatal(err)
	}
	if role.Name != "図書館員" {
		t.Fatal("overwrote the existing role name")
	}
	var count int64
	db.Table("roles").Where("id = ?", "admin").Count(&count)
	if count != 1 {
		t.Fatal("missing administrator role")
	}
	db.Table("user_roles").Count(&count)
	if count != 0 {
		t.Fatal("automatically granted privileges")
	}
}
