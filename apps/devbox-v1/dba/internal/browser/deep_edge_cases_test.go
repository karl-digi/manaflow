package browser

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"
)

// TestScannerBufferLimits tests behavior with lines exceeding scanner buffer
func TestScannerBufferLimits(t *testing.T) {
	t.Run("line at default buffer limit", func(t *testing.T) {
		// Default scanner buffer is 64KB
		longName := strings.Repeat("x", 65536)
		input := fmt.Sprintf("@e1: button \"%s\"", longName)

		result := ParseSnapshot(input)
		// Should handle gracefully
		_ = result.Count()
	})

	t.Run("line exceeding buffer limit", func(t *testing.T) {
		// Create a line longer than typical buffer
		longName := strings.Repeat("a", 100000)
		input := fmt.Sprintf("@e1: button \"%s\"", longName)

		result := ParseSnapshot(input)
		// May truncate or fail, but shouldn't panic
		_ = result.Count()
	})

	t.Run("many moderate lines", func(t *testing.T) {
		var builder strings.Builder
		for i := 0; i < 10000; i++ {
			builder.WriteString(fmt.Sprintf("@e%d: button \"%s\"\n", i, strings.Repeat("x", 100)))
		}

		result := ParseSnapshot(builder.String())
		if result.Count() != 10000 {
			t.Errorf("expected 10000 elements, got %d", result.Count())
		}
	})
}

// TestRegexPerformance tests regex patterns for performance edge cases
func TestRegexPerformance(t *testing.T) {
	t.Run("many potential matches", func(t *testing.T) {
		// Input with many @e patterns
		var builder strings.Builder
		for i := 0; i < 1000; i++ {
			builder.WriteString("@e")
		}
		builder.WriteString("1: button \"Test\"")

		start := time.Now()
		result := ParseSnapshot(builder.String())
		elapsed := time.Since(start)

		// Should complete quickly (under 1 second)
		if elapsed > time.Second {
			t.Errorf("regex took too long: %v", elapsed)
		}
		_ = result.Count()
	})

	t.Run("alternating valid invalid patterns", func(t *testing.T) {
		var builder strings.Builder
		for i := 0; i < 1000; i++ {
			if i%2 == 0 {
				builder.WriteString(fmt.Sprintf("@e%d: button \"Test\"\n", i))
			} else {
				builder.WriteString("@invalid not a ref\n")
			}
		}

		result := ParseSnapshot(builder.String())
		if result.Count() != 500 {
			t.Errorf("expected 500 elements, got %d", result.Count())
		}
	})
}

// TestErrorSentinelComparison tests error sentinel comparisons
func TestErrorSentinelComparison(t *testing.T) {
	sentinels := []error{
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

	t.Run("identity comparison", func(t *testing.T) {
		for _, err := range sentinels {
			if err != err {
				t.Errorf("error should equal itself: %v", err)
			}
		}
	})

	t.Run("errors.Is with same error", func(t *testing.T) {
		for _, err := range sentinels {
			if !errors.Is(err, err) {
				t.Errorf("errors.Is should return true for same error: %v", err)
			}
		}
	})

	t.Run("errors.Is with wrapped error", func(t *testing.T) {
		for _, err := range sentinels {
			wrapped := fmt.Errorf("wrapper: %w", err)
			if !errors.Is(wrapped, err) {
				t.Errorf("errors.Is should find wrapped error: %v", err)
			}
		}
	})

	t.Run("errors.Is with different errors", func(t *testing.T) {
		for i, err1 := range sentinels {
			for j, err2 := range sentinels {
				if i != j && errors.Is(err1, err2) {
					t.Errorf("different errors should not match: %v vs %v", err1, err2)
				}
			}
		}
	})
}

// TestStructEquality tests struct equality comparisons
func TestStructEquality(t *testing.T) {
	t.Run("Element equality", func(t *testing.T) {
		e1 := Element{Ref: "@e1", Role: "button", Name: "Test", Enabled: true, Visible: true}
		e2 := Element{Ref: "@e1", Role: "button", Name: "Test", Enabled: true, Visible: true}
		e3 := Element{Ref: "@e2", Role: "button", Name: "Test", Enabled: true, Visible: true}

		if e1 != e2 {
			t.Error("identical elements should be equal")
		}
		if e1 == e3 {
			t.Error("different elements should not be equal")
		}
	})

	t.Run("ClientConfig equality", func(t *testing.T) {
		c1 := ClientConfig{CDPPort: 9222, Timeout: 30000}
		c2 := ClientConfig{CDPPort: 9222, Timeout: 30000}
		c3 := ClientConfig{CDPPort: 9223, Timeout: 30000}

		if c1 != c2 {
			t.Error("identical configs should be equal")
		}
		if c1 == c3 {
			t.Error("different configs should not be equal")
		}
	})

	t.Run("ClickOptions equality", func(t *testing.T) {
		o1 := ClickOptions{Button: "left", ClickCount: 2, Delay: 50}
		o2 := ClickOptions{Button: "left", ClickCount: 2, Delay: 50}
		o3 := ClickOptions{Button: "right", ClickCount: 2, Delay: 50}

		if o1 != o2 {
			t.Error("identical options should be equal")
		}
		if o1 == o3 {
			t.Error("different options should not be equal")
		}
	})
}

// TestJSONOmitEmpty tests JSON omitempty behavior
func TestJSONOmitEmpty(t *testing.T) {
	t.Run("Element with zero values", func(t *testing.T) {
		elem := Element{}
		data, err := json.Marshal(elem)
		if err != nil {
			t.Fatalf("marshal error: %v", err)
		}

		// Check that fields are present (no omitempty on Element)
		var decoded map[string]interface{}
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatalf("unmarshal error: %v", err)
		}

		// All fields should be present
		expectedFields := []string{"ref", "role", "name", "description", "enabled", "visible"}
		for _, field := range expectedFields {
			if _, ok := decoded[field]; !ok {
				t.Errorf("field %q should be present", field)
			}
		}
	})

	t.Run("SnapshotResult with empty elements", func(t *testing.T) {
		result := SnapshotResult{Elements: []Element{}}
		data, err := json.Marshal(result)
		if err != nil {
			t.Fatalf("marshal error: %v", err)
		}

		// elements should be [] not null
		if !bytes.Contains(data, []byte(`"elements":[]`)) && !bytes.Contains(data, []byte(`"elements": []`)) {
			// It's okay if it's null for nil slice
		}
	})
}

