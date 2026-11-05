// Package catalogstore owns the repository's catalog data and change history.
package catalogstore

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

var (
	ErrNotFound = errors.New("record not found")
	ErrConflict = errors.New("record changed or identifier already exists")
	ErrInvalid  = errors.New("invalid record")
)

type JSON json.RawMessage

func (j JSON) Value() (driver.Value, error) {
	if j == nil {
		return nil, nil
	}
	if !json.Valid(j) {
		return nil, ErrInvalid
	}
	return string(j), nil
}
func (j *JSON) Scan(value any) error {
	switch v := value.(type) {
	case nil:
		*j = nil
	case string:
		*j = append((*j)[:0], v...)
	case []byte:
		*j = append((*j)[:0], v...)
	default:
		return fmt.Errorf("unsupported JSON database value %T", value)
	}
	return nil
}
func (JSON) GormDataType() string { return "json" }
func (JSON) GormDBDataType(db *gorm.DB, _ *schema.Field) string {
	if db.Dialector.Name() == "postgres" {
		return "JSONB"
	}
	return "TEXT"
}
func (j JSON) MarshalJSON() ([]byte, error) {
	if j == nil {
		return []byte("null"), nil
	}
	return j, nil
}
func (j *JSON) UnmarshalJSON(data []byte) error {
	if !json.Valid(data) {
		return ErrInvalid
	}
	*j = append((*j)[:0], data...)
	return nil
}
func Object() JSON { return JSON(`{}`) }
func Array() JSON  { return JSON(`[]`) }
func validObject(value JSON) bool {
	var obj map[string]any
	return json.Unmarshal(value, &obj) == nil && obj != nil
}
func validArray(value JSON) bool {
	var obj []any
	return json.Unmarshal(value, &obj) == nil && obj != nil
}
func newID() string { return ulid.Make().String() }
func validID(id string) bool {
	_, err := ulid.ParseStrict(id)
	return err == nil && id == strings.ToUpper(id)
}
func invalid(message string) error { return fmt.Errorf("%w: %s", ErrInvalid, message) }

type AlternativeTitle struct {
	Title         string `json:"title"`
	Transcription string `json:"transcription"`
	Language      string `json:"language"`
}
type Aliases []AlternativeTitle

func (a Aliases) GormDataType() string { return "json" }
func (a Aliases) GormDBDataType(db *gorm.DB, f *schema.Field) string {
	return JSON(nil).GormDBDataType(db, f)
}
func (a Aliases) Value() (driver.Value, error) {
	values := make([]map[string]string, 0, len(a))
	for _, title := range a {
		values = append(values, map[string]string{"Title": title.Title, "TitleTranscription": title.Transcription, "TitleLanguage": title.Language})
	}
	raw, err := json.Marshal(values)
	return string(raw), err
}
func (a *Aliases) Scan(value any) error {
	var raw JSON
	if err := raw.Scan(value); err != nil {
		return err
	}
	var titles []struct {
		Title              string
		TitleTranscription string
		TitleLanguage      string
	}
	if err := json.Unmarshal(raw, &titles); err != nil {
		return err
	}
	*a = Aliases{}
	for _, title := range titles {
		*a = append(*a, AlternativeTitle{Title: title.Title, Transcription: title.TitleTranscription, Language: title.TitleLanguage})
	}
	return nil
}

type OptionalText string

func (s OptionalText) Value() (driver.Value, error) {
	if s == "" {
		return nil, nil
	}
	return string(s), nil
}
func (s *OptionalText) Scan(v any) error {
	switch x := v.(type) {
	case nil:
		*s = ""
	case string:
		*s = OptionalText(x)
	case []byte:
		*s = OptionalText(x)
	default:
		return fmt.Errorf("invalid optional text %T", v)
	}
	return nil
}
func (s *OptionalText) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		*s = ""
		return nil
	}
	var v string
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	*s = OptionalText(v)
	return nil
}

