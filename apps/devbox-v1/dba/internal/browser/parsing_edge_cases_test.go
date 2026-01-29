package browser

import (
	"fmt"
	"strings"
	"testing"
)

// TestParseElementLineEdgeCases tests parseElementLine edge cases
func TestParseElementLineEdgeCases(t *testing.T) {
	testCases := []struct {
		name        string
		input       string
		expectParse bool
		expectRef   string
		expectRole  string
		expectName  string
	}{
		// Valid patterns
		{"basic", "@e1: button \"Test\"", true, "@e1", "button", "Test"},
		{"no quotes", "@e1: button Test", true, "@e1", "button", "Test"},
		{"single quotes", "@e1: button 'Test'", true, "@e1", "button", "Test"},
		{"empty name quotes", "@e1: button \"\"", true, "@e1", "button", ""},
		{"space in name", "@e1: button \"Hello World\"", true, "@e1", "button", "Hello World"},
		{"number in ref", "@e123: button \"Test\"", true, "@e123", "button", "Test"},
		{"large ref number", "@e999999: button \"Test\"", true, "@e999999", "button", "Test"},
		{"role with hyphen", "@e1: my-button \"Test\"", true, "@e1", "my-button", "Test"},
		{"role with underscore", "@e1: my_button \"Test\"", true, "@e1", "my_button", "Test"},
		{"multiple spaces after colon", "@e1:    button \"Test\"", true, "@e1", "button", "Test"},
		{"tab after colon", "@e1:\tbutton \"Test\"", true, "@e1", "button", "Test"},

		// Invalid patterns - no colon
		{"no colon", "@e1 button \"Test\"", false, "", "", ""},
		{"missing colon", "@e1button \"Test\"", false, "", "", ""},

		// Invalid patterns - no number
		{"no number", "@e: button \"Test\"", false, "", "", ""},
		{"letter instead of number", "@ea: button \"Test\"", false, "", "", ""},

		// Invalid patterns - wrong prefix
		{"uppercase E", "@E1: button \"Test\"", false, "", "", ""},
		{"missing @", "e1: button \"Test\"", false, "", "", ""},
		{"wrong letter", "@f1: button \"Test\"", false, "", "", ""},

		// Edge cases with content after ref
		{"only ref", "@e1:", true, "@e1", "", ""},
		{"ref and colon only", "@e1: ", true, "@e1", "", ""},
		{"ref colon space", "@e1:  ", true, "@e1", "", ""},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			hasParsed := len(result.Elements) > 0

			if hasParsed != tc.expectParse {
				t.Errorf("expected parse=%v, got %v for input %q", tc.expectParse, hasParsed, tc.input)
				return
			}

			if !tc.expectParse {
				return
			}

			elem := result.Elements[0]
			if elem.Ref != tc.expectRef {
				t.Errorf("ref: expected %q, got %q", tc.expectRef, elem.Ref)
			}
			if elem.Role != tc.expectRole {
				t.Errorf("role: expected %q, got %q", tc.expectRole, elem.Role)
			}
			if elem.Name != tc.expectName {
				t.Errorf("name: expected %q, got %q", tc.expectName, elem.Name)
			}
		})
	}
}

// TestFindElementByRefEdgeCases tests FindElementByRef edge cases
func TestFindElementByRefEdgeCases(t *testing.T) {
	result := ParseSnapshot(`
@e1: button "First"
@e2: input "Second"
@e10: link "Tenth"
@e100: button "Hundredth"
`)

	testCases := []struct {
		ref      string
		expected bool
	}{
		{"@e1", true},
		{"@e2", true},
		{"@e10", true},
		{"@e100", true},
		{"@e3", false},    // doesn't exist
		{"@e01", false},   // different from @e1
		{"e1", false},     // missing @
		{"@E1", false},    // uppercase
		{"@e1 ", false},   // trailing space
		{" @e1", false},   // leading space
		{"", false},       // empty
		{"@e", false},     // no number
		{"@e-1", false},   // negative
		{"@@e1", false},   // double @
	}

	for _, tc := range testCases {
		t.Run(tc.ref, func(t *testing.T) {
			found := result.FindElementByRef(tc.ref)
			hasResult := found != nil

			if hasResult != tc.expected {
				t.Errorf("FindElementByRef(%q): expected found=%v, got %v", tc.ref, tc.expected, hasResult)
			}
		})
	}
}

