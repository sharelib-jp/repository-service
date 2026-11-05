package catalogstore

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"gorm.io/gorm"
)

var ErrAmbiguousAuthority = errors.New("more than one matching library authority")
var wikidataIDPattern = regexp.MustCompile(`^Q[1-9][0-9]*$`)

// MatchAuthority prefers the exact title, then the exact Wikidata item ID.
// Ambiguous matches require an explicit library authority selection.
func (s *Store) MatchAuthority(ctx context.Context, kind, title, wikidataID string) (*Authority, error) {
	title = strings.TrimSpace(title)
	if len(title) > 10000 || len(wikidataID) > 100 || (wikidataID != "" && !wikidataIDPattern.MatchString(wikidataID)) || (title == "" && wikidataID == "") {
		return nil, invalid("specify an authority title or valid Wikidata Q ID")
	}
	var result *Authority
	err := s.read(ctx, func(tx *gorm.DB) error {
		var err error
		result, err = matchAuthority(tx, kind, title, wikidataID)
		return err
	})
	return result, err
}

func matchAuthority(db *gorm.DB, kind, title, wikidataID string) (*Authority, error) {
	table, err := authorityTable(kind)
	if err != nil {
		return nil, err
	}
	find := func(query *gorm.DB) (*Authority, error) {
		var ids []string
		if err := query.Order(`a."Id"`).Limit(2).Pluck(`a."Id"`, &ids).Error; err != nil {
			return nil, err
		}
		if len(ids) > 1 {
			return nil, ErrAmbiguousAuthority
		}
		if len(ids) == 0 {
			return nil, nil
		}
		a, err := getAuthority(db, kind, ids[0])
		return &a, err
	}
	base := func() *gorm.DB { return db.Session(&gorm.Session{NewDB: true}).Table(quoted(table) + " AS a") }
	if title = strings.TrimSpace(title); title != "" {
		found, err := find(base().Where(`a."Title" = ?`, title))
		if err != nil || found != nil {
			return found, err
		}
	}
	if !wikidataIDPattern.MatchString(wikidataID) {
		return nil, nil
	}
	query := base().Joins(`JOIN ` + quoted(referenceTable(kind)) + ` r ON r.` + quoted(referenceIDColumn(kind)) + ` = a."Id"`)
	if db.Dialector.Name() == "postgres" {
		query = query.Where(`EXISTS (SELECT 1 FROM jsonb_each(r."Reference") v WHERE lower(v.key) = 'wikidata' AND v.value = to_jsonb(CAST(? AS text)))`, wikidataID)
	} else {
		query = query.Where(`EXISTS (SELECT 1 FROM json_each(r."Reference") v WHERE lower(v.key) = 'wikidata' AND v.type = 'text' AND v.value = ?)`, wikidataID)
	}
	return find(query)
}

func authorityWikidataID(a Authority) string {
	var refs map[string]any
	if json.Unmarshal(a.References, &refs) != nil {
		return ""
	}
	for key, value := range refs {
		if strings.EqualFold(key, "Wikidata") {
			if id, ok := value.(string); ok && wikidataIDPattern.MatchString(id) {
				return id
			}
		}
	}
	return ""
}

// Reusing an ID-less import never edits the shared library authority.
// Explicit ID-based edits continue to require its concurrency timestamp.
func reuseOrSaveAuthority(tx *gorm.DB, batch Batch, kind string, draft Authority) (Authority, bool, error) {
	if draft.ID == "" {
		found, err := matchAuthority(tx, kind, draft.Title, authorityWikidataID(draft))
		if err != nil {
			return Authority{}, false, err
		}
		if found != nil {
			return *found, true, nil
		}
	}
	saved, err := saveAuthority(tx, batch, kind, draft)
	return saved, false, err
}

func authorSummaries(authors []BookAuthor) (string, string) {
	var titles, readings []string
	for _, author := range authors {
		if author.Authority == nil {
			continue
		}
		appendName := func(values []string, name string) []string {
			if name == "" {
				return values
			}
			if role := strings.TrimSpace(author.Role); role != "" {
				name += " [" + role + "]"
			}
			return append(values, name)
		}
		titles = appendName(titles, author.Authority.Title)
		readings = appendName(readings, author.Authority.Transcription)
	}
	return strings.Join(titles, "; "), strings.Join(readings, "; ")
}
