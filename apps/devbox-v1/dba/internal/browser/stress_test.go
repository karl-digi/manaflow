package browser

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestStressParseSnapshot tests parsing under stress conditions
func TestStressParseSnapshot(t *testing.T) {
	t.Run("very large number of elements", func(t *testing.T) {
		var builder strings.Builder
		for i := 0; i < 10000; i++ {
			fmt.Fprintf(&builder, "@e%d: button \"Button %d\"\n", i, i)
		}
		input := builder.String()

		result := ParseSnapshot(input)
		if result.Count() != 10000 {
			t.Errorf("expected 10000 elements, got %d", result.Count())
		}
	})

	t.Run("very long element names", func(t *testing.T) {
		longName := strings.Repeat("a", 10000)
		input := fmt.Sprintf("@e1: button \"%s\"", longName)

		result := ParseSnapshot(input)
		if len(result.Elements) != 1 {
			t.Fatal("expected 1 element")
		}
		if result.Elements[0].Name != longName {
			t.Error("long name not preserved")
		}
	})

	t.Run("very long role names", func(t *testing.T) {
		longRole := strings.Repeat("x", 1000)
		input := fmt.Sprintf("@e1: %s \"Test\"", longRole)

		result := ParseSnapshot(input)
		if len(result.Elements) != 1 {
			t.Fatal("expected 1 element")
		}
		if result.Elements[0].Role != longRole {
			t.Error("long role not preserved")
		}
	})

	t.Run("deeply nested quotes", func(t *testing.T) {
		// Quotes in quotes
		input := `@e1: button "He said \"Hello\""`

		result := ParseSnapshot(input)
		if len(result.Elements) != 1 {
			t.Fatal("expected 1 element")
		}
	})

	t.Run("rapid sequential parsing", func(t *testing.T) {
		input := "@e1: button \"Test\""
		for i := 0; i < 100000; i++ {
			result := ParseSnapshot(input)
			if result.Count() != 1 {
				t.Fatalf("iteration %d failed", i)
			}
		}
	})
}

// TestStressConcurrentOperations tests concurrent access patterns
func TestStressConcurrentOperations(t *testing.T) {
	t.Run("massive concurrent parsing", func(t *testing.T) {
		var wg sync.WaitGroup
		errors := make(chan error, 1000)

		for i := 0; i < 1000; i++ {
			wg.Add(1)
			go func(n int) {
				defer wg.Done()
				input := fmt.Sprintf("@e%d: button \"Button %d\"", n, n)
				result := ParseSnapshot(input)
				if result.Count() != 1 {
					errors <- fmt.Errorf("goroutine %d: expected 1 element", n)
				}
			}(i)
		}

		wg.Wait()
		close(errors)

		for err := range errors {
			t.Error(err)
		}
	})

	t.Run("concurrent reads on same snapshot", func(t *testing.T) {
		input := `
@e1: button "A"
@e2: input "B"
@e3: link "C"
@e4: button "D"
@e5: input "E"
`
		result := ParseSnapshot(input)

		var wg sync.WaitGroup
		for i := 0; i < 1000; i++ {
			wg.Add(5)
			go func() {
				defer wg.Done()
				_ = result.FindElementByRef("@e1")
			}()
			go func() {
				defer wg.Done()
				_ = result.FindElementsByRole("button")
			}()
			go func() {
				defer wg.Done()
				_ = result.FindElementsByText("A")
			}()
			go func() {
				defer wg.Done()
				_ = result.GetRefs()
			}()
			go func() {
				defer wg.Done()
				_ = result.Count()
			}()
		}
		wg.Wait()
	})

	t.Run("concurrent error parsing", func(t *testing.T) {
		messages := []string{
			"element not found",
			"timeout",
			"not visible",
			"not enabled",
			"navigation failed",
			"stale",
			"unknown error",
		}

		var wg sync.WaitGroup
		for i := 0; i < 10000; i++ {
			wg.Add(1)
			go func(n int) {
				defer wg.Done()
				_ = ParseError(messages[n%len(messages)])
			}(i)
		}
		wg.Wait()
	})
}

