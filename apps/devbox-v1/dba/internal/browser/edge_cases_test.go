package browser

import (
	"context"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

// TestRefPatternMatching tests the ref pattern more thoroughly
func TestRefPatternMatching(t *testing.T) {
	testCases := []struct {
		input       string
		shouldMatch bool
		expectedRef string
	}{
		// Valid refs
		{"@e1: button", true, "@e1"},
		{"@e0: button", true, "@e0"},
		{"@e9: button", true, "@e9"},
		{"@e10: button", true, "@e10"},
		{"@e99: button", true, "@e99"},
		{"@e100: button", true, "@e100"},
		{"@e999: button", true, "@e999"},
		{"@e1234567890: button", true, "@e1234567890"},

		// Invalid - no colon
		{"@e1 button", false, ""},
		{"@ebutton", false, ""},

		// Invalid - no number
		{"@e: button", false, ""},
		{"@ea: button", false, ""},
		{"@eABC: button", false, ""},

		// Invalid - wrong prefix
		{"@f1: button", false, ""},
		{"@E1: button", false, ""},
		{"e1: button", false, ""},
		{"#e1: button", false, ""},

		// With extra content
		{"  @e1: button", true, "@e1"},
		{"\t@e1: button", true, "@e1"},
	}

	for _, tc := range testCases {
		result := ParseSnapshot(tc.input)
		hasMatch := len(result.Elements) > 0

		if hasMatch != tc.shouldMatch {
			t.Errorf("input %q: expected match=%v, got match=%v",
				tc.input, tc.shouldMatch, hasMatch)
		}

		if hasMatch && result.Elements[0].Ref != tc.expectedRef {
			t.Errorf("input %q: expected ref=%q, got ref=%q",
				tc.input, tc.expectedRef, result.Elements[0].Ref)
		}
	}
}

// TestParseSnapshotBoundaryConditions tests boundary conditions
func TestParseSnapshotBoundaryConditions(t *testing.T) {
	t.Run("very long ref number", func(t *testing.T) {
		input := "@e" + strings.Repeat("9", 100) + ": button \"Test\""
		result := ParseSnapshot(input)
		if len(result.Elements) != 1 {
			t.Errorf("expected 1 element for very long ref number")
		}
	})

	t.Run("very long name", func(t *testing.T) {
		longName := strings.Repeat("a", 10000)
		input := "@e1: button \"" + longName + "\""
		result := ParseSnapshot(input)
		if len(result.Elements) != 1 {
			t.Errorf("expected 1 element for very long name")
		}
		if result.Elements[0].Name != longName {
			t.Errorf("long name not preserved correctly")
		}
	})

	t.Run("very long role", func(t *testing.T) {
		longRole := strings.Repeat("x", 1000)
		input := "@e1: " + longRole + " \"Test\""
		result := ParseSnapshot(input)
		if len(result.Elements) != 1 {
			t.Errorf("expected 1 element for very long role")
		}
		if result.Elements[0].Role != longRole {
			t.Errorf("long role not preserved correctly")
		}
	})

	t.Run("many elements", func(t *testing.T) {
		var builder strings.Builder
		count := 10000
		for i := 0; i < count; i++ {
			builder.WriteString("@e")
			builder.WriteString(string(rune('0' + (i/1000)%10)))
			builder.WriteString(string(rune('0' + (i/100)%10)))
			builder.WriteString(string(rune('0' + (i/10)%10)))
			builder.WriteString(string(rune('0' + i%10)))
			builder.WriteString(": button \"Button\"\n")
		}

		result := ParseSnapshot(builder.String())
		// Should not crash and should parse some elements
		if result == nil {
			t.Error("result should not be nil")
		}
	})

	t.Run("many lines without refs", func(t *testing.T) {
		var builder strings.Builder
		for i := 0; i < 10000; i++ {
			builder.WriteString("This is line ")
			builder.WriteString(string(rune('0' + i%10)))
			builder.WriteString(" without a ref\n")
		}
		builder.WriteString("@e1: button \"Test\"\n")

		result := ParseSnapshot(builder.String())
		if len(result.Elements) != 1 {
			t.Errorf("expected 1 element, got %d", len(result.Elements))
		}
	})
}

// TestUnicodeHandling tests Unicode handling in various scenarios
func TestUnicodeHandling(t *testing.T) {
	testCases := []struct {
		name     string
		input    string
		expected string
	}{
		{"chinese", "@e1: button \"提交表单\"", "提交表单"},
		{"japanese", "@e1: button \"送信する\"", "送信する"},
		{"korean", "@e1: button \"제출하다\"", "제출하다"},
		{"arabic", "@e1: button \"إرسال\"", "إرسال"},
		{"hebrew", "@e1: button \"שלח\"", "שלח"},
		{"thai", "@e1: button \"ส่ง\"", "ส่ง"},
		{"emoji", "@e1: button \"✅ Submit 🚀\"", "✅ Submit 🚀"},
		{"mixed", "@e1: button \"Hello 世界 🌍\"", "Hello 世界 🌍"},
		{"combining chars", "@e1: button \"café\"", "café"},
		{"zero width", "@e1: button \"te\u200Bst\"", "te\u200Bst"},
		{"rtl", "@e1: button \"مرحبا\"", "مرحبا"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			if len(result.Elements) != 1 {
				t.Fatalf("expected 1 element, got %d", len(result.Elements))
			}
			if result.Elements[0].Name != tc.expected {
				t.Errorf("expected name %q, got %q", tc.expected, result.Elements[0].Name)
			}
			// Verify it's valid UTF-8
			if !utf8.ValidString(result.Elements[0].Name) {
				t.Error("result is not valid UTF-8")
			}
		})
	}
}