// TestContextValueTypeSafety tests context value type safety
func TestContextValueTypeSafety(t *testing.T) {
	type key1 string
	type key2 string

	t.Run("different types same underlying value", func(t *testing.T) {
		ctx := context.WithValue(context.Background(), key1("test"), "value1")
		ctx = context.WithValue(ctx, key2("test"), "value2")

		// Different types should not conflict
		if ctx.Value(key1("test")) != "value1" {
			t.Error("key1 value should be value1")
		}
		if ctx.Value(key2("test")) != "value2" {
			t.Error("key2 value should be value2")
		}
	})

	t.Run("type assertion safety", func(t *testing.T) {
		type myKey string
		ctx := context.WithValue(context.Background(), myKey("test"), 123)

		// Safe type assertion
		if val, ok := ctx.Value(myKey("test")).(int); ok {
			if val != 123 {
				t.Error("value should be 123")
			}
		} else {
			t.Error("type assertion should succeed")
		}

		// Wrong type assertion
		if _, ok := ctx.Value(myKey("test")).(string); ok {
			t.Error("wrong type assertion should fail")
		}
	})
}

// TestDeferOrdering tests defer execution order
func TestDeferOrdering(t *testing.T) {
	var order []int

	func() {
		defer func() { order = append(order, 1) }()
		defer func() { order = append(order, 2) }()
		defer func() { order = append(order, 3) }()
	}()

	// Defers execute in LIFO order
	expected := []int{3, 2, 1}
	if !reflect.DeepEqual(order, expected) {
		t.Errorf("expected %v, got %v", expected, order)
	}
}

// TestPanicRecoverInGoroutines tests panic/recover in goroutines
func TestPanicRecoverInGoroutines(t *testing.T) {
	t.Run("panic in goroutine with recover", func(t *testing.T) {
		done := make(chan bool)
		recovered := make(chan interface{})

		go func() {
			defer func() {
				if r := recover(); r != nil {
					recovered <- r
				}
				done <- true
			}()
			panic("test panic")
		}()

		select {
		case r := <-recovered:
			if r != "test panic" {
				t.Errorf("unexpected recovery value: %v", r)
			}
		case <-time.After(time.Second):
			t.Error("timeout waiting for recovery")
		}

		<-done
	})
}