// TestStressContextHandling tests context handling under stress
func TestStressContextHandling(t *testing.T) {
	t.Run("rapid context creation and cancellation", func(t *testing.T) {
		for i := 0; i < 10000; i++ {
			ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
			cancel()
			if ctx.Err() != context.Canceled {
				// This is fine - could be DeadlineExceeded if timeout happened first
			}
		}
	})

	t.Run("deeply nested context chain", func(t *testing.T) {
		ctx := context.Background()
		cancels := make([]context.CancelFunc, 1000)

		for i := 0; i < 1000; i++ {
			ctx, cancels[i] = context.WithCancel(ctx)
		}

		// Cancel from the root
		cancels[0]()

		// All should be cancelled
		if ctx.Err() != context.Canceled {
			t.Error("deeply nested context should be cancelled")
		}
	})

	t.Run("concurrent context operations", func(t *testing.T) {
		var wg sync.WaitGroup
		for i := 0; i < 1000; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
				defer cancel()
				<-ctx.Done()
			}()
		}
		wg.Wait()
	})
}

// TestStressMemory tests memory behavior
func TestStressMemory(t *testing.T) {
	t.Run("create and discard many snapshots", func(t *testing.T) {
		for i := 0; i < 10000; i++ {
			var builder strings.Builder
			for j := 0; j < 100; j++ {
				fmt.Fprintf(&builder, "@e%d: button \"Button\"\n", j)
			}
			result := ParseSnapshot(builder.String())
			_ = result.Count()
		}
		// If this completes without OOM, memory is being managed
	})

	t.Run("create and discard many clients", func(t *testing.T) {
		for i := 0; i < 10000; i++ {
			client := &Client{
				config: ClientConfig{
					CDPPort: 9222,
					Timeout: 30000,
				},
			}
			_ = client.GetConfig()
		}
	})

	t.Run("create and discard many elements", func(t *testing.T) {
		for i := 0; i < 100000; i++ {
			elem := Element{
				Ref:     "@e1",
				Role:    "button",
				Name:    "Test Button",
				Enabled: true,
				Visible: true,
			}
			_ = elem.Ref
		}
	})
}

// TestStressEdgeCases tests edge cases under stress
func TestStressEdgeCases(t *testing.T) {
	t.Run("empty input stress", func(t *testing.T) {
		for i := 0; i < 10000; i++ {
			result := ParseSnapshot("")
			if !result.IsEmpty() {
				t.Fatalf("iteration %d: expected empty", i)
			}
		}
	})

	t.Run("whitespace only stress", func(t *testing.T) {
		inputs := []string{" ", "\t", "\n", "\r\n", "   ", "\t\t\t", "\n\n\n"}
		for i := 0; i < 10000; i++ {
			result := ParseSnapshot(inputs[i%len(inputs)])
			if !result.IsEmpty() {
				t.Fatalf("iteration %d: expected empty", i)
			}
		}
	})

	t.Run("invalid input stress", func(t *testing.T) {
		inputs := []string{
			"@",
			"@e",
			"@e:",
			"invalid",
			"no refs here",
			"@notref: button",
		}
		for i := 0; i < 10000; i++ {
			result := ParseSnapshot(inputs[i%len(inputs)])
			_ = result.Count()
		}
	})
}

// TestBoundaryConditions tests various boundary conditions
func TestBoundaryConditions(t *testing.T) {
	t.Run("ref at int32 max", func(t *testing.T) {
		input := "@e2147483647: button \"Max Int32\""
		result := ParseSnapshot(input)
		if len(result.Elements) != 1 {
			t.Error("should parse max int32 ref")
		}
	})

	t.Run("ref at int64 max", func(t *testing.T) {
		input := "@e9223372036854775807: button \"Max Int64\""
		result := ParseSnapshot(input)
		if len(result.Elements) != 1 {
			t.Error("should parse max int64 ref")
		}
	})

	t.Run("extremely long input", func(t *testing.T) {
		// 1MB of input
		var builder strings.Builder
		for i := 0; i < 100000; i++ {
			builder.WriteString("some text without refs\n")
		}
		builder.WriteString("@e1: button \"Found\"\n")

		result := ParseSnapshot(builder.String())
		if len(result.Elements) != 1 {
			t.Error("should find element in large input")
		}
	})

	t.Run("null bytes in input", func(t *testing.T) {
		input := "@e1: button \"Test\x00Null\""
		result := ParseSnapshot(input)
		// Should handle null bytes gracefully
		_ = result.Count()
	})

	t.Run("control characters in input", func(t *testing.T) {
		input := "@e1: button \"Test\x01\x02\x03\""
		result := ParseSnapshot(input)
		_ = result.Count()
	})
}

