package browser

import (
	"strings"
	"testing"
)

// TestParseSnapshotEdgeCases tests edge cases for snapshot parsing
func TestParseSnapshotEdgeCases(t *testing.T) {
	testCases := []struct {
		name          string
		input         string
		expectedCount int
		description   string
	}{
		{
			name:          "empty string",
			input:         "",
			expectedCount: 0,
			description:   "empty input should return empty elements",
		},
		{
			name:          "whitespace only",
			input:         "   \n\t\n  ",
			expectedCount: 0,
			description:   "whitespace only should return empty elements",
		},
		{
			name:          "single element",
			input:         "@e1: button \"Submit\"",
			expectedCount: 1,
			description:   "single element should parse correctly",
		},
		{
			name:          "element with no name",
			input:         "@e1: button",
			expectedCount: 1,
			description:   "element with no name should parse",
		},
		{
			name:          "element with empty quotes",
			input:         "@e1: button \"\"",
			expectedCount: 1,
			description:   "element with empty quotes should parse",
		},
		{
			name: "multiple elements with blank lines",
			input: `@e1: button "Submit"

@e2: input "Email"

@e3: link "Help"`,
			expectedCount: 3,
			description:   "blank lines should be ignored",
		},
		{
			name: "mixed valid and invalid lines",
			input: `Some header text
@e1: button "Submit"
Random middle text
@e2: input "Email"
Footer text`,
			expectedCount: 2,
			description:   "non-ref lines should be ignored",
		},
		{
			name:          "large ref number",
			input:         "@e999999: button \"Test\"",
			expectedCount: 1,
			description:   "large ref numbers should parse",
		},
		{
			name:          "ref at start of text",
			input:         "@e1button \"Test\"",
			expectedCount: 0,
			description:   "ref without colon should not parse as element",
		},
		{
			name:          "element with special characters in name",
			input:         "@e1: button \"Click <here> & submit!\"",
			expectedCount: 1,
			description:   "special characters in name should be preserved",
		},
		{
			name:          "element with single quotes",
			input:         "@e1: button 'Click here'",
			expectedCount: 1,
			description:   "single quotes should work",
		},
		{
			name:          "element with unicode",
			input:         "@e1: button \"提交\"",
			expectedCount: 1,
			description:   "unicode characters should be preserved",
		},
		{
			name:          "element with emoji",
			input:         "@e1: button \"✅ Submit\"",
			expectedCount: 1,
			description:   "emoji should be preserved",
		},
		{
			name:          "tab-separated elements",
			input:         "@e1:\tbutton\t\"Submit\"",
			expectedCount: 1,
			description:   "tabs should be handled",
		},
		{
			name:          "element with leading whitespace",
			input:         "   @e1: button \"Submit\"",
			expectedCount: 1,
			description:   "leading whitespace should be trimmed",
		},
		{
			name:          "element with multiple colons",
			input:         "@e1: button \"Click: Submit\"",
			expectedCount: 1,
			description:   "colons in name should be preserved",
		},
		{
			name:          "element with quotes in name",
			input:         "@e1: button \"Click \"here\"\"",
			expectedCount: 1,
			description:   "nested quotes should be handled",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			if len(result.Elements) != tc.expectedCount {
				t.Errorf("%s: expected %d elements, got %d",
					tc.description, tc.expectedCount, len(result.Elements))
			}
		})
	}
}

// TestParseElementLineDetails tests detailed element line parsing
func TestParseElementLineDetails(t *testing.T) {
	testCases := []struct {
		input        string
		expectedRef  string
		expectedRole string
		expectedName string
	}{
		{"@e1: button \"Submit\"", "@e1", "button", "Submit"},
		{"@e10: input \"Email\"", "@e10", "input", "Email"},
		{"@e123: link \"Help\"", "@e123", "link", "Help"},
		{"@e1: checkbox \"Remember me\"", "@e1", "checkbox", "Remember me"},
		{"@e1: textarea \"Description\"", "@e1", "textarea", "Description"},
		{"@e1: select \"Country\"", "@e1", "select", "Country"},
		{"@e1: radio \"Option A\"", "@e1", "radio", "Option A"},
		{"@e1: button", "@e1", "button", ""},
		{"@e1: button \"\"", "@e1", "button", ""},
		{"@e1: button 'Single'", "@e1", "button", "Single"},
	}

	for _, tc := range testCases {
		result := ParseSnapshot(tc.input)
		if len(result.Elements) != 1 {
			t.Errorf("expected 1 element for %q, got %d", tc.input, len(result.Elements))
			continue
		}

		elem := result.Elements[0]
		if elem.Ref != tc.expectedRef {
			t.Errorf("for %q: expected ref %q, got %q", tc.input, tc.expectedRef, elem.Ref)
		}
		if elem.Role != tc.expectedRole {
			t.Errorf("for %q: expected role %q, got %q", tc.input, tc.expectedRole, elem.Role)
		}
		if elem.Name != tc.expectedName {
			t.Errorf("for %q: expected name %q, got %q", tc.input, tc.expectedName, elem.Name)
		}
	}
}

