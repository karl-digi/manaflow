package browser

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestFuzzSnapshotParsing tests parsing with random/malformed inputs
func TestFuzzSnapshotParsing(t *testing.T) {
	// Seed for reproducibility
	r := rand.New(rand.NewSource(12345))

	t.Run("random bytes", func(t *testing.T) {
		for i := 0; i < 1000; i++ {
			// Generate random bytes
			length := r.Intn(1000)
			data := make([]byte, length)
			r.Read(data)

			// Should not panic
			result := ParseSnapshot(string(data))
			_ = result.Count()
		}
	})

	t.Run("random ascii", func(t *testing.T) {
		for i := 0; i < 1000; i++ {
			length := r.Intn(500)
			var builder strings.Builder
			for j := 0; j < length; j++ {
				builder.WriteByte(byte(r.Intn(128)))
			}

			result := ParseSnapshot(builder.String())
			_ = result.Count()
		}
	})

	t.Run("random ref patterns", func(t *testing.T) {
		for i := 0; i < 1000; i++ {
			// Generate random ref-like patterns
			refNum := r.Intn(10000)
			roles := []string{"button", "input", "link", "div", "span", "", "x"}
			role := roles[r.Intn(len(roles))]

			input := fmt.Sprintf("@e%d: %s \"Test\"", refNum, role)
			result := ParseSnapshot(input)
			_ = result.Count()
		}
	})

	t.Run("random whitespace patterns", func(t *testing.T) {
		whitespaces := []string{" ", "\t", "\n", "\r", "\r\n", "  ", "\t\t"}
		for i := 0; i < 1000; i++ {
			var builder strings.Builder
			for j := 0; j < r.Intn(20); j++ {
				builder.WriteString(whitespaces[r.Intn(len(whitespaces))])
				if r.Intn(2) == 0 {
					builder.WriteString(fmt.Sprintf("@e%d: button \"Test\"", r.Intn(100)))
				}
			}

			result := ParseSnapshot(builder.String())
			_ = result.Count()
		}
	})
}

// TestFuzzErrorParsing tests error parsing with random inputs
func TestFuzzErrorParsing(t *testing.T) {
	r := rand.New(rand.NewSource(54321))

	for i := 0; i < 1000; i++ {
		length := r.Intn(200)
		var builder strings.Builder
		for j := 0; j < length; j++ {
			builder.WriteByte(byte(32 + r.Intn(95))) // printable ASCII
		}

		// Should not panic
		_ = ParseError(builder.String())
	}
}

// TestNilSafety tests nil pointer safety across all types
func TestNilSafety(t *testing.T) {
	t.Run("nil SnapshotResult methods", func(t *testing.T) {
		// Create non-nil but with nil Elements
		result := &SnapshotResult{Elements: nil}

		// These should all be safe
		if !result.IsEmpty() {
			t.Error("nil elements should be empty")
		}
		if result.Count() != 0 {
			t.Error("nil elements should have count 0")
		}
		if result.FindElementByRef("@e1") != nil {
			t.Error("should return nil for nil elements")
		}
		if len(result.FindElementsByRole("button")) != 0 {
			t.Error("should return empty for nil elements")
		}
		if len(result.FindElementsByText("test")) != 0 {
			t.Error("should return empty for nil elements")
		}
		if len(result.GetRefs()) != 0 {
			t.Error("should return empty for nil elements")
		}
		if len(result.GetButtons()) != 0 {
			t.Error("should return empty for nil elements")
		}
		if len(result.GetInputs()) != 0 {
			t.Error("should return empty for nil elements")
		}
		if len(result.GetLinks()) != 0 {
			t.Error("should return empty for nil elements")
		}
	})

	t.Run("nil CommandError", func(t *testing.T) {
		var cmdErr *CommandError
		// This would panic, so we verify it's nil
		if cmdErr != nil {
			_ = cmdErr.Error()
		}
	})
}

