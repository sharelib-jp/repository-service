package external

import "strings"

func catalogName(s string) string {
	s = strings.TrimSpace(strings.ReplaceAll(s, "，", ","))
	if parts := strings.Split(s, ","); len(parts) == 2 {
		return strings.TrimSpace(parts[0]) + ", " + strings.TrimSpace(parts[1])
	}
	fields := strings.Fields(s)
	if len(fields) == 2 {
		return fields[0] + ", " + fields[1]
	}
	return s
}

func compactName(s string) string {
	return strings.NewReplacer(" ", "", "　", "", ",", "", "，", "").Replace(s)
}
func responsibilityRole(name, display string) string {
	compact := compactName(name)
	for _, entry := range strings.Split(display, ";") {
		p := compactName(entry)
		if compact != "" && strings.Contains(p, compact) {
			switch {
			case strings.Contains(p, "イラスト") || strings.Contains(p, "[絵]") || strings.HasSuffix(p, "絵"):
				return "絵"
			case strings.Contains(p, "[訳]") || strings.HasSuffix(p, "訳"):
				return "訳"
			case strings.Contains(p, "[編]") || strings.HasSuffix(p, "編"):
				return "編"
			case strings.Contains(p, "[著]") || strings.HasSuffix(p, "著"):
				return "著"
			}
		}
	}
	return ""
}
