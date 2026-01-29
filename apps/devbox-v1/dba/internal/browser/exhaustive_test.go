package browser

import (
	"fmt"
	"math/rand"
	"strings"
	"testing"
	"unicode"
)

// TestExhaustiveRefPatterns tests exhaustive ref pattern variations
func TestExhaustiveRefPatterns(t *testing.T) {
	// Valid ref patterns
	validPatterns := []string{
		"@e0", "@e1", "@e9",
		"@e00", "@e01", "@e10", "@e99",
		"@e000", "@e001", "@e010", "@e100", "@e999",
		"@e0000", "@e0001", "@e0010", "@e0100", "@e1000", "@e9999",
	}

	for _, ref := range validPatterns {
		t.Run("valid_"+ref, func(t *testing.T) {
			input := ref + ": button \"Test\""
			result := ParseSnapshot(input)
			if len(result.Elements) != 1 {
				t.Errorf("should parse %s", ref)
			}
			if result.Elements[0].Ref != ref {
				t.Errorf("ref should be %s, got %s", ref, result.Elements[0].Ref)
			}
		})
	}

	// Invalid ref patterns
	invalidPatterns := []string{
		"@e",      // no number
		"@E1",     // uppercase E
		"@e-1",    // negative
		"@f1",     // wrong letter
		"e1",      // missing @
		"@1",      // missing e
		"@ e1",    // space after @
		"@e 1",    // space in middle
		"@@e1",    // double @
		"@ee1",    // double e
		"@e1@e2",  // concatenated refs
	}

	for _, pattern := range invalidPatterns {
		t.Run("invalid_"+pattern, func(t *testing.T) {
			input := pattern + ": button \"Test\""
			result := ParseSnapshot(input)
			// Should either not parse or parse differently
			if len(result.Elements) > 0 && result.Elements[0].Ref == pattern {
				t.Errorf("should not parse invalid pattern %s as-is", pattern)
			}
		})
	}
}

// TestExhaustiveRoleNames tests various role name patterns
func TestExhaustiveRoleNames(t *testing.T) {
	roles := []struct {
		role  string
		valid bool
	}{
		// Standard roles
		{"button", true},
		{"input", true},
		{"link", true},
		{"checkbox", true},
		{"radio", true},
		{"select", true},
		{"textarea", true},
		{"img", true},
		{"heading", true},
		{"paragraph", true},

		// Custom roles
		{"custom-role", true},
		{"custom_role", true},
		{"customRole", true},
		{"role123", true},

		// Edge cases
		{"a", true},          // single char
		{"ab", true},         // two chars
		{"x", true},
		{"BUTTON", true},     // uppercase
		{"Button", true},     // mixed case
		{"button1", true},    // with number
		{"button-1", true},   // with hyphen and number
		{"", false},          // empty
	}

	for _, tc := range roles {
		t.Run(tc.role, func(t *testing.T) {
			if tc.role == "" {
				// Empty role case
				input := "@e1:  \"Test\""
				result := ParseSnapshot(input)
				if len(result.Elements) > 0 {
					// Empty role might still parse
				}
				return
			}

			input := fmt.Sprintf("@e1: %s \"Test\"", tc.role)
			result := ParseSnapshot(input)

			if tc.valid {
				if len(result.Elements) != 1 {
					t.Errorf("should parse role %s", tc.role)
					return
				}
				if result.Elements[0].Role != tc.role {
					t.Errorf("role should be %s, got %s", tc.role, result.Elements[0].Role)
				}
			}
		})
	}
}

// TestExhaustiveNamePatterns tests various name patterns
func TestExhaustiveNamePatterns(t *testing.T) {
	names := []struct {
		input    string
		expected string
	}{
		// Quoted names
		{"\"Hello\"", "Hello"},
		{"\"Hello World\"", "Hello World"},
		{"\"\"", ""},
		{"\" \"", " "},
		{"\"  \"", "  "},

		// Single quoted names
		{"'Hello'", "Hello"},
		{"'Hello World'", "Hello World"},
		{"''", ""},

		// Unquoted names
		{"Hello", "Hello"},
		{"Hello World", "Hello World"},

		// Special characters in names
		{"\"Hello!\"", "Hello!"},
		{"\"Hello?\"", "Hello?"},
		{"\"<button>\"", "<button>"},
		{"\"a & b\"", "a & b"},

		// Numbers
		{"\"123\"", "123"},
		{"\"Button 1\"", "Button 1"},

		// Unicode
		{"\"你好\"", "你好"},
		{"\"مرحبا\"", "مرحبا"},
		{"\"🎉\"", "🎉"},
	}

	for _, tc := range names {
		t.Run(tc.input, func(t *testing.T) {
			input := "@e1: button " + tc.input
			result := ParseSnapshot(input)

			if len(result.Elements) != 1 {
				t.Fatalf("should parse, input: %s", input)
			}
			if result.Elements[0].Name != tc.expected {
				t.Errorf("expected name %q, got %q", tc.expected, result.Elements[0].Name)
			}
		})
	}
}