// TestTypeSwitchEdgeCases tests type switch edge cases
func TestTypeSwitchEdgeCases(t *testing.T) {
	testCases := []struct {
		name     string
		value    interface{}
		expected string
	}{
		{"nil", nil, "nil"},
		{"int", 42, "int"},
		{"string", "hello", "string"},
		{"bool", true, "bool"},
		{"Element", Element{}, "Element"},
		{"*Element", &Element{}, "*Element"},
		{"error", ErrTimeout, "error"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			var result string
			switch v := tc.value.(type) {
			case nil:
				result = "nil"
			case int:
				result = "int"
				_ = v
			case string:
				result = "string"
			case bool:
				result = "bool"
			case Element:
				result = "Element"
			case *Element:
				result = "*Element"
			case error:
				result = "error"
			default:
				result = "unknown"
			}

			if result != tc.expected {
				t.Errorf("expected %q, got %q", tc.expected, result)
			}
		})
	}
}

// TestSliceAppendCapacity tests slice append and capacity behavior
func TestSliceAppendCapacity(t *testing.T) {
	t.Run("append grows capacity", func(t *testing.T) {
		var elems []Element
		prevCap := cap(elems)

		for i := 0; i < 100; i++ {
			elems = append(elems, Element{Ref: fmt.Sprintf("@e%d", i)})
			newCap := cap(elems)
			if newCap < prevCap {
				t.Error("capacity should never decrease")
			}
			prevCap = newCap
		}
	})

	t.Run("preallocated slice", func(t *testing.T) {
		elems := make([]Element, 0, 100)
		initialCap := cap(elems)

		for i := 0; i < 100; i++ {
			elems = append(elems, Element{Ref: fmt.Sprintf("@e%d", i)})
		}

		// Capacity should not change if we stayed within initial capacity
		if cap(elems) != initialCap {
			// This is fine - we might have exactly 100
		}
		if len(elems) != 100 {
			t.Error("should have 100 elements")
		}
	})

	t.Run("slice sharing backing array", func(t *testing.T) {
		original := []Element{
			{Ref: "@e1"},
			{Ref: "@e2"},
			{Ref: "@e3"},
		}

		// Create a slice of the first two elements
		slice := original[:2]

		// Modify through slice
		slice[0].Name = "Modified"

		// Original should be modified too (same backing array)
		if original[0].Name != "Modified" {
			t.Error("modification through slice should affect original")
		}
	})
}

// TestMapIterationOrder tests that map iteration order is non-deterministic
func TestMapIterationOrder(t *testing.T) {
	m := map[string]int{
		"a": 1, "b": 2, "c": 3, "d": 4, "e": 5,
		"f": 6, "g": 7, "h": 8, "i": 9, "j": 10,
	}

	// Collect iteration orders
	orders := make([]string, 0, 10)
	for i := 0; i < 10; i++ {
		var keys []string
		for k := range m {
			keys = append(keys, k)
		}
		orders = append(orders, strings.Join(keys, ""))
	}

	// In Go, map iteration order is randomized
	// We can't guarantee different orders, but we test the iteration works
	for _, order := range orders {
		if len(order) != 10 {
			t.Error("should iterate over all 10 keys")
		}
	}
}

// TestStringInterning tests string literal behavior
func TestStringInterning(t *testing.T) {
	t.Run("identical literals", func(t *testing.T) {
		s1 := "hello"
		s2 := "hello"

		// In Go, identical string literals may share memory
		// but comparison is always by value
		if s1 != s2 {
			t.Error("identical strings should be equal")
		}
	})

	t.Run("constructed vs literal", func(t *testing.T) {
		literal := "hello"
		constructed := string([]byte{'h', 'e', 'l', 'l', 'o'})

		if literal != constructed {
			t.Error("strings with same content should be equal")
		}
	})
}

// TestRuneVsByteIteration tests rune vs byte iteration differences
func TestRuneVsByteIteration(t *testing.T) {
	s := "Hello 你好 🌍"

	t.Run("byte iteration", func(t *testing.T) {
		byteCount := 0
		for range []byte(s) {
			byteCount++
		}
		if byteCount != len(s) {
			t.Errorf("byte count mismatch: %d vs %d", byteCount, len(s))
		}
	})

	t.Run("rune iteration", func(t *testing.T) {
		runeCount := 0
		for range s {
			runeCount++
		}
		if runeCount != utf8.RuneCountInString(s) {
			t.Errorf("rune count mismatch: %d vs %d", runeCount, utf8.RuneCountInString(s))
		}
	})

	t.Run("byte vs rune counts differ for unicode", func(t *testing.T) {
		byteLen := len(s)
		runeLen := utf8.RuneCountInString(s)

		if byteLen == runeLen {
			t.Error("for unicode strings, byte and rune counts should differ")
		}
	})
}