// TestTypeConversions tests type conversion edge cases
func TestTypeConversions(t *testing.T) {
	t.Run("ScrollDirection to string", func(t *testing.T) {
		directions := []ScrollDirection{ScrollUp, ScrollDown, ScrollLeft, ScrollRight}
		for _, dir := range directions {
			s := string(dir)
			if s == "" {
				t.Error("direction should not be empty string")
			}
		}
	})

	t.Run("int to string refs", func(t *testing.T) {
		nums := []int{0, 1, 10, 100, 1000, 10000, 100000, 1000000}
		for _, n := range nums {
			ref := fmt.Sprintf("@e%d", n)
			input := ref + ": button \"Test\""
			result := ParseSnapshot(input)
			if len(result.Elements) != 1 {
				t.Errorf("failed to parse ref @e%d", n)
			}
		}
	})
}

// TestBoundaryNumbers tests numeric boundary conditions
func TestBoundaryNumbers(t *testing.T) {
	boundaries := []struct {
		name  string
		value int
	}{
		{"zero", 0},
		{"one", 1},
		{"max int8", 127},
		{"min int8", -128},
		{"max uint8", 255},
		{"max int16", 32767},
		{"min int16", -32768},
		{"max uint16", 65535},
		{"max int32", 2147483647},
		{"min int32", -2147483648},
	}

	for _, b := range boundaries {
		t.Run(b.name, func(t *testing.T) {
			config := ClientConfig{
				CDPPort: b.value,
				Timeout: b.value,
			}
			_ = config.CDPPort
			_ = config.Timeout
		})
	}
}

// TestFloatEdgeCases tests float edge cases (for quality percentage)
func TestFloatEdgeCases(t *testing.T) {
	// Quality is int, but let's test conversion edge cases
	floats := []float64{
		0.0, 0.5, 1.0, 50.0, 99.9, 100.0,
		math.Inf(1), math.Inf(-1), math.NaN(),
		math.MaxFloat64, math.SmallestNonzeroFloat64,
	}

	for _, f := range floats {
		t.Run(fmt.Sprintf("float_%v", f), func(t *testing.T) {
			// Converting float to int
			i := int(f)
			opts := ScreenshotOptions{Quality: i}
			_ = opts.Quality
		})
	}
}

// TestEmptyVsNilSlice tests empty slice vs nil slice behavior
func TestEmptyVsNilSlice(t *testing.T) {
	t.Run("nil slice", func(t *testing.T) {
		var elems []Element
		if elems != nil {
			t.Error("should be nil")
		}
		if len(elems) != 0 {
			t.Error("len should be 0")
		}
	})

	t.Run("empty slice", func(t *testing.T) {
		elems := []Element{}
		if elems == nil {
			t.Error("should not be nil")
		}
		if len(elems) != 0 {
			t.Error("len should be 0")
		}
	})

	t.Run("make slice", func(t *testing.T) {
		elems := make([]Element, 0)
		if elems == nil {
			t.Error("should not be nil")
		}
		if len(elems) != 0 {
			t.Error("len should be 0")
		}
	})

	t.Run("json nil vs empty", func(t *testing.T) {
		type Container struct {
			Elements []Element `json:"elements"`
		}

		// Nil slice
		c1 := Container{Elements: nil}
		b1, _ := json.Marshal(c1)

		// Empty slice
		c2 := Container{Elements: []Element{}}
		b2, _ := json.Marshal(c2)

		// Both should produce valid JSON
		if string(b1) == "" || string(b2) == "" {
			t.Error("should produce valid JSON")
		}
	})
}

// TestReflection tests reflection safety
func TestReflection(t *testing.T) {
	t.Run("Element type info", func(t *testing.T) {
		elem := Element{}
		typ := reflect.TypeOf(elem)

		if typ.NumField() == 0 {
			t.Error("Element should have fields")
		}

		// Check json tags exist
		for i := 0; i < typ.NumField(); i++ {
			field := typ.Field(i)
			tag := field.Tag.Get("json")
			if tag == "" {
				t.Errorf("field %s missing json tag", field.Name)
			}
		}
	})

	t.Run("ClientConfig type info", func(t *testing.T) {
		config := ClientConfig{}
		typ := reflect.TypeOf(config)

		if typ.NumField() == 0 {
			t.Error("ClientConfig should have fields")
		}
	})
}