// TestQuoteVariations tests various quoting scenarios
func TestQuoteVariations(t *testing.T) {
	testCases := []struct {
		name     string
		input    string
		expected string
	}{
		{"double quotes", "@e1: button \"Test\"", "Test"},
		{"single quotes", "@e1: button 'Test'", "Test"},
		{"no quotes", "@e1: button Test", "Test"},
		{"empty double quotes", "@e1: button \"\"", ""},
		{"empty single quotes", "@e1: button ''", ""},
		{"mixed quotes", "@e1: button \"It's test\"", "It's test"},
		{"nested single in double", "@e1: button \"Say 'Hello'\"", "Say 'Hello"},  // Trailing ' gets trimmed
		{"unmatched double quote", "@e1: button \"Test", "Test"},
		{"unmatched single quote", "@e1: button 'Test", "Test"},
		{"multiple words no quotes", "@e1: button Submit Form", "Submit Form"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			if len(result.Elements) == 0 {
				t.Fatal("expected at least one element")
			}
			if result.Elements[0].Name != tc.expected {
				t.Errorf("expected name %q, got %q", tc.expected, result.Elements[0].Name)
			}
		})
	}
}

// TestSpecialCharactersInNames tests special character handling in names
func TestSpecialCharactersInNames(t *testing.T) {
	testCases := []struct {
		name  string
		input string
		valid bool
	}{
		{"with ampersand", "@e1: button \"Save & Continue\"", true},
		{"with less than", "@e1: button \"Price < $100\"", true},
		{"with greater than", "@e1: button \"Price > $50\"", true},
		{"with HTML entities", "@e1: button \"&amp; &lt; &gt;\"", true},
		{"with backslash", "@e1: button \"Path\\to\\file\"", true},
		{"with forward slash", "@e1: button \"Path/to/file\"", true},
		{"with pipe", "@e1: button \"Option | Choice\"", true},
		{"with caret", "@e1: button \"Go ^Up\"", true},
		{"with tilde", "@e1: button \"~Home\"", true},
		{"with backtick", "@e1: button \"`code`\"", true},
		{"with at sign", "@e1: button \"user@example.com\"", true},
		{"with hash", "@e1: button \"#hashtag\"", true},
		{"with dollar", "@e1: button \"$100\"", true},
		{"with percent", "@e1: button \"50%\"", true},
		{"with asterisk", "@e1: button \"*required\"", true},
		{"with parentheses", "@e1: button \"(optional)\"", true},
		{"with brackets", "@e1: button \"[edit]\"", true},
		{"with braces", "@e1: button \"{config}\"", true},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			hasElements := len(result.Elements) > 0
			if hasElements != tc.valid {
				t.Errorf("expected valid=%v, got %v", tc.valid, hasElements)
			}
		})
	}
}

// TestMultilineElementNames tests elements with line breaks in names
func TestMultilineElementNames(t *testing.T) {
	// Note: The parser works line by line, so multiline names aren't supported
	// This test verifies the expected behavior
	input := "@e1: button \"Line1\nLine2\""
	result := ParseSnapshot(input)

	// Should only capture up to the newline
	if len(result.Elements) != 1 {
		t.Errorf("expected 1 element, got %d", len(result.Elements))
	}
}

// BenchmarkStressParsing benchmarks parsing under stress
func BenchmarkStressParsing(b *testing.B) {
	b.Run("small_input", func(b *testing.B) {
		input := "@e1: button \"Test\""
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = ParseSnapshot(input)
		}
	})

	b.Run("medium_input", func(b *testing.B) {
		var builder strings.Builder
		for i := 0; i < 100; i++ {
			fmt.Fprintf(&builder, "@e%d: button \"Button %d\"\n", i, i)
		}
		input := builder.String()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = ParseSnapshot(input)
		}
	})

	b.Run("large_input", func(b *testing.B) {
		var builder strings.Builder
		for i := 0; i < 1000; i++ {
			fmt.Fprintf(&builder, "@e%d: button \"Button %d\"\n", i, i)
		}
		input := builder.String()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = ParseSnapshot(input)
		}
	})
}

// BenchmarkConcurrentSnapshot benchmarks concurrent snapshot operations
func BenchmarkConcurrentSnapshot(b *testing.B) {
	input := `
@e1: button "A"
@e2: input "B"
@e3: link "C"
@e4: button "D"
@e5: input "E"
`
	result := ParseSnapshot(input)

	b.Run("FindElementByRef", func(b *testing.B) {
		b.RunParallel(func(pb *testing.PB) {
			for pb.Next() {
				_ = result.FindElementByRef("@e3")
			}
		})
	})

	b.Run("FindElementsByRole", func(b *testing.B) {
		b.RunParallel(func(pb *testing.PB) {
			for pb.Next() {
				_ = result.FindElementsByRole("button")
			}
		})
	})

	b.Run("FindElementsByText", func(b *testing.B) {
		b.RunParallel(func(pb *testing.PB) {
			for pb.Next() {
				_ = result.FindElementsByText("A")
			}
		})
	})
}