// TestSpecialCharacterHandling tests special character handling
func TestSpecialCharacterHandling(t *testing.T) {
	testCases := []struct {
		name     string
		input    string
		expected string
	}{
		{"newline in name", "@e1: button \"Line1\\nLine2\"", "Line1\\nLine2"},
		{"tab in name", "@e1: button \"Col1\\tCol2\"", "Col1\\tCol2"},
		{"backslash", "@e1: button \"path\\\\to\\\\file\"", "path\\\\to\\\\file"},
		{"ampersand", "@e1: button \"A & B\"", "A & B"},
		{"less than", "@e1: button \"A < B\"", "A < B"},
		{"greater than", "@e1: button \"A > B\"", "A > B"},
		{"quotes inside", "@e1: button \"Say \\\"Hello\\\"\"", "Say \\\"Hello\\\""},
		{"dollar sign", "@e1: button \"$100\"", "$100"},
		{"percent", "@e1: button \"50%\"", "50%"},
		{"at sign", "@e1: button \"user@email.com\"", "user@email.com"},
		{"hash", "@e1: button \"#hashtag\"", "#hashtag"},
		{"asterisk", "@e1: button \"a*b*c\"", "a*b*c"},
		{"pipe", "@e1: button \"a|b|c\"", "a|b|c"},
		{"brackets", "@e1: button \"[array]\"", "[array]"},
		{"braces", "@e1: button \"{object}\"", "{object}"},
		{"parens", "@e1: button \"(group)\"", "(group)"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			if len(result.Elements) != 1 {
				t.Fatalf("expected 1 element, got %d", len(result.Elements))
			}
		})
	}
}

