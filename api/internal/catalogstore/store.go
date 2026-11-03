package catalogstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Store struct{ DB *gorm.DB }

// Read an aggregate from one consistent snapshot, rather than mixing revisions.
func (s *Store) read(ctx context.Context, fn func(*gorm.DB) error) error {
	if s.DB.Dialector.Name() == "postgres" {
		return s.DB.WithContext(ctx).Transaction(fn, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	}
	return s.DB.WithContext(ctx).Transaction(fn)
}
func New(db *gorm.DB) *Store { return &Store{DB: db} }
func lock(db *gorm.DB) *gorm.DB {
	db = db.Session(&gorm.Session{NewDB: true})
	if db.Dialector.Name() == "postgres" {
		return db.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	return db
}
func notFound(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrNotFound
	}
	return err
}
func jsonSame(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	var vx, vy any
	_ = json.Unmarshal(x, &vx)
	_ = json.Unmarshal(y, &vy)
	return reflect.DeepEqual(vx, vy)
}
func (s *Store) batch(tx *gorm.DB, actor *string, reason string) (Batch, error) {
	if len(reason) > 4000 {
		return Batch{}, invalid("reason exceeds 4000 bytes")
	}
	b := Batch{ID: uuid.NewString(), ActorID: actor, Reason: reason, Source: "api", CreatedAt: time.Now().UTC().Truncate(time.Microsecond)}
	if actor != nil {
		var u User
		if err := tx.Where("id = ?", *actor).First(&u).Error; err != nil {
			return b, err
		}
		b.ActorDisplayName = u.DisplayNameCache
	}
	return b, tx.Create(&b).Error
}
func change(tx *gorm.DB, b Batch, kind, id, bookID, copyID, operation string, before, after any) error {
	var oldData, newData JSON
	if before != nil {
		v, err := json.Marshal(before)
		if err != nil {
			return err
		}
		oldData = v
	}
	if after != nil {
		v, err := json.Marshal(after)
		if err != nil {
			return err
		}
		newData = v
	}
	var version *int64
	switch v := after.(type) {
	case Book:
		version = &v.Version
	case Copy:
		version = &v.Version
	}
	if operation == "delete" {
		switch v := before.(type) {
		case Book:
			version = &v.Version
		case Copy:
			version = &v.Version
		}
	}
	c := Change{ID: uuid.NewString(), BatchID: b.ID, EntityType: kind, EntityID: id, Operation: operation, EntityVersion: version, ChangedAt: b.CreatedAt, SchemaVersion: 1, BeforeData: oldData, AfterData: newData}
	return tx.Create(&c).Error
}
func quoted(name string) string { return `"` + strings.ReplaceAll(name, `"`, `""`) + `"` }
func getJSON(db *gorm.DB, table, idColumn, dataColumn, id string) (JSON, error) {
	db = db.Session(&gorm.Session{NewDB: true})
	var row struct{ Data JSON }
	err := db.Table(table).Select(quoted(dataColumn)+" AS data").Where(quoted(idColumn)+" = ?", id).Take(&row).Error
	return row.Data, err
}
func putJSON(db *gorm.DB, table, idColumn, dataColumn, id string, data JSON, now time.Time) error {
	row := map[string]any{idColumn: id, dataColumn: data, "CreatedAt": now, "UpdatedAt": now}
	return db.Table(table).Clauses(clause.OnConflict{Columns: []clause.Column{{Name: idColumn}}, DoUpdates: clause.AssignmentColumns([]string{dataColumn, "UpdatedAt"})}).Create(row).Error
}
func audit(now time.Time, actor *string) AuditFields {
	return AuditFields{CreatedAt: now, UpdatedAt: now, CreatedBy: actor, UpdatedBy: actor, Version: 1}
}

func getAuthority(db *gorm.DB, kind, id string) (Authority, error) {
	base := db.Session(&gorm.Session{NewDB: true})
	table, err := authorityTable(kind)
	if err != nil {
		return Authority{}, err
	}
	var a Authority
	if err := db.Table(table).Where(`"Id" = ?`, id).Take(&a).Error; err != nil {
		return a, notFound(err)
	}
	a.References, err = getJSON(base, referenceTable(kind), referenceIDColumn(kind), "Reference", id)
	return a, err
}
func (s *Store) Authority(ctx context.Context, kind, id string) (Authority, error) {
	var result Authority
	err := s.read(ctx, func(tx *gorm.DB) error { var err error; result, err = getAuthority(tx, kind, id); return err })
	return result, err
}
func saveAuthority(tx *gorm.DB, b Batch, kind string, a Authority) (Authority, error) {
	table, err := authorityTable(kind)
	if err != nil {
		return a, err
	}
	if err := normalizeAuthority(&a); err != nil {
		return a, err
	}
	var before *Authority
	operation := "create"
	if a.ID == "" {
		a.ID = newID()
		a.CreatedAt = b.CreatedAt
		a.UpdatedAt = b.CreatedAt

	} else {
		if !validID(a.ID) {
			return a, invalid("invalid authority ID")
		}
		old, err := getAuthority(lock(tx), kind, a.ID)
		if err != nil {
			return a, err
		}
		if a.UpdatedAt.IsZero() || !a.UpdatedAt.Equal(old.UpdatedAt) {
			return a, ErrConflict
		}
		desired := a
		desired.CreatedAt = old.CreatedAt
		if jsonSame(desired, old) {
			return old, nil
		}
		before = &old
		operation = "update"
		a.CreatedAt = old.CreatedAt
		a.UpdatedAt = b.CreatedAt
		if !a.UpdatedAt.After(old.UpdatedAt) {
			a.UpdatedAt = old.UpdatedAt.Add(time.Microsecond)
		}
	}
	if before == nil {
		if err := tx.Table(table).Create(&a).Error; err != nil {
			return a, dbError(err)
		}
	} else {
		result := tx.Table(table).Where(`"Id" = ? AND "UpdatedAt" = ?`, a.ID, before.UpdatedAt).Select("*").Updates(&a)
		if result.Error != nil {
			return a, result.Error
		}
		if result.RowsAffected != 1 {
			return a, ErrConflict
		}
	}
	if err := putJSON(tx, referenceTable(kind), referenceIDColumn(kind), "Reference", a.ID, a.References, b.CreatedAt); err != nil {
		return a, err
	}
	var old any
	if before != nil {
		old = *before
	}
	return a, change(tx, b, kind+"_authority", a.ID, "", "", operation, old, a)
}
func (s *Store) SaveAuthority(ctx context.Context, kind string, a Authority, actor *string, reason string) (Authority, error) {
	var saved Authority
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		b, err := s.batch(tx, actor, reason)
		if err != nil {
			return err
		}
		saved, err = saveAuthority(tx, b, kind, a)
		return err
	})
	return saved, dbError(err)
}
func escapeLike(q string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(strings.ToLower(q)) + "%"
}
func (s *Store) Authorities(ctx context.Context, kind string, opts ListOptions) (Page[Authority], error) {
	o := opts.normalized()
	out := Page[Authority]{Items: []Authority{}, Page: o.Page, PageSize: o.PageSize}
	table, err := authorityTable(kind)
	if err != nil {
		return out, err
	}
	query := s.DB.WithContext(ctx).Table(quoted(table) + " AS a")
	if term := strings.TrimSpace(o.Query); term != "" {
		p := escapeLike(term)
		query = query.Where(`(LOWER(a."Id") LIKE ? ESCAPE '\' OR LOWER(a."Title") LIKE ? ESCAPE '\' OR LOWER(a."TitleTranscription") LIKE ? ESCAPE '\' OR LOWER(CAST(a."TitleAlternative" AS TEXT)) LIKE ? ESCAPE '\' OR EXISTS (SELECT 1 FROM `+quoted(referenceTable(kind))+` r WHERE r.`+quoted(referenceIDColumn(kind))+` = a."Id" AND LOWER(CAST(r."Reference" AS TEXT)) LIKE ? ESCAPE '\'))`, p, p, p, p, p)
	}
	if err := query.Count(&out.Total).Error; err != nil {
		return out, err
	}
	var rows []Authority
	if err := query.Select("a.*").Order(`a."Title", a."Id"`).Limit(o.PageSize).Offset((o.Page - 1) * o.PageSize).Find(&rows).Error; err != nil {
		return out, err
	}
	for _, row := range rows {
		a, err := getAuthority(s.DB.WithContext(ctx), kind, row.ID)
		if err != nil {
			return out, err
		}
		out.Items = append(out.Items, a)
	}
	return out, nil
}
func getBook(db *gorm.DB, id string) (Book, error) {
	base := db.Session(&gorm.Session{NewDB: true})
	var b Book
	if err := db.Where(`"Id" = ?`, id).First(&b).Error; err != nil {
		return b, notFound(err)
	}
	db = base
	var err error
	b.Reference, err = getJSON(db, "BookReference", "BookId", "Reference", id)
	if err != nil {
		return b, err
	}
	b.OtherAttributes, err = getJSON(db, "BookOtherAttribute", "BookId", "Attribute", id)
	if err != nil {
		return b, err
	}
	var links []authorLink
	if err := db.Where(`"BookId" = ?`, id).Order(`"Position"`).Find(&links).Error; err != nil {
		return b, err
	}
	b.Authors = []BookAuthor{}
	for _, link := range links {
		a, err := getAuthority(db, "author", link.AuthorityID)
		if err != nil {
			return b, err
		}
		b.Authors = append(b.Authors, BookAuthor{AuthorityID: link.AuthorityID, Position: link.Position, Role: link.Role, Authority: &a})
	}
	if b.PublisherID != nil {
		a, err := getAuthority(db, "publisher", *b.PublisherID)
		if err != nil {
			return b, err
		}
		b.Publisher = &a
	}
	b.Copies = []Copy{}
	err = db.Where(`"BookId" = ?`, id).Order(`"ManagementCode", "Id"`).Find(&b.Copies).Error
	return b, err
}
func (s *Store) Book(ctx context.Context, id string) (Book, error) {
	var result Book
	err := s.read(ctx, func(tx *gorm.DB) error { var err error; result, err = getBook(tx, id); return err })
	return result, err
}
func bookSnapshot(b Book) Book {
	b.Copies = nil
	b.DeletedCopies = nil
	b.Publisher = nil
	b.Authors = append([]BookAuthor(nil), b.Authors...)
	for i := range b.Authors {
		b.Authors[i].Authority = nil
	}
	return b
}