type AuditFields struct {
	CreatedAt time.Time `json:"createdAt" gorm:"column:CreatedAt;autoCreateTime:false"`
	UpdatedAt time.Time `json:"updatedAt" gorm:"column:UpdatedAt;autoUpdateTime:false"`
	CreatedBy *string   `json:"createdBy" gorm:"column:CreatedBy"`
	UpdatedBy *string   `json:"updatedBy" gorm:"column:UpdatedBy"`
	Version   int64     `json:"version" gorm:"column:Version"`
}

type Authority struct {
	ID                      string       `json:"id" gorm:"column:Id;primaryKey"`
	Type                    string       `json:"type" gorm:"column:Type"`
	Title                   string       `json:"title" gorm:"column:Title"`
	Transcription           string       `json:"transcription" gorm:"column:TitleTranscription"`
	Language                string       `json:"language" gorm:"column:TitleLanguage"`
	AlternativeTitles       Aliases      `json:"alternativeTitles" gorm:"column:TitleAlternative"`
	BirthDate               OptionalText `json:"birthDate" gorm:"column:BirthDate"`
	BirthDatePrecision      OptionalText `json:"birthDatePrecision" gorm:"column:BirthDatePrecision"`
	FoundationDate          OptionalText `json:"foundationDate" gorm:"column:FoundationDate"`
	FoundationDatePrecision OptionalText `json:"foundationDatePrecision" gorm:"column:FoundationDatePrecision"`
	References              JSON         `json:"references" gorm:"-"`
	CreatedAt               time.Time    `json:"createdAt" gorm:"column:CreatedAt;autoCreateTime:false"`
	UpdatedAt               time.Time    `json:"updatedAt" gorm:"column:UpdatedAt;autoUpdateTime:false"`
}

func authorityTable(kind string) (string, error) {
	switch kind {
	case "author":
		return "AuthorAuthority", nil
	case "publisher":
		return "PublisherAuthority", nil
	}
	return "", invalid("unknown authority kind")
}
func referenceTable(kind string) string {
	if kind == "author" {
		return "AuthorAuthorityReference"
	}
	return "PublisherAuthorityReference"
}
func referenceIDColumn(kind string) string {
	if kind == "author" {
		return "AuthorAuthorityId"
	}
	return "PublisherAuthorityId"
}

type BookAuthor struct {
	AuthorityID string     `json:"authorityId"`
	Role        string     `json:"role"`
	Position    int        `json:"position"`
	Authority   *Authority `json:"authority,omitempty" gorm:"-"`
}
type authorLink struct {
	BookID      string `gorm:"column:BookId"`
	AuthorityID string `gorm:"column:AuthorId"`
	Role        string `gorm:"column:Role"`
	Position    int    `gorm:"column:Position"`
}

func (authorLink) TableName() string { return "BookAuthor" }

type Book struct {
	ID                            string         `json:"id" gorm:"column:Id;primaryKey"`
	Title                         string         `json:"title" gorm:"column:Title"`
	TitleTranscription            string         `json:"titleTranscription" gorm:"column:TitleTranscription"`
	Volume                        string         `json:"volume" gorm:"column:Volume"`
	AuthorSummary                 string         `json:"authorSummary" gorm:"column:AuthorSummary"`
	AuthorSummaryTranscription    string         `json:"authorSummaryTranscription" gorm:"column:AuthorSummaryTranscription"`
	PublisherID                   *string        `json:"publisherId" gorm:"column:PublisherId"`
	PublisherSummary              string         `json:"publisherSummary" gorm:"column:PublisherSummary"`
	PublisherSummaryTranscription string         `json:"publisherSummaryTranscription" gorm:"column:PublisherSummaryTranscription"`
	FirstPublishDate              OptionalText   `json:"firstPublishDate" gorm:"column:FirstPublishDate"`
	FirstPublishDatePrecision     OptionalText   `json:"firstPublishDatePrecision" gorm:"column:FirstPublishDatePrecision"`
	NDC                           string         `json:"ndc" gorm:"column:NDC"`
	NDCEdition                    string         `json:"ndcEdition" gorm:"column:NDCEdition"`
	Language                      string         `json:"language" gorm:"column:Language"`
	Authors                       []BookAuthor   `json:"authors" gorm:"-"`
	Publisher                     *Authority     `json:"publisher,omitempty" gorm:"-"`
	Reference                     JSON           `json:"reference" gorm:"-"`
	OtherAttributes               JSON           `json:"otherAttributes" gorm:"-"`
	Copies                        []Copy         `json:"copies" gorm:"-"`
	DeletedCopies                 []CopyDeletion `json:"deletedCopies,omitempty" gorm:"-"`
	AuditFields                   `gorm:"embedded"`
}