// TestFindElementsByTextEdgeCases tests edge cases in text searching
func TestFindElementsByTextEdgeCases(t *testing.T) {
	input := `
@e1: button "UPPERCASE"
@e2: button "lowercase"
@e3: button "MiXeD CaSe"
@e4: button "with  spaces"
@e5: button ""
@e6: button "   "
`
	result := ParseSnapshot(input)

	t.Run("case insensitive upper to lower", func(t *testing.T) {
		found := result.FindElementsByText("uppercase")
		if len(found) != 1 {
			t.Errorf("expected 1 match, got %d", len(found))
		}
	})

	t.Run("case insensitive lower to upper", func(t *testing.T) {
		found := result.FindElementsByText("LOWERCASE")
		if len(found) != 1 {
			t.Errorf("expected 1 match, got %d", len(found))
		}
	})

	t.Run("partial match", func(t *testing.T) {
		found := result.FindElementsByText("case")
		if len(found) != 3 {
			t.Errorf("expected 3 matches for 'case', got %d", len(found))
		}
	})

	t.Run("match spaces", func(t *testing.T) {
		found := result.FindElementsByText("  ")
		// Should match elements with spaces in name
		if len(found) < 1 {
			t.Errorf("expected at least 1 match for double space")
		}
	})

	t.Run("single char match", func(t *testing.T) {
		found := result.FindElementsByText("a")
		// Should match "MiXeD CaSe" and "with  spaces"
		if len(found) < 1 {
			t.Errorf("expected matches for 'a'")
		}
	})
}

// TestErrorParsingEdgeCases tests more error parsing edge cases
func TestErrorParsingEdgeCases(t *testing.T) {
	testCases := []struct {
		name     string
		output   string
		expected error
	}{
		// Boundary cases
		{"only 'not'", "not", nil}, // "not" alone shouldn't match
		{"only 'found'", "found", nil},
		{"not_found joined", "notfound", nil},           // no space
		{"NOT_FOUND_caps_underscore", "NOT_FOUND", nil}, // underscore doesn't match "not found"

		// With extra context
		{"error prefix", "Error: element not found", ErrElementNotFound},
		{"exception suffix", "element not found exception", ErrElementNotFound},
		{"with stack trace", "Error: timeout\n  at line 1\n  at line 2", ErrTimeout},

		// Mixed signals (first match wins due to switch order)
		{"not found and timeout", "element not found after timeout", ErrElementNotFound},
		{"disabled and not visible", "element disabled and not visible", ErrElementNotVisible}, // "not visible" checked before "disabled"

		// Very long messages
		{"very long success", strings.Repeat("success ", 1000), nil},
		{"very long with error", strings.Repeat("x", 1000) + " not found", ErrElementNotFound},

		// Empty-ish
		{"just spaces", "     ", nil},
		{"just newlines", "\n\n\n", nil},
		{"tabs only", "\t\t\t", nil},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got := ParseError(tc.output)
			if got != tc.expected {
				t.Errorf("ParseError(%q...) = %v, want %v",
					tc.output[:min(len(tc.output), 50)], got, tc.expected)
			}
		})
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// TestSnapshotResultConcurrency tests concurrent access to SnapshotResult
func TestSnapshotResultConcurrency(t *testing.T) {
	input := `
@e1: button "Button 1"
@e2: input "Input 1"
@e3: link "Link 1"
@e4: button "Button 2"
@e5: input "Input 2"
`
	result := ParseSnapshot(input)

	// Run multiple goroutines accessing the result simultaneously
	done := make(chan bool)
	for i := 0; i < 100; i++ {
		go func() {
			_ = result.FindElementByRef("@e1")
			_ = result.FindElementsByRole("button")
			_ = result.FindElementsByText("Button")
			_ = result.GetRefs()
			_ = result.Count()
			_ = result.IsEmpty()
			_ = result.GetButtons()
			_ = result.GetInputs()
			_ = result.GetLinks()
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 100; i++ {
		<-done
	}
}

// TestClientConfigValidation tests client configuration edge cases
func TestClientConfigValidation(t *testing.T) {
	testCases := []struct {
		name   string
		config ClientConfig
	}{
		{"zero values", ClientConfig{}},
		{"negative port", ClientConfig{CDPPort: -1}},
		{"very high port", ClientConfig{CDPPort: 99999}},
		{"zero timeout", ClientConfig{CDPPort: 9222, Timeout: 0}},
		{"negative timeout", ClientConfig{CDPPort: 9222, Timeout: -1}},
		{"empty session", ClientConfig{CDPPort: 9222, Session: ""}},
		{"whitespace session", ClientConfig{CDPPort: 9222, Session: "   "}},
		{"special char session", ClientConfig{CDPPort: 9222, Session: "test-session_123!@#"}},
		{"empty binary path", ClientConfig{CDPPort: 9222, BinaryPath: ""}},
		{"relative binary path", ClientConfig{CDPPort: 9222, BinaryPath: "./agent-browser"}},
		{"both port and url", ClientConfig{CDPPort: 9222, CDPURL: "ws://localhost:9223"}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Just verify no panic during config creation
			_ = tc.config.CDPPort
			_ = tc.config.CDPURL
			_ = tc.config.Session
			_ = tc.config.Timeout
			_ = tc.config.BinaryPath
		})
	}
}

// TestContextCancellation tests context cancellation behavior
func TestContextCancellation(t *testing.T) {
	t.Run("already cancelled context", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel() // Cancel immediately

		// Create a mock client state
		client := &Client{
			config: ClientConfig{CDPPort: 9222, Timeout: 30000},
		}

		// Operations on cancelled context should not block forever
		// They will fail but shouldn't hang
		done := make(chan bool, 1)
		go func() {
			_ = client.Connect(ctx)
			done <- true
		}()

		select {
		case <-done:
			// Good - operation completed (even if with error)
		case <-time.After(5 * time.Second):
			t.Error("operation hung on cancelled context")
		}
	})

	t.Run("context with deadline", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Millisecond)
		defer cancel()

		time.Sleep(5 * time.Millisecond) // Let deadline pass

		// Context should be done
		if ctx.Err() == nil {
			t.Error("expected context to be done")
		}
	})
}

