package plan

import "strings"

// PlanItem represents a parsed plan section that can be imported as a draft issue.
type PlanItem struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// ParsePlanMarkdown parses markdown by H2 boundaries.
// Each "##" section becomes one plan item.
// If no H2 is found, the full document is returned as a single item titled by H1.
func ParsePlanMarkdown(content string) []PlanItem {
	normalized := strings.ReplaceAll(strings.ReplaceAll(content, "\r\n", "\n"), "\r", "\n")
	if strings.TrimSpace(normalized) == "" {
		return nil
	}

	lines := strings.Split(normalized, "\n")
	items := make([]PlanItem, 0)
	var currentTitle string
	currentBodyLines := make([]string, 0)
	hasH2 := false

	for _, line := range lines {
		if title, ok := extractHeading(line, 2); ok {
			hasH2 = true
			if currentTitle != "" {
				items = append(items, PlanItem{
					Title: currentTitle,
					Body:  strings.TrimSpace(strings.Join(currentBodyLines, "\n")),
				})
			}
			currentTitle = title
			currentBodyLines = currentBodyLines[:0]
			continue
		}

		if currentTitle != "" {
			currentBodyLines = append(currentBodyLines, line)
		}
	}

	if hasH2 && currentTitle != "" {
		items = append(items, PlanItem{
			Title: currentTitle,
			Body:  strings.TrimSpace(strings.Join(currentBodyLines, "\n")),
		})
	}

	if len(items) > 0 {
		return items
	}

	h1Title := "Imported Plan"
	for _, line := range lines {
		if title, ok := extractHeading(line, 1); ok {
			h1Title = normalizeHeadingTitle(title)
			break
		}
	}

	return []PlanItem{
		{
			Title: h1Title,
			Body:  strings.TrimSpace(normalized),
		},
	}
}

func extractHeading(line string, level int) (string, bool) {
	trimmedStart := strings.TrimLeft(line, " \t")
	prefix := strings.Repeat("#", level)
	if !strings.HasPrefix(trimmedStart, prefix) {
		return "", false
	}
	if len(trimmedStart) <= level {
		return "", false
	}

	next := trimmedStart[level]
	if next == '#' || (next != ' ' && next != '\t') {
		return "", false
	}

	title := strings.TrimSpace(trimmedStart[level:])
	if title == "" {
		return "", false
	}

	return title, true
}

func normalizeHeadingTitle(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if len(trimmed) >= len("plan:") && strings.EqualFold(trimmed[:len("plan:")], "plan:") {
		stripped := strings.TrimSpace(trimmed[len("plan:"):])
		if stripped != "" {
			return stripped
		}
	}
	return trimmed
}