func (s *Store) SaveBook(ctx context.Context, b Book, actor *string, reason string) (Book, error) {
	var saved Book
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := normalizeBook(&b); err != nil {
			return err
		}
		batch, err := s.batch(tx, actor, reason)
		if err != nil {
			return err
		}
		var before *Book
		operation := "create"
		if b.ID == "" {
			if b.Version != 0 {
				return invalid("new book must not have a version")
			}
			b.ID = newID()
			b.AuditFields = audit(batch.CreatedAt, actor)
		} else {
			if !validID(b.ID) {
				return invalid("invalid book ID")
			}
			old, err := getBook(lock(tx), b.ID)
			if err != nil {
				return err
			}
			if b.Version < 1 || b.Version != old.Version {
				return ErrConflict
			}
			before = &old
			operation = "update"
			b.AuditFields = old.AuditFields
			b.Version++
			b.UpdatedAt = batch.CreatedAt
			b.UpdatedBy = actor
		}
		for i := range b.Authors {
			link := &b.Authors[i]
			if link.Authority != nil {
				if link.AuthorityID != "" && link.Authority.ID != link.AuthorityID {
					return invalid("author ID does not match authority")
				}
				a, err := saveAuthority(tx, batch, "author", *link.Authority)
				if err != nil {
					return err
				}
				link.AuthorityID = a.ID
				link.Authority = &a
			} else {
				a, err := getAuthority(tx, "author", link.AuthorityID)
				if err != nil {
					return err
				}
				link.Authority = &a
			}
		}
		if b.Publisher != nil {
			if b.PublisherID != nil && *b.PublisherID != b.Publisher.ID {
				return invalid("publisher ID does not match authority")
			}
			a, err := saveAuthority(tx, batch, "publisher", *b.Publisher)
			if err != nil {
				return err
			}
			b.PublisherID = &a.ID
			b.Publisher = &a
		} else if b.PublisherID != nil {
			if *b.PublisherID == "" {
				b.PublisherID = nil
			} else {
				a, err := getAuthority(tx, "publisher", *b.PublisherID)
				if err != nil {
					return err
				}
				b.Publisher = &a
			}
		}
		if before == nil {
			if err := tx.Create(&b).Error; err != nil {
				return dbError(err)
			}
		} else {
			r := tx.Model(&Book{}).Where(`"Id" = ? AND "Version" = ?`, b.ID, before.Version).Select("*").Updates(&b)
			if r.Error != nil {
				return r.Error
			}
			if r.RowsAffected != 1 {
				return ErrConflict
			}
		}
		if err := tx.Where(`"BookId" = ?`, b.ID).Delete(&authorLink{}).Error; err != nil {
			return err
		}
		for _, author := range b.Authors {
			if err := tx.Create(&authorLink{BookID: b.ID, AuthorityID: author.AuthorityID, Position: author.Position, Role: author.Role}).Error; err != nil {
				return err
			}
		}
		if err := putJSON(tx, "BookReference", "BookId", "Reference", b.ID, b.Reference, batch.CreatedAt); err != nil {
			return err
		}
		if err := putJSON(tx, "BookOtherAttribute", "BookId", "Attribute", b.ID, b.OtherAttributes, batch.CreatedAt); err != nil {
			return err
		}

		seen := map[string]bool{}
		for _, copy := range b.Copies {
			if copy.ID != "" {
				if seen[copy.ID] {
					return invalid("duplicate copy operation")
				}
				seen[copy.ID] = true
			}
			if copy.BookID != "" && copy.BookID != b.ID {
				return invalid("copy belongs to another book")
			}
			copy.BookID = b.ID
			if _, err := saveCopy(tx, batch, copy); err != nil {
				return err
			}
		}
		for _, deleted := range b.DeletedCopies {
			id := deleted.ID
			if deleted.Version < 1 {
				return invalid("copy deletion requires a version")
			}
			if seen[id] {
				return invalid("copy updated and deleted in the same request")
			}
			seen[id] = true
			if err := deleteCopy(tx, batch, id, b.ID, deleted.Version); err != nil {
				return err
			}
		}
		saved, err = getBook(tx, b.ID)
		if err != nil {
			return err
		}
		var old any
		if before != nil {
			old = bookSnapshot(*before)
		}
		return change(tx, batch, "book", b.ID, b.ID, "", operation, old, bookSnapshot(saved))
	})
	return saved, dbError(err)
}