// TestFindElementsByRoleEdgeCases tests FindElementsByRole edge cases
func TestFindElementsByRoleEdgeCases(t *testing.T) {
	result := ParseSnapshot(`
@e1: button "A"
@e2: Button "B"
@e3: BUTTON "C"
@e4: input "D"
@e5: button "E"
`)

	testCases := []struct {
		role     string
		expected int
	}{
		{"button", 2},  // @e1 and @e5
		{"Button", 1},  // @e2 only (case sensitive)
		{"BUTTON", 1},  // @e3 only
		{"input", 1},
		{"link", 0},
		{"", 0},
		{" ", 0},
		{"button ", 0}, // trailing space
		{" button", 0}, // leading space
	}

	for _, tc := range testCases {
		t.Run(tc.role, func(t *testing.T) {
			found := result.FindElementsByRole(tc.role)
			if len(found) != tc.expected {
				t.Errorf("FindElementsByRole(%q): expected %d, got %d", tc.role, tc.expected, len(found))
			}
		})
	}
}

// TestFindElementsByTextVariations tests FindElementsByText variations
func TestFindElementsByTextVariations(t *testing.T) {
	result := ParseSnapshot(`
@e1: button "Hello World"
@e2: input "hello"
@e3: link "HELLO"
@e4: button "Say Hello"
@e5: input "Goodbye"
`)

	testCases := []struct {
		text     string
		expected int
	}{
		{"Hello", 4},       // @e1 (Hello World), @e2 (hello), @e3 (HELLO), @e4 (Say Hello)
		{"hello", 4},       // case insensitive
		{"HELLO", 4},       // case insensitive
		{"World", 1},       // only @e1
		{"Goodbye", 1},
		{"bye", 1},         // substring of Goodbye
		{"xyz", 0},         // no match
		{"", 5},            // empty matches all
		{" ", 2},           // space in "Hello World" and "Say Hello"
		{"Hello World", 1}, // exact match
	}

	for _, tc := range testCases {
		t.Run(tc.text, func(t *testing.T) {
			found := result.FindElementsByText(tc.text)
			if len(found) != tc.expected {
				t.Errorf("FindElementsByText(%q): expected %d, got %d", tc.text, tc.expected, len(found))
			}
		})
	}
}

// TestGetRefsEdgeCases tests GetRefs edge cases
func TestGetRefsEdgeCases(t *testing.T) {
	t.Run("empty snapshot", func(t *testing.T) {
		result := ParseSnapshot("")
		refs := result.GetRefs()
		if refs == nil {
			t.Error("GetRefs should return empty slice, not nil")
		}
		if len(refs) != 0 {
			t.Errorf("expected 0 refs, got %d", len(refs))
		}
	})

	t.Run("single element", func(t *testing.T) {
		result := ParseSnapshot("@e1: button \"Test\"")
		refs := result.GetRefs()
		if len(refs) != 1 {
			t.Errorf("expected 1 ref, got %d", len(refs))
		}
		if refs[0] != "@e1" {
			t.Errorf("expected @e1, got %s", refs[0])
		}
	})

	t.Run("multiple elements order preserved", func(t *testing.T) {
		result := ParseSnapshot(`
@e5: button "Fifth"
@e1: button "First"
@e3: button "Third"
`)
		refs := result.GetRefs()
		expected := []string{"@e5", "@e1", "@e3"}
		for i, ref := range refs {
			if ref != expected[i] {
				t.Errorf("ref[%d]: expected %s, got %s", i, expected[i], ref)
			}
		}
	})
}

// TestSnapshotResultPredicates tests IsEmpty and Count edge cases
func TestSnapshotResultPredicates(t *testing.T) {
	t.Run("nil Elements", func(t *testing.T) {
		result := &SnapshotResult{Elements: nil}
		if !result.IsEmpty() {
			t.Error("nil Elements should be empty")
		}
		if result.Count() != 0 {
			t.Error("nil Elements should have count 0")
		}
	})

	t.Run("empty Elements", func(t *testing.T) {
		result := &SnapshotResult{Elements: []Element{}}
		if !result.IsEmpty() {
			t.Error("empty Elements should be empty")
		}
		if result.Count() != 0 {
			t.Error("empty Elements should have count 0")
		}
	})

	t.Run("one element", func(t *testing.T) {
		result := &SnapshotResult{Elements: []Element{{Ref: "@e1"}}}
		if result.IsEmpty() {
			t.Error("one element should not be empty")
		}
		if result.Count() != 1 {
			t.Error("one element should have count 1")
		}
	})
}

