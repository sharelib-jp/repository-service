package catalogstore

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"gorm.io/gorm/clause"
	"strings"
)

type CopyListItem struct {
	Copy
	BibliographicID string   `json:"bibliographicId"`
	Title           string   `json:"title"`
	Author          string   `json:"author"`
	Publisher       string   `json:"publisher"`
	AuthorIDs       []string `json:"authorIds"`
	HasLoanHistory  *bool    `json:"hasLoanHistory"`
}

func (s *Store) Copies(ctx context.Context, opts ListOptions) (Page[CopyListItem], error) {
	o := opts.normalized()
	out := Page[CopyListItem]{Items: []CopyListItem{}, Page: o.Page, PageSize: o.PageSize}
	q := s.DB.WithContext(ctx).Table(`"Copy" AS c`).Joins(`JOIN "Book" AS b ON b."Id" = c."BookId"`)
	if term := strings.TrimSpace(o.Query); term != "" {
		p := escapeLike(term)
		q = q.Where(`(LOWER(c."ManagementCode") LIKE ? ESCAPE '\' OR LOWER(b."Title") LIKE ? ESCAPE '\' OR LOWER(b."AuthorSummary") LIKE ? ESCAPE '\' OR LOWER(b."PublisherSummary") LIKE ? ESCAPE '\')`, p, p, p, p)
	}
	if o.AuthorID != "" {
		q = q.Where(`EXISTS (SELECT 1 FROM "BookAuthor" ba WHERE ba."BookId" = b."Id" AND ba."AuthorId" = ?)`, o.AuthorID)
	}
	if o.Status != "" {
		q = q.Where(`c."Condition" = ?`, o.Status)
	}
	if err := q.Count(&out.Total).Error; err != nil {
		return out, err
	}
	var copies []Copy
	if err := q.Select("c.*").Order(`c."UpdatedAt" DESC, c."Id"`).Limit(o.PageSize).Offset((o.Page - 1) * o.PageSize).Find(&copies).Error; err != nil {
		return out, err
	}
	for _, copy := range copies {
		var book Book
		if err := s.DB.WithContext(ctx).Where(`"Id" = ?`, copy.BookID).First(&book).Error; err != nil {
			return out, err
		}
		var ids []string
		if err := s.DB.WithContext(ctx).Model(&authorLink{}).Where(`"BookId" = ?`, book.ID).Order(`"Position"`).Pluck("AuthorId", &ids).Error; err != nil {
			return out, err
		}
		if ids == nil {
			ids = []string{}
		}
		out.Items = append(out.Items, CopyListItem{Copy: copy, BibliographicID: book.ID, Title: book.Title, Author: book.AuthorSummary, Publisher: book.PublisherSummary, AuthorIDs: ids})
	}
	return out, nil
}
func (s *Store) Books(ctx context.Context, opts ListOptions) (Page[Book], error) {
	o := opts.normalized()
	out := Page[Book]{Items: []Book{}, Page: o.Page, PageSize: o.PageSize}
	q := s.DB.WithContext(ctx).Model(&Book{})
	if term := strings.TrimSpace(o.Query); term != "" {
		p := escapeLike(term)
		q = q.Where(`LOWER("Title") LIKE ? ESCAPE '\' OR LOWER("AuthorSummary") LIKE ? ESCAPE '\'`, p, p)
	}
	if o.AuthorID != "" {
		q = q.Where(`EXISTS (SELECT 1 FROM "BookAuthor" ba WHERE ba."BookId" = "Book"."Id" AND ba."AuthorId" = ?)`, o.AuthorID)
	}
	if err := q.Count(&out.Total).Error; err != nil {
		return out, err
	}
	var ids []string
	if err := q.Order(`"UpdatedAt" DESC, "Id"`).Limit(o.PageSize).Offset((o.Page-1)*o.PageSize).Pluck("Id", &ids).Error; err != nil {
		return out, err
	}
	for _, id := range ids {
		b, err := s.Book(ctx, id)
		if err != nil {
			return out, err
		}
		out.Items = append(out.Items, b)
	}
	return out, nil
}
func (s *Store) History(ctx context.Context, entity, id string, opts ListOptions) (Page[Change], error) {
	o := opts.normalized()
	out := Page[Change]{Items: []Change{}, Page: o.Page, PageSize: o.PageSize}
	db := s.DB.WithContext(ctx)
	q := db.Model(&Change{})
	switch entity {
	case "book":
		q = q.Where(`"EntityType" = 'book' AND "EntityId" = ?`, id)
	case "copy":
		copy, err := getCopy(db, id, true)
		if err == ErrNotFound {
			var latest Change
			if e := db.Where(`"EntityType" = 'copy' AND "EntityId" = ?`, id).Order(`"CreatedAt" DESC`).First(&latest).Error; e != nil {
				return out, notFound(e)
			}
			snapshot := latest.AfterData
			if snapshot == nil {
				snapshot = latest.BeforeData
			}
			if e := json.Unmarshal(snapshot, &copy); e != nil {
				return out, e
			}
		} else if err != nil {
			return out, err
		}
		q = q.Where(`("EntityType" = 'copy' AND "EntityId" = ?) OR ("EntityType" = 'book' AND "EntityId" = ?)`, id, copy.BookID)
	default:
		return out, invalid("unknown history entity")
	}
	if err := q.Count(&out.Total).Error; err != nil {
		return out, err
	}
	if err := q.Order(`"CreatedAt" DESC, "Id"`).Limit(o.PageSize).Offset((o.Page - 1) * o.PageSize).Find(&out.Items).Error; err != nil {
		return out, err
	}
	for i := range out.Items {
		var batch Batch
		if err := db.Where(`"Id" = ?`, out.Items[i].BatchID).First(&batch).Error; err != nil {
			return out, err
		}
		out.Items[i].Reason = batch.Reason
		if batch.ActorID != nil {
			name := batch.ActorDisplayName
			if name == "" {
				name = *batch.ActorID
			}
			out.Items[i].Actor = &name
		}
	}
	return out, nil
}
func (s *Store) ResolveUser(ctx context.Context, issuer, subject, name string) (User, error) {
	u := User{ID: uuid.NewString(), AuthIssuer: issuer, AuthSubject: subject, Status: "active", DisplayNameCache: name}
	db := s.DB.WithContext(ctx)
	if err := db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "auth_issuer"}, {Name: "auth_subject"}}, DoNothing: true}).Create(&u).Error; err != nil {
		return User{}, err
	}
	u = User{}
	if err := db.Where("auth_issuer = ? AND auth_subject = ?", issuer, subject).First(&u).Error; err != nil {
		return u, err
	}
	u.Roles = []string{}
	if err := db.Table("user_roles").Where("user_id = ?", u.ID).Order("role_id").Pluck("role_id", &u.Roles).Error; err != nil {
		return u, err
	}
	return u, nil
}