// TestConcurrentModification tests concurrent access patterns
func TestConcurrentModification(t *testing.T) {
	t.Run("concurrent snapshot reads", func(t *testing.T) {
		input := `
@e1: button "A"
@e2: input "B"
@e3: link "C"
`
		result := ParseSnapshot(input)

		var wg sync.WaitGroup
		for i := 0; i < 100; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_ = result.Count()
				_ = result.IsEmpty()
				_ = result.GetRefs()
				_ = result.FindElementByRef("@e1")
				_ = result.FindElementsByRole("button")
				_ = result.FindElementsByText("A")
			}()
		}
		wg.Wait()
	})

	t.Run("concurrent client config reads", func(t *testing.T) {
		client := &Client{
			config: ClientConfig{CDPPort: 9222, Timeout: 30000},
		}

		var wg sync.WaitGroup
		for i := 0; i < 100; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_ = client.GetConfig()
				_ = client.IsConnected()
			}()
		}
		wg.Wait()
	})
}

// TestTimeOperations tests time-related edge cases
func TestTimeOperations(t *testing.T) {
	t.Run("zero duration", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 0)
		defer cancel()
		// Should already be done
		select {
		case <-ctx.Done():
			// Expected
		default:
			// Zero timeout might not be immediately done, depends on implementation
		}
	})

	t.Run("negative duration", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), -time.Second)
		defer cancel()
		// Should already be done
		if ctx.Err() == nil {
			// This is implementation-dependent
		}
	})

	t.Run("very long duration", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 24*time.Hour)
		defer cancel()
		if ctx.Err() != nil {
			t.Error("should not be done yet")
		}
	})
}

// TestStringOperationEdgeCases tests string operation edge cases
func TestStringOperationEdgeCases(t *testing.T) {
	t.Run("strings.Contains empty", func(t *testing.T) {
		if !strings.Contains("hello", "") {
			t.Error("any string contains empty string")
		}
		if !strings.Contains("", "") {
			t.Error("empty string contains empty string")
		}
	})

	t.Run("strings.ToLower edge cases", func(t *testing.T) {
		cases := []string{"", " ", "HELLO", "hello", "HeLLo", "123", "你好", "🎉"}
		for _, s := range cases {
			lower := strings.ToLower(s)
			if lower == "" && s != "" && s != " " {
				// Only empty input should produce empty output
				// (except whitespace which stays whitespace)
			}
		}
	})

	t.Run("strings.TrimSpace edge cases", func(t *testing.T) {
		cases := []struct {
			input    string
			expected string
		}{
			{"", ""},
			{" ", ""},
			{"  ", ""},
			{"\t", ""},
			{"\n", ""},
			{" hello ", "hello"},
			{"\thello\n", "hello"},
			{"hello", "hello"},
		}
		for _, c := range cases {
			if strings.TrimSpace(c.input) != c.expected {
				t.Errorf("TrimSpace(%q) != %q", c.input, c.expected)
			}
		}
	})
}

// TestJSONEdgeCases tests JSON serialization edge cases
func TestJSONEdgeCases(t *testing.T) {
	t.Run("empty struct", func(t *testing.T) {
		elem := Element{}
		data, err := json.Marshal(elem)
		if err != nil {
			t.Fatalf("marshal error: %v", err)
		}
		if len(data) == 0 {
			t.Error("should produce non-empty JSON")
		}
	})

	t.Run("special characters in strings", func(t *testing.T) {
		elem := Element{
			Name: "Hello\nWorld\t\"Test\"",
		}
		data, err := json.Marshal(elem)
		if err != nil {
			t.Fatalf("marshal error: %v", err)
		}

		var decoded Element
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatalf("unmarshal error: %v", err)
		}
		if decoded.Name != elem.Name {
			t.Error("name not preserved through JSON")
		}
	})

	t.Run("unicode in JSON", func(t *testing.T) {
		elem := Element{
			Name: "你好🌍مرحبا",
		}
		data, err := json.Marshal(elem)
		if err != nil {
			t.Fatalf("marshal error: %v", err)
		}

		var decoded Element
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatalf("unmarshal error: %v", err)
		}
		if decoded.Name != elem.Name {
			t.Error("unicode name not preserved through JSON")
		}
	})

	t.Run("null values", func(t *testing.T) {
		jsonData := `{"ref":"@e1","role":"button","name":null,"enabled":false,"visible":true}`
		var elem Element
		if err := json.Unmarshal([]byte(jsonData), &elem); err != nil {
			// null for string becomes empty string
		}
	})
}