// TestRoleSpecificGetters tests GetButtons, GetInputs, GetLinks
func TestRoleSpecificGetters(t *testing.T) {
	result := ParseSnapshot(`
@e1: button "Button1"
@e2: input "Input1"
@e3: link "Link1"
@e4: button "Button2"
@e5: checkbox "Check1"
@e6: input "Input2"
@e7: link "Link2"
@e8: link "Link3"
`)

	t.Run("GetButtons", func(t *testing.T) {
		buttons := result.GetButtons()
		if len(buttons) != 2 {
			t.Errorf("expected 2 buttons, got %d", len(buttons))
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
		if len(links) != 3 {
			t.Errorf("expected 3 links, got %d", len(links))
		}
	})

	t.Run("empty snapshot getters", func(t *testing.T) {
		empty := ParseSnapshot("")
		if len(empty.GetButtons()) != 0 {
			t.Error("empty snapshot should have no buttons")
		}
		if len(empty.GetInputs()) != 0 {
			t.Error("empty snapshot should have no inputs")
		}
		if len(empty.GetLinks()) != 0 {
			t.Error("empty snapshot should have no links")
		}
	})
}

// TestParseSnapshotWithMixedContent tests parsing with valid and invalid lines
func TestParseSnapshotWithMixedContent(t *testing.T) {
	input := `
Some random text
@e1: button "Valid1"
Another line without ref
@invalid: not a ref
@e2: input "Valid2"
  @e3: link "Valid3 with leading space"
@e4: button "Valid4"
Text at the end
`
	result := ParseSnapshot(input)

	// Should find @e1, @e2, @e3, @e4
	if result.Count() != 4 {
		t.Errorf("expected 4 elements, got %d", result.Count())
	}

	// Verify each
	if result.FindElementByRef("@e1") == nil {
		t.Error("should find @e1")
	}
	if result.FindElementByRef("@e2") == nil {
		t.Error("should find @e2")
	}
	if result.FindElementByRef("@e3") == nil {
		t.Error("should find @e3")
	}
	if result.FindElementByRef("@e4") == nil {
		t.Error("should find @e4")
	}
}

// TestRefNumberFormats tests various ref number formats
func TestRefNumberFormats(t *testing.T) {
	testCases := []struct {
		input    string
		expected string
	}{
		{"@e0: button \"Zero\"", "@e0"},
		{"@e00: button \"Double Zero\"", "@e00"},
		{"@e01: button \"Leading Zero\"", "@e01"},
		{"@e001: button \"Two Leading Zeros\"", "@e001"},
		{"@e1: button \"One\"", "@e1"},
		{"@e10: button \"Ten\"", "@e10"},
		{"@e99: button \"Ninety Nine\"", "@e99"},
		{"@e100: button \"Hundred\"", "@e100"},
		{"@e999: button \"Nine Ninety Nine\"", "@e999"},
		{"@e1000: button \"Thousand\"", "@e1000"},
		{"@e99999: button \"Large\"", "@e99999"},
	}

	for _, tc := range testCases {
		t.Run(tc.expected, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			if len(result.Elements) != 1 {
				t.Fatalf("expected 1 element, got %d", len(result.Elements))
			}
			if result.Elements[0].Ref != tc.expected {
				t.Errorf("expected ref %q, got %q", tc.expected, result.Elements[0].Ref)
			}
		})
	}
}

// TestNameExtractionEdgeCases tests various name extraction scenarios
func TestNameExtractionEdgeCases(t *testing.T) {
	testCases := []struct {
		name     string
		input    string
		expected string
	}{
		{"simple quoted", "@e1: button \"Test\"", "Test"},
		{"single quoted", "@e1: button 'Test'", "Test"},
		{"unquoted single word", "@e1: button Test", "Test"},
		{"unquoted multiple words", "@e1: button Test Name Here", "Test Name Here"},
		{"empty quotes", "@e1: button \"\"", ""},
		{"space in quotes", "@e1: button \" \"", " "},
		{"tabs in quotes", "@e1: button \"\t\"", "\t"},
		{"quote in name", "@e1: button \"Say \\\"Hi\\\"\"", "Say \\\"Hi\\"},  // Trailing quote gets trimmed
		{"special chars", "@e1: button \"<>&\"", "<>&"},
		{"numbers", "@e1: button \"123\"", "123"},
		{"unicode", "@e1: button \"你好\"", "你好"},
		{"emoji", "@e1: button \"🎉\"", "🎉"},
		{"mixed", "@e1: button \"Hello 你好 🌍\"", "Hello 你好 🌍"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			if len(result.Elements) == 0 {
				t.Fatal("expected at least 1 element")
			}
			if result.Elements[0].Name != tc.expected {
				t.Errorf("expected name %q, got %q", tc.expected, result.Elements[0].Name)
			}
		})
	}
}