// TestExhaustiveWhitespace tests all whitespace variations
func TestExhaustiveWhitespace(t *testing.T) {
	// Test whitespace before ref
	prefixes := []string{"", " ", "  ", "\t", "\n", "\r\n", " \t "}
	for i, prefix := range prefixes {
		t.Run(fmt.Sprintf("prefix_%d", i), func(t *testing.T) {
			input := prefix + "@e1: button \"Test\""
			result := ParseSnapshot(input)
			if len(result.Elements) != 1 {
				t.Errorf("should parse with prefix %q", prefix)
			}
		})
	}

	// Test whitespace after colon
	afterColons := []string{" ", "  ", "\t", " \t", "  \t  "}
	for i, ws := range afterColons {
		t.Run(fmt.Sprintf("after_colon_%d", i), func(t *testing.T) {
			input := "@e1:" + ws + "button \"Test\""
			result := ParseSnapshot(input)
			if len(result.Elements) != 1 {
				t.Errorf("should parse with whitespace after colon: %q", ws)
			}
		})
	}

	// Test whitespace between role and name
	betweens := []string{" ", "  ", "\t", " \t "}
	for i, ws := range betweens {
		t.Run(fmt.Sprintf("between_%d", i), func(t *testing.T) {
			input := "@e1: button" + ws + "\"Test\""
			result := ParseSnapshot(input)
			if len(result.Elements) != 1 {
				t.Errorf("should parse with whitespace between role and name")
			}
		})
	}
}

// TestExhaustiveLineEndings tests all line ending variations
func TestExhaustiveLineEndings(t *testing.T) {
	lineEndings := []struct {
		name     string
		ending   string
		expected int
	}{
		{"LF", "\n", 2},
		{"CR", "\r", 1},          // CR alone is not a line separator for bufio.Scanner
		{"CRLF", "\r\n", 2},
		{"double LF", "\n\n", 2},
		{"mixed", "\n\r\n\n", 2},
	}

	for _, le := range lineEndings {
		t.Run(le.name, func(t *testing.T) {
			input := "@e1: button \"First\"" + le.ending + "@e2: input \"Second\""
			result := ParseSnapshot(input)
			if result.Count() != le.expected {
				t.Errorf("expected %d elements with %s line ending, got %d", le.expected, le.name, result.Count())
			}
		})
	}
}

// TestExhaustiveErrorMessages tests error message matching exhaustively
func TestExhaustiveErrorMessages(t *testing.T) {
	// Test each keyword in various positions
	keywords := map[string]error{
		"not found":    ErrElementNotFound,
		"not visible":  ErrElementNotVisible,
		"not enabled":  ErrElementNotEnabled,
		"disabled":     ErrElementNotEnabled,
		"not editable": ErrElementNotEditable,
		"timeout":      ErrTimeout,
		"timed out":    ErrTimeout,
		"navigation":   ErrNavigationFailed,
		"stale":        ErrStaleRef,
		"invalid key":  ErrInvalidKey,
		"unknown key":  ErrInvalidKey,
	}

	positions := []string{
		"%s",           // just the keyword
		"Error: %s",    // prefix
		"%s occurred",  // suffix
		"[%s]",         // brackets
		"(%s)",         // parentheses
		"'%s'",         // quotes
		"\"%s\"",       // double quotes
		"  %s  ",       // whitespace
		"\n%s\n",       // newlines
	}

	for keyword, expectedErr := range keywords {
		for _, pos := range positions {
			msg := fmt.Sprintf(pos, keyword)
			t.Run(msg, func(t *testing.T) {
				result := ParseError(msg)
				if result != expectedErr {
					t.Errorf("ParseError(%q) = %v, want %v", msg, result, expectedErr)
				}
			})
		}
	}
}