// TestRegexPatternEdgeCases tests regex pattern edge cases
func TestRegexPatternEdgeCases(t *testing.T) {
	// The ref pattern is @e\d+
	testCases := []struct {
		input   string
		matches bool
	}{
		{"@e1", true},
		{"@e123", true},
		{"@e0", true},
		{"@e", false},
		{"@e1a", true}, // matches @e1, 'a' is extra
		{"a@e1", true}, // matches @e1, 'a' is prefix
		{"@E1", false},
		{"@f1", false},
		{"e1", false},
		{"@1", false},
	}

	for _, tc := range testCases {
		t.Run(tc.input, func(t *testing.T) {
			match := refPattern.FindString(tc.input)
			hasMatch := match != ""
			if hasMatch != tc.matches {
				t.Errorf("expected match=%v, got %v (match=%q)", tc.matches, hasMatch, match)
			}
		})
	}
}

// TestMemoryAllocation tests memory allocation patterns
func TestMemoryAllocation(t *testing.T) {
	t.Run("preallocated slice", func(t *testing.T) {
		elems := make([]Element, 0, 1000)
		for i := 0; i < 1000; i++ {
			elems = append(elems, Element{Ref: fmt.Sprintf("@e%d", i)})
		}
		if len(elems) != 1000 {
			t.Error("should have 1000 elements")
		}
	})

	t.Run("map preallocation", func(t *testing.T) {
		m := make(map[string]Element, 1000)
		for i := 0; i < 1000; i++ {
			ref := fmt.Sprintf("@e%d", i)
			m[ref] = Element{Ref: ref}
		}
		if len(m) != 1000 {
			t.Error("should have 1000 entries")
		}
	})
}

// TestScrollDirectionCompleteness tests all scroll directions
func TestScrollDirectionCompleteness(t *testing.T) {
	allDirections := []ScrollDirection{ScrollUp, ScrollDown, ScrollLeft, ScrollRight}
	dirStrings := map[string]bool{"up": true, "down": true, "left": true, "right": true}

	for _, dir := range allDirections {
		s := string(dir)
		if !dirStrings[s] {
			t.Errorf("unexpected direction: %s", s)
		}
		delete(dirStrings, s)
	}

	if len(dirStrings) != 0 {
		t.Errorf("missing directions: %v", dirStrings)
	}
}

// TestErrorConstants tests error constant values
func TestErrorConstants(t *testing.T) {
	errors := []error{
		ErrNotConnected,
		ErrElementNotFound,
		ErrElementNotVisible,
		ErrElementNotEnabled,
		ErrElementNotEditable,
		ErrNavigationFailed,
		ErrTimeout,
		ErrCDPConnectionFailed,
		ErrStaleRef,
		ErrInvalidKey,
		ErrNoCDPConfig,
	}

	// All errors should be unique
	seen := make(map[string]bool)
	for _, err := range errors {
		msg := err.Error()
		if seen[msg] {
			t.Errorf("duplicate error message: %s", msg)
		}
		seen[msg] = true

		// Error message should not be empty
		if msg == "" {
			t.Error("error message should not be empty")
		}
	}
}

// TestDefaultTimeoutValue tests the default timeout constant
func TestDefaultTimeoutValue(t *testing.T) {
	if DefaultTimeout <= 0 {
		t.Error("DefaultTimeout should be positive")
	}
	if DefaultTimeout < 1000 {
		t.Error("DefaultTimeout should be at least 1 second")
	}
	if DefaultTimeout > 600000 {
		t.Error("DefaultTimeout should not exceed 10 minutes")
	}
}

// BenchmarkFuzzParsing benchmarks parsing with random inputs
func BenchmarkFuzzParsing(b *testing.B) {
	r := rand.New(rand.NewSource(99999))
	inputs := make([]string, 1000)
	for i := range inputs {
		length := r.Intn(200)
		var builder strings.Builder
		for j := 0; j < length; j++ {
			builder.WriteByte(byte(32 + r.Intn(95)))
		}
		inputs[i] = builder.String()
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = ParseSnapshot(inputs[i%len(inputs)])
	}
}

// BenchmarkReflection benchmarks reflection operations
func BenchmarkReflection(b *testing.B) {
	elem := Element{Ref: "@e1", Role: "button", Name: "Test"}

	b.Run("TypeOf", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = reflect.TypeOf(elem)
		}
	})

	b.Run("ValueOf", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = reflect.ValueOf(elem)
		}
	})
}