func saveCopy(tx *gorm.DB, b Batch, c Copy) (Copy, error) {
	if err := normalizeCopy(&c); err != nil {
		return c, err
	}
	var before *Copy
	operation := "create"
	if c.ID == "" {
		if c.Version != 0 {
			return c, invalid("new copy must not have a version")
		}
		c.ID = newID()
		c.AuditFields = audit(b.CreatedAt, b.ActorID)
	} else {
		old, err := getCopy(lock(tx), c.ID, false)
		if err != nil {
			return c, err
		}
		if old.BookID != c.BookID {
			return c, invalid("copy belongs to another book")
		}
		if c.Version < 1 || c.Version != old.Version {
			return c, ErrConflict
		}
		desired := c
		desired.AuditFields = old.AuditFields
		if jsonSame(desired, old) {
			return old, nil
		}
		before = &old
		operation = "update"
		c.AuditFields = old.AuditFields
		c.Version++
		c.UpdatedAt = b.CreatedAt
		c.UpdatedBy = b.ActorID
	}
	if before == nil {
		if err := tx.Create(&c).Error; err != nil {
			return c, dbError(err)
		}
	} else {
		r := tx.Model(&Copy{}).Where(`"Id" = ? AND "Version" = ?`, c.ID, before.Version).Select("*").Updates(&c)
		if r.Error != nil {
			return c, dbError(r.Error)
		}
		if r.RowsAffected != 1 {
			return c, ErrConflict
		}
	}
	var old any
	if before != nil {
		old = *before
	}
	return c, change(tx, b, "copy", c.ID, c.BookID, c.ID, operation, old, c)
}
func getCopy(db *gorm.DB, id string, _ bool) (Copy, error) {
	var c Copy
	err := db.Where(`"Id" = ?`, id).First(&c).Error
	return c, notFound(err)
}
func (s *Store) Copy(ctx context.Context, id string) (Copy, error) {
	return getCopy(s.DB.WithContext(ctx), id, false)
}
func (s *Store) CopyByCode(ctx context.Context, code string) (Copy, error) {
	var c Copy
	err := s.DB.WithContext(ctx).Where(`"ManagementCode" = ?`, strings.TrimSpace(code)).First(&c).Error
	return c, notFound(err)
}
func (s *Store) SaveCopy(ctx context.Context, c Copy, actor *string, reason string) (Copy, error) {
	var saved Copy
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// All writes to an aggregate lock its book first, including standalone copy writes.
		var book Book
		if err := lock(tx).Where(`"Id" = ?`, c.BookID).First(&book).Error; err != nil {
			return notFound(err)
		}
		b, err := s.batch(tx, actor, reason)
		if err != nil {
			return err
		}
		saved, err = saveCopy(tx, b, c)
		return err
	})
	return saved, dbError(err)
}
func deleteCopy(tx *gorm.DB, b Batch, id, bookID string, expected int64) error {
	c, err := getCopy(lock(tx), id, false)
	if err != nil {
		return err
	}
	if bookID != "" && c.BookID != bookID {
		return invalid("copy belongs to another book")
	}
	if expected > 0 && c.Version != expected {
		return ErrConflict
	}
	r := tx.Where(`"Id" = ? AND "Version" = ?`, id, c.Version).Delete(&Copy{})
	if r.Error != nil {
		return r.Error
	}
	if r.RowsAffected != 1 {
		return ErrConflict
	}
	return change(tx, b, "copy", id, c.BookID, id, "delete", c, nil)
}
func (s *Store) DeleteCopy(ctx context.Context, id string, version int64, actor *string, reason string) error {
	if version < 1 {
		return invalid("version is required")
	}
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		c, err := getCopy(tx, id, false)
		if err != nil {
			return err
		}
		var book Book
		if err := lock(tx).Where(`"Id" = ?`, c.BookID).First(&book).Error; err != nil {
			return err
		}
		b, err := s.batch(tx, actor, reason)
		if err != nil {
			return err
		}
		return deleteCopy(tx, b, id, "", version)
	})
}
func (s *Store) DeleteBook(ctx context.Context, id string, version int64, actor *string, reason string) error {
	if version < 1 {
		return invalid("version is required")
	}
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		book, err := getBook(lock(tx), id)
		if err != nil {
			return err
		}
		if book.Version != version {
			return ErrConflict
		}
		if len(book.Copies) > 0 {
			return invalid("remove active copies before deleting a book")
		}
		b, err := s.batch(tx, actor, reason)
		if err != nil {
			return err
		}
		for _, table := range []string{"BookReference", "BookOtherAttribute", "BookAuthor"} {
			if err := tx.Table(table).Where(`"BookId" = ?`, id).Delete(map[string]any{}).Error; err != nil {
				return err
			}
		}
		r := tx.Where(`"Id" = ? AND "Version" = ?`, id, version).Delete(&Book{})
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected != 1 {
			return ErrConflict
		}
		return change(tx, b, "book", id, id, "", "delete", bookSnapshot(book), nil)
	})
}