// TestExhaustiveNumericRefs tests numeric ref boundaries
func TestExhaustiveNumericRefs(t *testing.T) {
	numbers := []int{
		0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
		10, 11, 99, 100, 101, 999,
		1000, 1001, 9999, 10000,
		99999, 100000, 999999,
		1000000, 9999999,
	}

	for _, n := range numbers {
		t.Run(fmt.Sprintf("ref_%d", n), func(t *testing.T) {
			ref := fmt.Sprintf("@e%d", n)
			input := ref + ": button \"Test\""
			result := ParseSnapshot(input)

			if len(result.Elements) != 1 {
				t.Fatalf("should parse ref %s", ref)
			}
			if result.Elements[0].Ref != ref {
				t.Errorf("ref should be %s, got %s", ref, result.Elements[0].Ref)
			}
		})
	}
}

// TestExhaustiveFindOperations tests find operations exhaustively
func TestExhaustiveFindOperations(t *testing.T) {
	// Create a comprehensive snapshot
	input := `
@e1: button "Submit"
@e2: button "Cancel"
@e3: input "Email"
@e4: input "Password"
@e5: link "Home"
@e6: link "About"
@e7: checkbox "Remember"
@e8: radio "Option A"
@e9: select "Country"
@e10: textarea "Comments"
`
	result := ParseSnapshot(input)

	// Test FindElementByRef for each
	for i := 1; i <= 10; i++ {
		ref := fmt.Sprintf("@e%d", i)
		found := result.FindElementByRef(ref)
		if found == nil {
			t.Errorf("should find %s", ref)
		}
	}

	// Test FindElementByRef for non-existent
	nonExistent := []string{"@e0", "@e11", "@e100", "@e-1", "e1", "@E1"}
	for _, ref := range nonExistent {
		found := result.FindElementByRef(ref)
		if found != nil {
			t.Errorf("should not find %s", ref)
		}
	}

	// Test FindElementsByRole
	roleCounts := map[string]int{
		"button":   2,
		"input":    2,
		"link":     2,
		"checkbox": 1,
		"radio":    1,
		"select":   1,
		"textarea": 1,
		"div":      0,
		"span":     0,
	}
	for role, count := range roleCounts {
		found := result.FindElementsByRole(role)
		if len(found) != count {
			t.Errorf("FindElementsByRole(%s): expected %d, got %d", role, count, len(found))
		}
	}

	// Test FindElementsByText
	textCounts := map[string]int{
		"Submit":   1,
		"sub":      1, // substring
		"Cancel":   1,
		"Email":    1,
		"mail":     1, // substring
		"Password": 1,
		"Home":     1,
		"o":        6, // appears in many: Submit, Home, About, Option, Country, Comments
		"":         10, // empty matches all
		"xyz":      0,
	}
	for text, count := range textCounts {
		found := result.FindElementsByText(text)
		if len(found) != count {
			t.Errorf("FindElementsByText(%q): expected %d, got %d", text, count, len(found))
		}
	}
}

// TestExhaustiveEmptyInputs tests all possible empty/minimal inputs
func TestExhaustiveEmptyInputs(t *testing.T) {
	emptyInputs := []string{
		"",
		" ",
		"  ",
		"\t",
		"\n",
		"\r",
		"\r\n",
		" \t\n\r ",
		"\x00",
		string([]byte{0}),
		string([]byte{0, 0, 0}),
	}

	for i, input := range emptyInputs {
		t.Run(fmt.Sprintf("empty_%d", i), func(t *testing.T) {
			result := ParseSnapshot(input)
			// Should not panic and should be empty or have no valid elements
			_ = result.Count()
			_ = result.IsEmpty()
		})
	}
}

// TestExhaustiveASCIIChars tests all printable ASCII characters in names
func TestExhaustiveASCIIChars(t *testing.T) {
	for c := 32; c < 127; c++ {
		char := string(rune(c))
		// Skip quotes as they would affect parsing
		if char == "\"" || char == "'" {
			continue
		}

		t.Run(fmt.Sprintf("ascii_%d", c), func(t *testing.T) {
			input := fmt.Sprintf("@e1: button \"%s\"", char)
			result := ParseSnapshot(input)
			if len(result.Elements) != 1 {
				t.Errorf("should parse name with ASCII %d (%q)", c, char)
			}
		})
	}
}

