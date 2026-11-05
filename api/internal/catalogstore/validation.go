package catalogstore

import (
	"errors"
	"fmt"
	"gorm.io/gorm"
	"regexp"
	"strings"
	"time"
)

var yearPattern = regexp.MustCompile(`^[0-9]{4}$`)

func validateDate(value, precision OptionalText) error {
	if value == "" && precision == "" {
		return nil
	}
	switch precision {
	case "year_only":
		if yearPattern.MatchString(string(value)) && value != "0000" {
			return nil
		}
	case "year_month":
		if _, err := time.Parse("2006-01", string(value)); err == nil && len(value) == 7 && !strings.HasPrefix(string(value), "0000") {
			return nil
		}
	case "exact":
		if _, err := time.Parse("2006-01-02", string(value)); err == nil && len(value) == 10 && !strings.HasPrefix(string(value), "0000") {
			return nil
		}
	}
	return invalid("date does not match its precision")
}
func normalizeAuthority(a *Authority) error {
	a.Title = strings.TrimSpace(a.Title)
	if a.Title == "" || len(a.Title) > 10000 {
		return invalid("authority title is required and must be at most 10000 bytes")
	}
	if a.Type == "" {
		a.Type = "Other"
	}
	if a.Type != "Person" && a.Type != "Organization" && a.Type != "Other" {
		return invalid("unknown authority type")
	}
	if a.AlternativeTitles == nil {
		a.AlternativeTitles = Aliases{}
	}
	if a.References == nil {
		a.References = Object()
	}
	if !validObject(a.References) {
		return invalid("authority alternatives must be an array and references an object")
	}
	for _, alias := range a.AlternativeTitles {
		if strings.TrimSpace(alias.Title) == "" {
			return invalid("alternative title is required")
		}
	}
	if err := validateDate(a.BirthDate, a.BirthDatePrecision); err != nil {
		return err
	}
	if err := validateDate(a.FoundationDate, a.FoundationDatePrecision); err != nil {
		return err
	}
	if a.Type == "Person" && a.FoundationDate != "" {
		return invalid("a person cannot have a foundation date")
	}
	if a.Type == "Organization" && a.BirthDate != "" {
		return invalid("an organization cannot have a birth date")
	}
	return nil
}
func normalizeBook(b *Book) error {
	b.Title = strings.TrimSpace(b.Title)
	if b.Title == "" || len(b.Title) > 10000 {
		return invalid("book title is required and must be at most 10000 bytes")
	}
	b.Volume = strings.TrimSpace(b.Volume)
	if len(b.Volume) > 1000 {
		return invalid("book volume must be at most 1000 bytes")
	}
	if b.Reference == nil {
		b.Reference = Object()
	}
	if b.OtherAttributes == nil {
		b.OtherAttributes = Object()
	}
	if !validObject(b.Reference) || !validObject(b.OtherAttributes) {
		return invalid("reference and otherAttributes must be objects")
	}
	if err := validateDate(b.FirstPublishDate, b.FirstPublishDatePrecision); err != nil {
		return err
	}
	if b.Authors == nil {
		b.Authors = []BookAuthor{}
	}
	if len(b.Authors) > 100 || len(b.Copies) > 1000 {
		return invalid("too many related records")
	}
	for i := range b.Authors {
		b.Authors[i].Position = i + 1
	}
	return nil
}
func normalizeCopy(c *Copy) error {
	c.ManagementCode = strings.TrimSpace(c.ManagementCode)
	if c.ManagementCode == "" || len(c.ManagementCode) > 256 || strings.ContainsAny(c.ManagementCode, "\x00\r\n") {
		return invalid("managementCode is required and must be at most 256 bytes")
	}
	if c.Condition == "" {
		c.Condition = "normal"
	}
	if c.LoanPolicy == "" {
		c.LoanPolicy = "available"
	}
	switch c.Condition {
	case "normal", "lost", "damaged", "stolen", "unknown":
	default:
		return invalid("unknown copy status")
	}
	switch c.LoanPolicy {
	case "available", "suspended", "no_loan", "in_library_only", "no_access":
	default:
		return invalid("unknown loan label")
	}
	return nil
}
func dbError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return ErrConflict
	}
	if errors.Is(err, gorm.ErrForeignKeyViolated) {
		return invalid("referenced record does not exist")
	}
	text := strings.ToLower(err.Error())
	if strings.Contains(text, "unique constraint") || strings.Contains(text, "duplicate key") {
		return fmt.Errorf("%w: identifier is already registered", ErrConflict)
	}
	return err
}