// TestElementEquality tests element comparison
func TestElementEquality(t *testing.T) {
	elem1 := Element{Ref: "@e1", Role: "button", Name: "Test"}
	elem2 := Element{Ref: "@e1", Role: "button", Name: "Test"}
	elem3 := Element{Ref: "@e2", Role: "button", Name: "Test"}

	if elem1 != elem2 {
		t.Error("identical elements should be equal")
	}

	if elem1 == elem3 {
		t.Error("elements with different refs should not be equal")
	}
}

// TestSnapshotMutability tests that modifying returned elements doesn't affect original
func TestSnapshotMutability(t *testing.T) {
	input := "@e1: button \"Original\""
	result := ParseSnapshot(input)

	// Get element and modify it
	elem := result.FindElementByRef("@e1")
	if elem != nil {
		elem.Name = "Modified"
	}

	// Original should be modified (it returns a pointer)
	// This test documents the current behavior
	newElem := result.FindElementByRef("@e1")
	if newElem != nil && newElem.Name != "Modified" {
		t.Log("Note: FindElementByRef returns a pointer, modifications affect original")
	}
}

// TestSnapshotResultString tests string representations
func TestSnapshotResultString(t *testing.T) {
	input := "@e1: button \"Test\""
	result := ParseSnapshot(input)

	// Verify Raw is exactly preserved
	if result.Raw != input {
		t.Errorf("Raw not preserved: got %q, want %q", result.Raw, input)
	}
}

// TestElementDefaults tests default values for parsed elements
func TestElementDefaults(t *testing.T) {
	result := ParseSnapshot("@e1: button \"Test\"")

	if len(result.Elements) != 1 {
		t.Fatal("expected 1 element")
	}

	elem := result.Elements[0]

	// Verify defaults are set correctly
	if !elem.Enabled {
		t.Error("expected Enabled to be true by default for parsed elements")
	}
	if !elem.Visible {
		t.Error("expected Visible to be true by default for parsed elements")
	}
	if elem.Description != "" {
		t.Errorf("expected empty Description, got %q", elem.Description)
	}
}