// TestSnapshotResultMethods tests SnapshotResult helper methods
func TestSnapshotResultMethods(t *testing.T) {
	input := `
@e1: button "Submit Form"
@e2: input "Email"
@e3: button "Cancel"
@e4: link "Help"
@e5: input "Password"
@e6: link "Forgot password?"
@e7: checkbox "Remember"
@e8: button "Reset"
`

	result := ParseSnapshot(input)

	t.Run("Count", func(t *testing.T) {
		if result.Count() != 8 {
			t.Errorf("expected count 8, got %d", result.Count())
		}
	})

	t.Run("IsEmpty", func(t *testing.T) {
		if result.IsEmpty() {
			t.Error("expected IsEmpty() to be false")
		}

		emptyResult := ParseSnapshot("")
		if !emptyResult.IsEmpty() {
			t.Error("expected IsEmpty() to be true for empty snapshot")
		}
	})

	t.Run("GetButtons", func(t *testing.T) {
		buttons := result.GetButtons()
		if len(buttons) != 3 {
			t.Errorf("expected 3 buttons, got %d", len(buttons))
		}
	})

	t.Run("GetInputs", func(t *testing.T) {
		inputs := result.GetInputs()
		if len(inputs) != 2 {
			t.Errorf("expected 2 inputs, got %d", len(inputs))
		}
	})

	t.Run("GetLinks", func(t *testing.T) {
		links := result.GetLinks()
		if len(links) != 2 {
			t.Errorf("expected 2 links, got %d", len(links))
		}
	})

	t.Run("FindElementByRef", func(t *testing.T) {
		// Test finding existing ref
		elem := result.FindElementByRef("@e5")
		if elem == nil {
			t.Fatal("expected to find @e5")
		}
		if elem.Role != "input" {
			t.Errorf("expected role 'input', got %q", elem.Role)
		}
		if elem.Name != "Password" {
			t.Errorf("expected name 'Password', got %q", elem.Name)
		}

		// Test not finding non-existent ref
		elem = result.FindElementByRef("@e99")
		if elem != nil {
			t.Error("expected nil for non-existent ref")
		}

		// Test edge cases
		elem = result.FindElementByRef("")
		if elem != nil {
			t.Error("expected nil for empty ref")
		}

		elem = result.FindElementByRef("e1")
		if elem != nil {
			t.Error("expected nil for ref without @")
		}
	})

	t.Run("FindElementsByRole", func(t *testing.T) {
		// Test existing roles
		buttons := result.FindElementsByRole("button")
		if len(buttons) != 3 {
			t.Errorf("expected 3 buttons, got %d", len(buttons))
		}

		// Test non-existent role
		divs := result.FindElementsByRole("div")
		if len(divs) != 0 {
			t.Errorf("expected 0 divs, got %d", len(divs))
		}

		// Test empty role
		empty := result.FindElementsByRole("")
		if len(empty) != 0 {
			t.Errorf("expected 0 for empty role, got %d", len(empty))
		}
	})

	t.Run("FindElementsByText", func(t *testing.T) {
		// Test case insensitivity
		elements := result.FindElementsByText("SUBMIT")
		if len(elements) != 1 {
			t.Errorf("expected 1 match for 'SUBMIT', got %d", len(elements))
		}

		elements = result.FindElementsByText("password")
		if len(elements) != 2 {
			t.Errorf("expected 2 matches for 'password', got %d", len(elements))
		}

		// Test no match
		elements = result.FindElementsByText("xyz123nonexistent")
		if len(elements) != 0 {
			t.Errorf("expected 0 matches for non-existent text, got %d", len(elements))
		}

		// Test empty text
		elements = result.FindElementsByText("")
		if len(elements) != 8 {
			t.Errorf("expected all 8 elements for empty text, got %d", len(elements))
		}
	})

	t.Run("GetRefs", func(t *testing.T) {
		refs := result.GetRefs()
		if len(refs) != 8 {
			t.Errorf("expected 8 refs, got %d", len(refs))
		}

		// Verify order
		expected := []string{"@e1", "@e2", "@e3", "@e4", "@e5", "@e6", "@e7", "@e8"}
		for i, ref := range refs {
			if ref != expected[i] {
				t.Errorf("expected ref %q at index %d, got %q", expected[i], i, ref)
			}
		}
	})
}