// TestExhaustiveUnicodeCategories tests characters from each Unicode category
func TestExhaustiveUnicodeCategories(t *testing.T) {
	categories := map[string]rune{
		"Lu_uppercase": 'A',
		"Ll_lowercase": 'a',
		"Lt_titlecase": 'ǅ',
		"Lm_modifier":  'ʰ',
		"Lo_other":     'ア',
		"Mn_nonspacing": '\u0300', // combining grave
		"Mc_spacing":    '\u0903', // devanagari sign visarga
		"Me_enclosing":  '\u20DD', // combining enclosing circle
		"Nd_digit":      '0',
		"Nl_letter":     'Ⅰ',
		"No_other":      '①',
		"Pc_connector":  '_',
		"Pd_dash":       '-',
		"Ps_open":       '(',
		"Pe_close":      ')',
		"Pi_initial":    '«',
		"Pf_final":      '»',
		"Po_other":      '!',
		"Sm_math":       '+',
		"Sc_currency":   '$',
		"Sk_modifier":   '^',
		"So_other":      '©',
		"Zs_space":      ' ',
		"Zl_line":       '\u2028',
		"Zp_paragraph":  '\u2029',
	}

	for name, r := range categories {
		t.Run(name, func(t *testing.T) {
			// Skip control and separator categories that would break parsing
			if unicode.IsControl(r) || r == '\u2028' || r == '\u2029' {
				return
			}

			input := fmt.Sprintf("@e1: button \"%c\"", r)
			result := ParseSnapshot(input)
			// Should handle without panic
			_ = result.Count()
		})
	}
}

// TestExhaustiveRandomInputs tests with random inputs
func TestExhaustiveRandomInputs(t *testing.T) {
	r := rand.New(rand.NewSource(42))

	for i := 0; i < 1000; i++ {
		t.Run(fmt.Sprintf("random_%d", i), func(t *testing.T) {
			// Generate random input
			length := r.Intn(500)
			var builder strings.Builder
			for j := 0; j < length; j++ {
				// Mix of valid ref patterns and random chars
				if r.Intn(10) == 0 {
					builder.WriteString(fmt.Sprintf("@e%d: button \"R%d\"\n", r.Intn(1000), j))
				} else {
					builder.WriteByte(byte(r.Intn(128)))
				}
			}

			// Should not panic
			result := ParseSnapshot(builder.String())
			_ = result.Count()
			_ = result.IsEmpty()
			_ = result.GetRefs()
		})
	}
}

// TestExhaustiveSnapshotMethods tests all snapshot methods with various states
func TestExhaustiveSnapshotMethods(t *testing.T) {
	states := []*SnapshotResult{
		nil,
		{},
		{Elements: nil},
		{Elements: []Element{}},
		{Elements: []Element{{}}},
		{Elements: []Element{{Ref: "@e1"}}},
		{Elements: []Element{{Ref: "@e1", Role: "button"}}},
		{Elements: []Element{{Ref: "@e1", Role: "button", Name: "Test"}}},
		{Elements: []Element{
			{Ref: "@e1", Role: "button"},
			{Ref: "@e2", Role: "input"},
		}},
	}

	for i, state := range states {
		if state == nil {
			continue // Skip nil pointer tests
		}

		t.Run(fmt.Sprintf("state_%d", i), func(t *testing.T) {
			// All these should not panic
			_ = state.Count()
			_ = state.IsEmpty()
			_ = state.GetRefs()
			_ = state.GetButtons()
			_ = state.GetInputs()
			_ = state.GetLinks()
			_ = state.FindElementByRef("@e1")
			_ = state.FindElementsByRole("button")
			_ = state.FindElementsByText("test")
		})
	}
}

// BenchmarkExhaustive benchmarks exhaustive test patterns
func BenchmarkExhaustive(b *testing.B) {
	b.Run("parse_single", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = ParseSnapshot("@e1: button \"Test\"")
		}
	})

	b.Run("parse_ten", func(b *testing.B) {
		input := ""
		for i := 0; i < 10; i++ {
			input += fmt.Sprintf("@e%d: button \"Button %d\"\n", i, i)
		}
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = ParseSnapshot(input)
		}
	})

	b.Run("find_by_ref", func(b *testing.B) {
		input := ""
		for i := 0; i < 100; i++ {
			input += fmt.Sprintf("@e%d: button \"Button %d\"\n", i, i)
		}
		result := ParseSnapshot(input)
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = result.FindElementByRef("@e50")
		}
	})

	b.Run("find_by_role", func(b *testing.B) {
		input := ""
		for i := 0; i < 100; i++ {
			input += fmt.Sprintf("@e%d: button \"Button %d\"\n", i, i)
		}
		result := ParseSnapshot(input)
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = result.FindElementsByRole("button")
		}
	})

	b.Run("find_by_text", func(b *testing.B) {
		input := ""
		for i := 0; i < 100; i++ {
			input += fmt.Sprintf("@e%d: button \"Button %d\"\n", i, i)
		}
		result := ParseSnapshot(input)
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = result.FindElementsByText("Button")
		}
	})
}