// TestRoleExtractionEdgeCases tests various role extraction scenarios
func TestRoleExtractionEdgeCases(t *testing.T) {
	testCases := []struct {
		name     string
		input    string
		expected string
	}{
		{"simple", "@e1: button \"Test\"", "button"},
		{"uppercase", "@e1: BUTTON \"Test\"", "BUTTON"},
		{"mixed case", "@e1: Button \"Test\"", "Button"},
		{"with hyphen", "@e1: my-button \"Test\"", "my-button"},
		{"with underscore", "@e1: my_button \"Test\"", "my_button"},
		{"with numbers", "@e1: button1 \"Test\"", "button1"},
		{"single char", "@e1: b \"Test\"", "b"},
		{"long role", "@e1: verylongrolename \"Test\"", "verylongrolename"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			if len(result.Elements) == 0 {
				t.Fatal("expected at least 1 element")
			}
			if result.Elements[0].Role != tc.expected {
				t.Errorf("expected role %q, got %q", tc.expected, result.Elements[0].Role)
			}
		})
	}
}

// TestSnapshotRawPreservation tests that Raw field preserves original input
func TestSnapshotRawPreservation(t *testing.T) {
	inputs := []string{
		"@e1: button \"Test\"",
		"@e1: button \"Test\"\n@e2: input \"Field\"",
		"Some header\n@e1: button \"Test\"\nSome footer",
		"", // empty
		"   ", // whitespace only
	}

	for i, input := range inputs {
		t.Run(fmt.Sprintf("input_%d", i), func(t *testing.T) {
			result := ParseSnapshot(input)
			if result.Raw != input {
				t.Errorf("Raw not preserved: expected %q, got %q", input, result.Raw)
			}
		})
	}
}

// TestLargeRefNumbers tests handling of very large ref numbers
func TestLargeRefNumbers(t *testing.T) {
	largeNumbers := []string{
		"999999999",
		"1000000000",
		"2147483647",     // max int32
		"9999999999999",  // larger than int32
	}

	for _, num := range largeNumbers {
		t.Run("ref_"+num, func(t *testing.T) {
			input := fmt.Sprintf("@e%s: button \"Test\"", num)
			result := ParseSnapshot(input)

			if len(result.Elements) != 1 {
				t.Errorf("should parse @e%s", num)
				return
			}

			expectedRef := "@e" + num
			if result.Elements[0].Ref != expectedRef {
				t.Errorf("expected ref %q, got %q", expectedRef, result.Elements[0].Ref)
			}
		})
	}
}

// TestConsecutiveRefs tests parsing consecutive ref patterns
func TestConsecutiveRefs(t *testing.T) {
	input := "@e1: button \"A\"\n@e2: button \"B\"\n@e3: button \"C\""
	result := ParseSnapshot(input)

	if result.Count() != 3 {
		t.Errorf("expected 3 elements, got %d", result.Count())
	}

	for i := 1; i <= 3; i++ {
		ref := fmt.Sprintf("@e%d", i)
		if result.FindElementByRef(ref) == nil {
			t.Errorf("should find %s", ref)
		}
	}
}

// TestDuplicateRefHandling tests handling of duplicate refs
func TestDuplicateRefHandling(t *testing.T) {
	input := `
@e1: button "First"
@e1: input "Second"
@e1: link "Third"
`
	result := ParseSnapshot(input)

	// All three should be parsed (duplicates allowed in snapshot)
	if result.Count() != 3 {
		t.Errorf("expected 3 elements, got %d", result.Count())
	}

	// FindElementByRef returns first match
	found := result.FindElementByRef("@e1")
	if found == nil {
		t.Fatal("should find @e1")
	}
	if found.Role != "button" {
		t.Errorf("should return first @e1 (button), got %s", found.Role)
	}
}

// BenchmarkParsingVariations benchmarks different parsing scenarios
func BenchmarkParsingVariations(b *testing.B) {
	b.Run("single_element", func(b *testing.B) {
		input := "@e1: button \"Test\""
		for i := 0; i < b.N; i++ {
			_ = ParseSnapshot(input)
		}
	})

	b.Run("ten_elements", func(b *testing.B) {
		var builder strings.Builder
		for i := 0; i < 10; i++ {
			builder.WriteString(fmt.Sprintf("@e%d: button \"Button %d\"\n", i, i))
		}
		input := builder.String()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = ParseSnapshot(input)
		}
	})

	b.Run("hundred_elements", func(b *testing.B) {
		var builder strings.Builder
		for i := 0; i < 100; i++ {
			builder.WriteString(fmt.Sprintf("@e%d: button \"Button %d\"\n", i, i))
		}
		input := builder.String()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = ParseSnapshot(input)
		}
	})

	b.Run("mixed_valid_invalid", func(b *testing.B) {
		var builder strings.Builder
		for i := 0; i < 100; i++ {
			if i%2 == 0 {
				builder.WriteString(fmt.Sprintf("@e%d: button \"Button %d\"\n", i, i))
			} else {
				builder.WriteString("some invalid line\n")
			}
		}
		input := builder.String()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = ParseSnapshot(input)
		}
	})
}