// TestSnapshotRawPreserved tests that raw output is preserved
func TestSnapshotRawPreserved(t *testing.T) {
	input := `@e1: button "Submit"
@e2: input "Email"
Random text
@e3: link "Help"`

	result := ParseSnapshot(input)
	if result.Raw != input {
		t.Error("expected raw output to be preserved exactly")
	}
}

// TestParseSnapshotLargeInput tests parsing with many elements
func TestParseSnapshotLargeInput(t *testing.T) {
	// Generate large input
	var builder strings.Builder
	for i := 1; i <= 1000; i++ {
		builder.WriteString("@e")
		builder.WriteString(strings.Repeat("", 0))
		if i > 0 {
			builder.WriteString(string(rune('0' + (i/100)%10)))
			builder.WriteString(string(rune('0' + (i/10)%10)))
			builder.WriteString(string(rune('0' + i%10)))
		}
		builder.WriteString(": button \"Button ")
		builder.WriteString(strings.Repeat("", 0))
		builder.WriteString(string(rune('0' + (i/100)%10)))
		builder.WriteString(string(rune('0' + (i/10)%10)))
		builder.WriteString(string(rune('0' + i%10)))
		builder.WriteString("\"\n")
	}

	// This test just verifies it doesn't crash/hang with large input
	result := ParseSnapshot(builder.String())
	if result == nil {
		t.Error("expected non-nil result")
	}
}

// TestSnapshotResultNilSafe tests that methods handle nil/empty gracefully
func TestSnapshotResultNilSafe(t *testing.T) {
	result := &SnapshotResult{}

	// These should not panic
	if result.Count() != 0 {
		t.Error("expected count 0 for empty result")
	}
	if !result.IsEmpty() {
		t.Error("expected IsEmpty true for empty result")
	}
	if len(result.GetButtons()) != 0 {
		t.Error("expected no buttons for empty result")
	}
	if len(result.GetInputs()) != 0 {
		t.Error("expected no inputs for empty result")
	}
	if len(result.GetLinks()) != 0 {
		t.Error("expected no links for empty result")
	}
	if result.FindElementByRef("@e1") != nil {
		t.Error("expected nil for non-existent ref")
	}
	if len(result.FindElementsByRole("button")) != 0 {
		t.Error("expected no elements for role search")
	}
	if len(result.FindElementsByText("test")) != 0 {
		t.Error("expected no elements for text search")
	}
	if len(result.GetRefs()) != 0 {
		t.Error("expected no refs for empty result")
	}
}

// TestElementDefaultValues tests Element struct default values
func TestElementDefaultValues(t *testing.T) {
	elem := Element{}

	if elem.Ref != "" {
		t.Errorf("expected empty Ref, got %q", elem.Ref)
	}
	if elem.Role != "" {
		t.Errorf("expected empty Role, got %q", elem.Role)
	}
	if elem.Name != "" {
		t.Errorf("expected empty Name, got %q", elem.Name)
	}
	if elem.Description != "" {
		t.Errorf("expected empty Description, got %q", elem.Description)
	}
	if elem.Enabled {
		t.Error("expected Enabled to be false by default")
	}
	if elem.Visible {
		t.Error("expected Visible to be false by default")
	}
}

// TestParsedElementDefaults tests that parsed elements have correct defaults
func TestParsedElementDefaults(t *testing.T) {
	result := ParseSnapshot("@e1: button \"Submit\"")

	if len(result.Elements) != 1 {
		t.Fatal("expected 1 element")
	}

	elem := result.Elements[0]
	if !elem.Enabled {
		t.Error("expected parsed element to be Enabled by default")
	}
	if !elem.Visible {
		t.Error("expected parsed element to be Visible by default")
	}
}

// BenchmarkParseSnapshotLarge benchmarks parsing large snapshots
func BenchmarkParseSnapshotLarge(b *testing.B) {
	var builder strings.Builder
	for i := 1; i <= 100; i++ {
		builder.WriteString("@e")
		builder.WriteString(string(rune('0' + i/10)))
		builder.WriteString(string(rune('0' + i%10)))
		builder.WriteString(": button \"Button ")
		builder.WriteString(string(rune('0' + i/10)))
		builder.WriteString(string(rune('0' + i%10)))
		builder.WriteString("\"\n")
	}
	input := builder.String()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ParseSnapshot(input)
	}
}