func (Book) TableName() string { return "Book" }

type CopyDeletion struct {
	ID      string `json:"id"`
	Version int64  `json:"version"`
}
type Copy struct {
	ID             string     `json:"id" gorm:"column:Id;primaryKey"`
	BookID         string     `json:"bookId" gorm:"column:BookId"`
	ManagementCode string     `json:"managementCode" gorm:"column:ManagementCode"`
	DeliveredAt    *time.Time `json:"deliveredAt" gorm:"column:DeliveredAt"`
	Condition      string     `json:"condition" gorm:"column:Condition"`
	LoanPolicy     string     `json:"loanPolicy" gorm:"column:LoanPolicy"`
	AuditFields    `gorm:"embedded"`
}

func (Copy) TableName() string { return "Copy" }

type Batch struct {
	ID               string    `gorm:"column:Id;primaryKey"`
	ActorID          *string   `gorm:"column:ActorUserId"`
	ActorDisplayName string    `gorm:"column:ActorDisplayName"`
	Source           string    `gorm:"column:Source"`
	Reason           string    `gorm:"column:Reason"`
	CreatedAt        time.Time `gorm:"column:CreatedAt;autoCreateTime:false"`
}

func (Batch) TableName() string { return "ChangeBatch" }

type Change struct {
	ID            string    `json:"id" gorm:"column:Id;primaryKey"`
	BatchID       string    `json:"batchId" gorm:"column:BatchId"`
	EntityType    string    `json:"entityType" gorm:"column:EntityType"`
	EntityID      string    `json:"entityId" gorm:"column:EntityId"`
	EntityVersion *int64    `json:"entityVersion" gorm:"column:EntityVersion"`
	Operation     string    `json:"operation" gorm:"column:Operation"`
	ChangedAt     time.Time `json:"changedAt" gorm:"column:CreatedAt;autoCreateTime:false"`
	Actor         *string   `json:"actor" gorm:"-"`
	Reason        string    `json:"reason" gorm:"-"`
	SchemaVersion int       `json:"snapshotSchemaVersion" gorm:"column:SnapshotSchemaVersion"`
	BeforeData    JSON      `json:"beforeData" gorm:"column:BeforeData"`
	AfterData     JSON      `json:"afterData" gorm:"column:AfterData"`
}

func (Change) TableName() string { return "ChangeHistory" }

type User struct {
	ID               string    `json:"id" gorm:"primaryKey"`
	AuthIssuer       string    `json:"-"`
	AuthSubject      string    `json:"-"`
	Status           string    `json:"status"`
	DisplayNameCache string    `json:"displayName"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
	Roles            []string  `json:"roles" gorm:"-"`
}

func (User) TableName() string { return "users" }

type Page[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}
type ListOptions struct {
	Query    string
	AuthorID string
	Status   string
	Page     int
	PageSize int
}

func (o ListOptions) normalized() ListOptions {
	if o.Page < 1 {
		o.Page = 1
	}
	if o.PageSize < 1 {
		o.PageSize = 20
	}
	if o.PageSize > 100 {
		o.PageSize = 100
	}
	return o
}
