package browser

import (
	"bufio"
	"regexp"
	"strings"
)

// refPattern matches element refs like @e1, @e2, @e123
var refPattern = regexp.MustCompile(`@e\d+`)

// ParseSnapshot parses agent-browser snapshot output into structured data
func ParseSnapshot(output string) *SnapshotResult {
	result := &SnapshotResult{
		Raw:      output,
		Elements: make([]Element, 0),
	}

	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		// Look for lines with refs like "@e1: button "Submit""
		if strings.HasPrefix(line, "@e") {
			elem := parseElementLine(line)
			if elem != nil {
				result.Elements = append(result.Elements, *elem)
			}
		}
	}

	return result
}

// parseElementLine parses a single element line
// Format: @e1: button "Submit" or @e2: input "Email address"
func parseElementLine(line string) *Element {
	// Extract ref
	ref := refPattern.FindString(line)
	if ref == "" {
		return nil
	}

	// Rest after ref - must have colon separator
	rest := strings.TrimPrefix(line, ref)

	// Require colon after ref (with optional whitespace)
	rest = strings.TrimSpace(rest)
	if !strings.HasPrefix(rest, ":") {
		return nil
	}
	rest = strings.TrimPrefix(rest, ":")
	rest = strings.TrimSpace(rest)

	// Extract role (first word)
	parts := strings.SplitN(rest, " ", 2)
	role := ""
	name := ""
	if len(parts) > 0 {
		role = parts[0]
	}
	if len(parts) > 1 {
		// Name is usually in quotes
		name = strings.Trim(parts[1], `"'`)
	}

	return &Element{
		Ref:     ref,
		Role:    role,
		Name:    name,
		Enabled: true, // Assume enabled unless proven otherwise
		Visible: true, // Assume visible (interactive snapshot only shows visible)
	}
}

// FindElementByRef finds an element by its ref in a snapshot
func (s *SnapshotResult) FindElementByRef(ref string) *Element {
	for i := range s.Elements {
		if s.Elements[i].Ref == ref {
			return &s.Elements[i]
		}
	}
	return nil
}

// FindElementsByRole finds elements by role
func (s *SnapshotResult) FindElementsByRole(role string) []Element {
	var results []Element
	for _, elem := range s.Elements {
		if elem.Role == role {
			results = append(results, elem)
		}
	}
	return results
}

// FindElementsByText finds elements containing text in name (case-insensitive)
func (s *SnapshotResult) FindElementsByText(text string) []Element {
	var results []Element
	lower := strings.ToLower(text)
	for _, elem := range s.Elements {
		if strings.Contains(strings.ToLower(elem.Name), lower) {
			results = append(results, elem)
		}
	}
	return results
}

// GetRefs returns all refs in the snapshot
func (s *SnapshotResult) GetRefs() []string {
	refs := make([]string, len(s.Elements))
	for i, elem := range s.Elements {
		refs[i] = elem.Ref
	}
	return refs
}

// Count returns the number of elements in the snapshot
func (s *SnapshotResult) Count() int {
	return len(s.Elements)
}

// IsEmpty returns true if the snapshot has no elements
func (s *SnapshotResult) IsEmpty() bool {
	return len(s.Elements) == 0
}

// GetButtons returns all button elements
func (s *SnapshotResult) GetButtons() []Element {
	return s.FindElementsByRole("button")
}

// GetInputs returns all input elements
func (s *SnapshotResult) GetInputs() []Element {
	return s.FindElementsByRole("input")
}

// GetLinks returns all link elements
func (s *SnapshotResult) GetLinks() []Element {
	return s.FindElementsByRole("link")
}