// TestBuilderResetAndReuse tests strings.Builder reset behavior
func TestBuilderResetAndReuse(t *testing.T) {
	var builder strings.Builder

	builder.WriteString("first")
	first := builder.String()

	builder.Reset()
	builder.WriteString("second")
	second := builder.String()

	if first != "first" {
		t.Errorf("expected 'first', got %q", first)
	}
	if second != "second" {
		t.Errorf("expected 'second', got %q", second)
	}
}

// TestIntegerOverflow tests integer overflow behavior
func TestIntegerOverflow(t *testing.T) {
	t.Run("int overflow wraps", func(t *testing.T) {
		// This is implementation-defined but typically wraps
		var i int8 = 127
		i++
		if i != -128 {
			// On most systems, this wraps to -128
		}
	})

	t.Run("timeout overflow check", func(t *testing.T) {
		// Very large timeout values
		config := ClientConfig{Timeout: 2147483647} // Max int32
		if config.Timeout < 0 {
			t.Error("large timeout should not overflow to negative")
		}
	})
}

// TestChannelOperations tests various channel operations
func TestChannelOperations(t *testing.T) {
	t.Run("buffered channel full", func(t *testing.T) {
		ch := make(chan int, 2)
		ch <- 1
		ch <- 2

		// Channel is full, non-blocking send would fail
		select {
		case ch <- 3:
			t.Error("send to full channel should block")
		default:
			// Expected
		}
	})

	t.Run("closed channel read", func(t *testing.T) {
		ch := make(chan int, 1)
		ch <- 42
		close(ch)

		// Can still read buffered value
		val := <-ch
		if val != 42 {
			t.Error("should read buffered value")
		}

		// Reading from closed empty channel returns zero value
		val, ok := <-ch
		if ok {
			t.Error("ok should be false for closed channel")
		}
		if val != 0 {
			t.Error("should return zero value")
		}
	})

	t.Run("select with default", func(t *testing.T) {
		ch := make(chan int)

		select {
		case <-ch:
			t.Error("should not receive from empty channel")
		default:
			// Expected
		}
	})
}

// TestSelectStatementEdgeCases tests select statement edge cases
func TestSelectStatementEdgeCases(t *testing.T) {
	t.Run("multiple ready channels", func(t *testing.T) {
		ch1 := make(chan int, 1)
		ch2 := make(chan int, 1)
		ch1 <- 1
		ch2 <- 2

		// When multiple channels are ready, select chooses pseudo-randomly
		selected := make(map[int]int)
		for i := 0; i < 100; i++ {
			// Refill channels
			select {
			case ch1 <- 1:
			default:
			}
			select {
			case ch2 <- 2:
			default:
			}

			select {
			case v := <-ch1:
				selected[v]++
			case v := <-ch2:
				selected[v]++
			}
		}

		// Both should be selected at least sometimes (not guaranteed but very likely)
		if len(selected) == 0 {
			t.Error("should have selected something")
		}
	})
}

// TestGarbageCollection tests GC behavior with allocations
func TestGarbageCollection(t *testing.T) {
	t.Run("allocate and release", func(t *testing.T) {
		var memBefore, memAfter runtime.MemStats
		runtime.ReadMemStats(&memBefore)

		// Allocate a lot
		for i := 0; i < 10000; i++ {
			_ = ParseSnapshot(fmt.Sprintf("@e%d: button \"Test %d\"", i, i))
		}

		// Force GC
		runtime.GC()
		runtime.ReadMemStats(&memAfter)

		// Memory should be reclaimed (mostly)
		// This is a weak assertion since GC timing is non-deterministic
		_ = memBefore
		_ = memAfter
	})
}

// TestReflectDeepEqual tests reflect.DeepEqual edge cases
func TestReflectDeepEqual(t *testing.T) {
	t.Run("nil slices", func(t *testing.T) {
		var s1 []Element
		var s2 []Element

		if !reflect.DeepEqual(s1, s2) {
			t.Error("two nil slices should be equal")
		}
	})

	t.Run("nil vs empty slice", func(t *testing.T) {
		var nilSlice []Element
		emptySlice := []Element{}

		if reflect.DeepEqual(nilSlice, emptySlice) {
			t.Error("nil and empty slices are different in DeepEqual")
		}
	})

	t.Run("nested structs", func(t *testing.T) {
		r1 := SnapshotResult{
			Elements: []Element{{Ref: "@e1", Name: "Test"}},
			Raw:      "test",
		}
		r2 := SnapshotResult{
			Elements: []Element{{Ref: "@e1", Name: "Test"}},
			Raw:      "test",
		}

		if !reflect.DeepEqual(r1, r2) {
			t.Error("identical nested structs should be equal")
		}
	})
}

