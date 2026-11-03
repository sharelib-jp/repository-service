package catalogstore

import (
	"context"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// UserSetting exposes identity details only through the administrator endpoints.
type UserSetting struct {
	User
	Issuer  string `json:"authIssuer"`
	Subject string `json:"authSubject"`
}
type Role struct {
	ID   string `json:"id" gorm:"primaryKey"`
	Name string `json:"name"`
}

func (Role) TableName() string { return "roles" }

type RoleSetting struct {
	Role
	UserCount int64 `json:"userCount"`
	System    bool  `json:"system"`
}
type UserUpdate struct {
	DisplayName *string   `json:"displayName"`
	Status      *string   `json:"status"`
	Roles       *[]string `json:"roles"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
type userRole struct {
	UserID string `gorm:"column:user_id"`
	RoleID string `gorm:"column:role_id"`
}

func (userRole) TableName() string { return "user_roles" }
func systemRole(id string) bool    { return id == "admin" || id == "editor" }

var roleIDPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)

func userSetting(db *gorm.DB, id string) (UserSetting, error) {
	var u User
	if err := db.Where("id = ?", id).First(&u).Error; err != nil {
		return UserSetting{}, notFound(err)
	}
	u.Roles = []string{}
	if err := db.Table("user_roles").Where("user_id = ?", id).Order("role_id").Pluck("role_id", &u.Roles).Error; err != nil {
		return UserSetting{}, err
	}
	return UserSetting{User: u, Issuer: u.AuthIssuer, Subject: u.AuthSubject}, nil
}
func (s *Store) Users(ctx context.Context, opts ListOptions) (Page[UserSetting], error) {
	o := opts.normalized()
	out := Page[UserSetting]{Items: []UserSetting{}, Page: o.Page, PageSize: o.PageSize}
	err := s.read(ctx, func(tx *gorm.DB) error {
		q := tx.Model(&User{})
		if term := strings.TrimSpace(o.Query); term != "" {
			p := escapeLike(term)
			q = q.Where(`LOWER(CAST(id AS TEXT)) LIKE ? ESCAPE '\' OR LOWER(display_name_cache) LIKE ? ESCAPE '\' OR LOWER(auth_subject) LIKE ? ESCAPE '\' OR LOWER(auth_issuer) LIKE ? ESCAPE '\'`, p, p, p, p)
		}
		if o.Status != "" {
			if o.Status != "active" && o.Status != "suspended" {
				return invalid("利用者の状態を確認してください。")
			}
			q = q.Where("status = ?", o.Status)
		}
		if err := q.Count(&out.Total).Error; err != nil {
			return err
		}
		var ids []string
		if err := q.Order("created_at DESC, id").Limit(o.PageSize).Offset((o.Page-1)*o.PageSize).Pluck("id", &ids).Error; err != nil {
			return err
		}
		for _, id := range ids {
			u, err := userSetting(tx, id)
			if err != nil {
				return err
			}
			out.Items = append(out.Items, u)
		}
		return nil
	})
	return out, err
}