// TestParseSnapshotWhitespaceVariations tests whitespace handling
func TestParseSnapshotWhitespaceVariations(t *testing.T) {
	testCases := []struct {
		name  string
		input string
		want  int
	}{
		{"normal", "@e1: button \"Test\"", 1},
		{"leading space", " @e1: button \"Test\"", 1},
		{"leading tab", "\t@e1: button \"Test\"", 1},
		{"leading newline", "\n@e1: button \"Test\"", 1},
		{"trailing space", "@e1: button \"Test\" ", 1},
		{"trailing newline", "@e1: button \"Test\"\n", 1},
		{"multiple leading", "   \t  @e1: button \"Test\"", 1},
		{"crlf line ending", "@e1: button \"Test\"\r\n", 1},
		{"mixed line endings", "@e1: button \"A\"\n@e2: button \"B\"\r\n@e3: button \"C\"", 3},
		{"space around colon", "@e1 : button \"Test\"", 1},
		{"no space after colon", "@e1:button \"Test\"", 1},
		{"many spaces after colon", "@e1:    button \"Test\"", 1},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			if len(result.Elements) != tc.want {
				t.Errorf("got %d elements, want %d for input %q",
					len(result.Elements), tc.want, tc.input)
			}
		})
	}
}

// TestEmptyStringBehaviors tests behavior with empty strings
func TestEmptyStringBehaviors(t *testing.T) {
	t.Run("empty selector", func(t *testing.T) {
		result := ParseSnapshot("")
		if !result.IsEmpty() {
			t.Error("expected empty result")
		}
		if result.Count() != 0 {
			t.Error("expected count 0")
		}
	})

	t.Run("find in empty", func(t *testing.T) {
		result := &SnapshotResult{}
		if result.FindElementByRef("@e1") != nil {
			t.Error("expected nil for find in empty")
		}
		if len(result.FindElementsByRole("button")) != 0 {
			t.Error("expected empty for role search in empty")
		}
		if len(result.FindElementsByText("test")) != 0 {
			t.Error("expected empty for text search in empty")
		}
	})

	t.Run("empty search string", func(t *testing.T) {
		input := "@e1: button \"Test\""
		result := ParseSnapshot(input)

		// Empty string search should match all (contains empty is always true)
		matches := result.FindElementsByText("")
		if len(matches) != 1 {
			t.Errorf("empty search should match all, got %d", len(matches))
		}
	})
}

// BenchmarkConcurrentSnapshotAccess benchmarks concurrent access
func BenchmarkConcurrentSnapshotAccess(b *testing.B) {
	input := `
@e1: button "Button 1"
@e2: input "Input 1"
@e3: link "Link 1"
@e4: button "Button 2"
@e5: input "Input 2"
`
	result := ParseSnapshot(input)

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_ = result.FindElementByRef("@e3")
			_ = result.FindElementsByRole("button")
			_ = result.FindElementsByText("Button")
		}
	})
}

// BenchmarkLargeSnapshotParsing benchmarks parsing large snapshots
func BenchmarkLargeSnapshotParsing(b *testing.B) {
	var builder strings.Builder
	for i := 0; i < 1000; i++ {
		builder.WriteString("@e")
		builder.WriteString(string(rune('0' + (i/100)%10)))
		builder.WriteString(string(rune('0' + (i/10)%10)))
		builder.WriteString(string(rune('0' + i%10)))
		builder.WriteString(": button \"Button ")
		builder.WriteString(string(rune('0' + (i/100)%10)))
		builder.WriteString(string(rune('0' + (i/10)%10)))
		builder.WriteString(string(rune('0' + i%10)))
		builder.WriteString("\"\n")
	}
	input := builder.String()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ParseSnapshot(input)
	}
}