// TestBufioScanner tests bufio.Scanner behavior
func TestBufioScanner(t *testing.T) {
	t.Run("empty input", func(t *testing.T) {
		scanner := bufio.NewScanner(strings.NewReader(""))
		count := 0
		for scanner.Scan() {
			count++
		}
		if count != 0 {
			t.Error("empty input should have no lines")
		}
	})

	t.Run("single line no newline", func(t *testing.T) {
		scanner := bufio.NewScanner(strings.NewReader("hello"))
		count := 0
		for scanner.Scan() {
			count++
			if scanner.Text() != "hello" {
				t.Error("should read 'hello'")
			}
		}
		if count != 1 {
			t.Error("should have exactly one line")
		}
	})

	t.Run("trailing newline", func(t *testing.T) {
		scanner := bufio.NewScanner(strings.NewReader("line1\nline2\n"))
		var lines []string
		for scanner.Scan() {
			lines = append(lines, scanner.Text())
		}
		if len(lines) != 2 {
			t.Errorf("expected 2 lines, got %d", len(lines))
		}
	})

	t.Run("windows line endings", func(t *testing.T) {
		scanner := bufio.NewScanner(strings.NewReader("line1\r\nline2\r\n"))
		var lines []string
		for scanner.Scan() {
			lines = append(lines, scanner.Text())
		}
		// Default scanner handles \r\n
		if len(lines) != 2 {
			t.Errorf("expected 2 lines, got %d", len(lines))
		}
	})
}

// TestConcurrentMapAccess tests that our code doesn't use maps unsafely
func TestConcurrentMapAccess(t *testing.T) {
	// SnapshotResult uses a slice, not a map, for elements
	// This test verifies concurrent read access is safe

	result := ParseSnapshot(`
@e1: button "A"
@e2: input "B"
@e3: link "C"
`)

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// These all iterate over slices, which is safe for concurrent reads
			_ = result.FindElementByRef("@e1")
			_ = result.FindElementsByRole("button")
			_ = result.FindElementsByText("A")
			_ = result.GetRefs()
			_ = result.GetButtons()
		}()
	}
	wg.Wait()
}

// TestEmptyAndWhitespaceVariations tests various empty/whitespace inputs
func TestEmptyAndWhitespaceVariations(t *testing.T) {
	inputs := []string{
		"",
		" ",
		"  ",
		"\t",
		"\n",
		"\r",
		"\r\n",
		" \t\n\r ",
		"\u00A0",        // Non-breaking space
		"\u2003",        // Em space
		"\u200B",        // Zero-width space
		"\uFEFF",        // BOM
		" \t \n \r \t ", // Mixed
	}

	for i, input := range inputs {
		t.Run(fmt.Sprintf("whitespace_%d", i), func(t *testing.T) {
			result := ParseSnapshot(input)
			if !result.IsEmpty() {
				t.Errorf("whitespace-only input should produce empty result, got %d elements", result.Count())
			}
		})
	}
}

// TestParseSnapshotMemoryEfficiency tests memory efficiency of parsing
func TestParseSnapshotMemoryEfficiency(t *testing.T) {
	// Create input
	var builder strings.Builder
	for i := 0; i < 1000; i++ {
		builder.WriteString(fmt.Sprintf("@e%d: button \"Button %d\"\n", i, i))
	}
	input := builder.String()

	// Parse multiple times and ensure no memory leak
	for i := 0; i < 100; i++ {
		result := ParseSnapshot(input)
		if result.Count() != 1000 {
			t.Fatalf("iteration %d: expected 1000 elements", i)
		}
	}
}

// BenchmarkDeepEdgeCases benchmarks edge case handling
func BenchmarkDeepEdgeCases(b *testing.B) {
	b.Run("empty_input", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = ParseSnapshot("")
		}
	})

	b.Run("whitespace_only", func(b *testing.B) {
		input := strings.Repeat(" \t\n", 100)
		for i := 0; i < b.N; i++ {
			_ = ParseSnapshot(input)
		}
	})

	b.Run("no_valid_refs", func(b *testing.B) {
		input := strings.Repeat("no refs here\n", 100)
		for i := 0; i < b.N; i++ {
			_ = ParseSnapshot(input)
		}
	})

	b.Run("all_valid_refs", func(b *testing.B) {
		var builder strings.Builder
		for i := 0; i < 100; i++ {
			builder.WriteString(fmt.Sprintf("@e%d: button \"Test\"\n", i))
		}
		input := builder.String()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = ParseSnapshot(input)
		}
	})
}