func (s *Store) UpdateUser(ctx context.Context, id string, update UserUpdate, actor *string, reason string) (UserSetting, error) {
	var result UserSetting
	if _, err := uuid.Parse(id); err != nil {
		return result, invalid("利用者 ID を確認してください。")
	}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Serialize membership edits and role deletion, including the last-admin check.
		var roles []Role
		if err := lock(tx).Order("id").Find(&roles).Error; err != nil {
			return err
		}
		var oldUser User
		if err := lock(tx).Where("id = ?", id).First(&oldUser).Error; err != nil {
			return notFound(err)
		}
		before, err := userSetting(tx, id)
		if err != nil {
			return err
		}
		if update.UpdatedAt.IsZero() || !update.UpdatedAt.Equal(before.UpdatedAt) {
			return ErrConflict
		}
		next := before
		if update.DisplayName != nil {
			next.DisplayNameCache = strings.TrimSpace(*update.DisplayName)
		}
		if utf8.RuneCountInString(next.DisplayNameCache) > 200 {
			return invalid("表示名は200文字以内で入力してください。")
		}
		if update.Status != nil {
			next.Status = *update.Status
		}
		if next.Status != "active" && next.Status != "suspended" {
			return invalid("利用者の状態を確認してください。")
		}
		if update.Roles != nil {
			known := map[string]bool{}
			for _, role := range roles {
				known[role.ID] = true
			}
			next.Roles = []string{}
			seen := map[string]bool{}
			for _, role := range *update.Roles {
				if !known[role] || seen[role] {
					return invalid("存在するロールを重複なく指定してください。")
				}
				seen[role] = true
				next.Roles = append(next.Roles, role)
			}
			sort.Strings(next.Roles)
		}
		isAdmin := func(u UserSetting) bool {
			if u.Status != "active" {
				return false
			}
			for _, role := range u.Roles {
				if role == "admin" {
					return true
				}
			}
			return false
		}
		if isAdmin(before) && !isAdmin(next) {
			var remaining int64
			if err := tx.Table("users AS u").Joins("JOIN user_roles AS ur ON ur.user_id = u.id").Where("ur.role_id = ? AND u.status = ? AND u.id <> ?", "admin", "active", id).Count(&remaining).Error; err != nil {
				return err
			}
			if remaining == 0 {
				return invalid("最後の有効な管理者は停止・権限解除できません。")
			}
		}
		if jsonSame(before, next) {
			result = before
			return nil
		}
		batch, err := s.batch(tx, actor, reason)
		if err != nil {
			return err
		}
		next.UpdatedAt = batch.CreatedAt
		if !next.UpdatedAt.After(before.UpdatedAt) {
			next.UpdatedAt = before.UpdatedAt.Add(time.Microsecond)
		}
		// The row is locked and its timestamp was compared above. SQLite's SQL
		// timestamp defaults and driver timestamps use different text formats.
		r := tx.Model(&User{}).Where("id = ?", id).Updates(map[string]any{"display_name_cache": next.DisplayNameCache, "status": next.Status, "updated_at": next.UpdatedAt})
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected != 1 {
			return ErrConflict
		}
		if err := tx.Where("user_id = ?", id).Delete(&userRole{}).Error; err != nil {
			return err
		}
		for _, role := range next.Roles {
			if err := tx.Create(&userRole{UserID: id, RoleID: role}).Error; err != nil {
				return err
			}
		}
		result, err = userSetting(tx, id)
		if err != nil {
			return err
		}
		return change(tx, batch, "user", id, "", "", "update", before, result)
	})
	return result, dbError(err)
}

func (s *Store) Roles(ctx context.Context) ([]RoleSetting, error) {
	items := []RoleSetting{}
	err := s.DB.WithContext(ctx).Table("roles AS r").Select("r.id, r.name, COUNT(ur.user_id) AS user_count").Joins("LEFT JOIN user_roles AS ur ON ur.role_id = r.id").Group("r.id, r.name").Order("r.id").Scan(&items).Error
	for i := range items {
		items[i].System = systemRole(items[i].ID)
	}
	return items, err
}
func (s *Store) SaveRole(ctx context.Context, role Role, previousName *string, actor *string, reason string) (Role, error) {
	role.Name = strings.TrimSpace(role.Name)
	if !roleIDPattern.MatchString(role.ID) || role.Name == "" || utf8.RuneCountInString(role.Name) > 100 {
		return role, invalid("ロール ID は英小文字から始まる英小文字・数字・ハイフン・アンダースコア64文字以内、名称は1〜100文字で入力してください。")
	}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var before Role
		operation := "create"
		if previousName != nil {
			if err := lock(tx).Where("id = ?", role.ID).First(&before).Error; err != nil {
				return notFound(err)
			}
			if before.Name != *previousName {
				return ErrConflict
			}
			if before.Name == role.Name {
				return nil
			}
			operation = "update"
		}
		batch, err := s.batch(tx, actor, reason)
		if err != nil {
			return err
		}
		if previousName == nil {
			if err := tx.Create(&role).Error; err != nil {
				return dbError(err)
			}
		} else {
			if err := tx.Model(&Role{}).Where("id = ?", role.ID).Update("name", role.Name).Error; err != nil {
				return err
			}
		}
		var old any
		if previousName != nil {
			old = before
		}
		return change(tx, batch, "role", role.ID, "", "", operation, old, role)
	})
	return role, dbError(err)
}
func (s *Store) DeleteRole(ctx context.Context, id, previousName string, actor *string, reason string) error {
	if systemRole(id) {
		return invalid("管理者・編集者ロールは削除できません。")
	}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var role Role
		if err := lock(tx).Where("id = ?", id).First(&role).Error; err != nil {
			return notFound(err)
		}
		if role.Name != previousName {
			return ErrConflict
		}
		var count int64
		if err := tx.Model(&userRole{}).Where("role_id = ?", id).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return invalid("利用者に割り当てられているロールは削除できません。")
		}
		batch, err := s.batch(tx, actor, reason)
		if err != nil {
			return err
		}
		if err := tx.Delete(&role).Error; err != nil {
			return err
		}
		return change(tx, batch, "role", id, "", "", "delete", role, nil)
	})
	return dbError(err)
}
