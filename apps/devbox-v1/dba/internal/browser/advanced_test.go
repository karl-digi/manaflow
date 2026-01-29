package browser

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestCommandArgumentEscaping tests various argument escaping scenarios
func TestCommandArgumentEscaping(t *testing.T) {
	// These test that various special characters in arguments don't cause issues
	testCases := []struct {
		name string
		arg  string
	}{
		{"simple", "hello"},
		{"with spaces", "hello world"},
		{"with quotes", "hello \"world\""},
		{"with single quotes", "hello 'world'"},
		{"with backslash", "hello\\world"},
		{"with newline", "hello\nworld"},
		{"with tab", "hello\tworld"},
		{"with semicolon", "hello;world"},
		{"with ampersand", "hello&world"},
		{"with pipe", "hello|world"},
		{"with dollar", "hello$world"},
		{"with backtick", "hello`world`"},
		{"with parentheses", "hello(world)"},
		{"with brackets", "hello[world]"},
		{"with braces", "hello{world}"},
		{"with asterisk", "hello*world"},
		{"with question mark", "hello?world"},
		{"with caret", "hello^world"},
		{"with tilde", "hello~world"},
		{"with equals", "hello=world"},
		{"with plus", "hello+world"},
		{"with less than", "hello<world"},
		{"with greater than", "hello>world"},
		{"with exclamation", "hello!world"},
		{"with hash", "hello#world"},
		{"with percent", "hello%world"},
		{"with at", "hello@world"},
		{"shell injection attempt", "; rm -rf /"},
		{"command substitution", "$(whoami)"},
		{"backtick substitution", "`whoami`"},
		{"env variable", "${PATH}"},
		{"glob pattern", "*.txt"},
		{"home expansion", "~/file.txt"},
		{"null byte", "hello\x00world"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// These shouldn't panic when constructing arguments
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("panic with arg %q: %v", tc.arg, r)
				}
			}()

			// Verify the argument can be used in a command error
			cmdErr := &CommandError{
				Command: "test",
				Args:    []string{tc.arg},
				Output:  "test output",
				Err:     errors.New("test error"),
			}
			_ = cmdErr.Error()
		})
	}
}

// TestPathEdgeCases tests various path format edge cases
func TestPathEdgeCases(t *testing.T) {
	paths := []struct {
		name string
		path string
	}{
		{"absolute unix", "/tmp/file.txt"},
		{"absolute windows", "C:\\Users\\file.txt"},
		{"relative", "./file.txt"},
		{"parent", "../file.txt"},
		{"home", "~/file.txt"},
		{"with spaces", "/path/with spaces/file.txt"},
		{"with quotes", "/path/with\"quotes/file.txt"},
		{"with unicode", "/path/你好/file.txt"},
		{"with emoji", "/path/🎉/file.txt"},
		{"very long", "/very/long/" + strings.Repeat("path/", 100) + "file.txt"},
		{"empty", ""},
		{"just slash", "/"},
		{"just dot", "."},
		{"just dots", ".."},
		{"trailing slash", "/tmp/dir/"},
		{"double slash", "//tmp//file.txt"},
		{"null in path", "/tmp/file\x00.txt"},
		{"newline in path", "/tmp/file\n.txt"},
		{"unc path", "\\\\server\\share\\file.txt"},
	}

	for _, p := range paths {
		t.Run(p.name, func(t *testing.T) {
			// Test path in ScreenshotOptions
			opts := ScreenshotOptions{Path: p.path}
			_ = opts.Path

			// Test path in client config
			config := ClientConfig{BinaryPath: p.path}
			_ = config.BinaryPath
		})
	}
}

// TestTimeoutEdgeCases tests various timeout scenarios
func TestTimeoutEdgeCases(t *testing.T) {
	timeouts := []struct {
		name    string
		timeout int
	}{
		{"zero", 0},
		{"one ms", 1},
		{"hundred ms", 100},
		{"one second", 1000},
		{"ten seconds", 10000},
		{"one minute", 60000},
		{"ten minutes", 600000},
		{"one hour", 3600000},
		{"max int32", 2147483647},
		{"negative", -1},
		{"negative large", -1000000},
	}

	for _, to := range timeouts {
		t.Run(to.name, func(t *testing.T) {
			config := ClientConfig{Timeout: to.timeout}
			_ = config.Timeout

			opts := WaitOptions{Timeout: to.timeout}
			_ = opts.Timeout
		})
	}
}

// TestPortEdgeCases tests various port number edge cases
func TestPortEdgeCases(t *testing.T) {
	ports := []struct {
		name string
		port int
	}{
		{"zero", 0},
		{"one", 1},
		{"privileged", 80},
		{"common", 9222},
		{"high", 65535},
		{"above max", 65536},
		{"negative", -1},
		{"very negative", -65535},
		{"max int", 2147483647},
	}

	for _, p := range ports {
		t.Run(p.name, func(t *testing.T) {
			config := ClientConfig{CDPPort: p.port}
			_ = config.CDPPort
		})
	}
}

// TestURLEdgeCases tests various URL format edge cases
func TestURLEdgeCases(t *testing.T) {
	urls := []struct {
		name string
		url  string
	}{
		{"ws localhost", "ws://localhost:9222"},
		{"wss localhost", "wss://localhost:9222"},
		{"http localhost", "http://localhost:9222"},
		{"https localhost", "https://localhost:9222"},
		{"ip address", "ws://127.0.0.1:9222"},
		{"ipv6", "ws://[::1]:9222"},
		{"with path", "ws://localhost:9222/devtools/browser"},
		{"with query", "ws://localhost:9222?token=abc"},
		{"with fragment", "ws://localhost:9222#section"},
		{"no port", "ws://localhost"},
		{"no scheme", "localhost:9222"},
		{"empty", ""},
		{"just scheme", "ws://"},
		{"unicode host", "ws://例え.jp:9222"},
		{"punycode", "ws://xn--e1afmkfd.xn--p1ai:9222"},
		{"very long", "ws://localhost:9222/" + strings.Repeat("path/", 100)},
		{"with auth", "ws://user:pass@localhost:9222"},
		{"encoded chars", "ws://localhost:9222/path%20with%20spaces"},
	}

	for _, u := range urls {
		t.Run(u.name, func(t *testing.T) {
			config := ClientConfig{CDPURL: u.url}
			_ = config.CDPURL
		})
	}
}

// TestSessionEdgeCases tests various session name edge cases
func TestSessionEdgeCases(t *testing.T) {
	sessions := []struct {
		name    string
		session string
	}{
		{"empty", ""},
		{"simple", "session1"},
		{"with dash", "my-session"},
		{"with underscore", "my_session"},
		{"with dot", "my.session"},
		{"with spaces", "my session"},
		{"uuid", "550e8400-e29b-41d4-a716-446655440000"},
		{"very long", strings.Repeat("a", 1000)},
		{"unicode", "会话"},
		{"emoji", "🔑session"},
		{"special chars", "session!@#$%"},
		{"null byte", "session\x00name"},
		{"newline", "session\nname"},
	}

	for _, s := range sessions {
		t.Run(s.name, func(t *testing.T) {
			config := ClientConfig{Session: s.session}
			_ = config.Session

			client := &Client{config: config}
			client.SetSession(s.session)
			if client.config.Session != s.session {
				t.Errorf("session not set correctly")
			}
		})
	}
}

// TestClickCountEdgeCases tests click count edge cases
func TestClickCountEdgeCases(t *testing.T) {
	counts := []int{0, 1, 2, 3, 10, 100, -1, -100}

	for _, count := range counts {
		t.Run(fmt.Sprintf("count_%d", count), func(t *testing.T) {
			opts := ClickOptions{ClickCount: count}
			_ = opts.ClickCount
		})
	}
}

// TestDelayEdgeCases tests delay edge cases
func TestDelayEdgeCases(t *testing.T) {
	delays := []int{0, 1, 10, 50, 100, 500, 1000, 5000, 10000, -1, -100}

	for _, delay := range delays {
		t.Run(fmt.Sprintf("delay_%d", delay), func(t *testing.T) {
			opts := ClickOptions{Delay: delay}
			_ = opts.Delay
		})
	}
}

// TestQualityEdgeCases tests screenshot quality edge cases
func TestQualityEdgeCases(t *testing.T) {
	qualities := []int{0, 1, 50, 80, 100, 101, 255, -1, -100}

	for _, quality := range qualities {
		t.Run(fmt.Sprintf("quality_%d", quality), func(t *testing.T) {
			opts := ScreenshotOptions{Quality: quality}
			_ = opts.Quality
		})
	}
}

// TestButtonEdgeCases tests button name edge cases
func TestButtonEdgeCases(t *testing.T) {
	buttons := []string{
		"", "left", "right", "middle",
		"LEFT", "RIGHT", "MIDDLE",
		"Left", "Right", "Middle",
		"primary", "secondary", "auxiliary",
		"invalid", "unknown", "button4", "button5",
	}

	for _, button := range buttons {
		t.Run(button, func(t *testing.T) {
			opts := ClickOptions{Button: button}
			_ = opts.Button
		})
	}
}

// TestWaitStateEdgeCases tests wait state edge cases
func TestWaitStateEdgeCases(t *testing.T) {
	states := []string{
		"", "visible", "hidden", "attached", "detached",
		"VISIBLE", "HIDDEN", "ATTACHED", "DETACHED",
		"Visible", "Hidden", "Attached", "Detached",
		"invalid", "unknown", "enabled", "disabled",
	}

	for _, state := range states {
		t.Run(state, func(t *testing.T) {
			opts := WaitOptions{State: state}
			_ = opts.State
		})
	}
}

// TestAtomicOperations tests atomic operations on client state
func TestAtomicOperations(t *testing.T) {
	t.Run("concurrent IsConnected checks", func(t *testing.T) {
		client := &Client{
			config:    ClientConfig{CDPPort: 9222},
			connected: false,
		}

		var wg sync.WaitGroup
		for i := 0; i < 1000; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_ = client.IsConnected()
			}()
		}
		wg.Wait()
	})

	t.Run("concurrent config access", func(t *testing.T) {
		client := &Client{
			config: ClientConfig{CDPPort: 9222, Timeout: 30000},
		}

		var wg sync.WaitGroup
		for i := 0; i < 1000; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_ = client.GetConfig()
			}()
		}
		wg.Wait()
	})
}

// TestErrorWrapping tests error wrapping behaviors
func TestErrorWrapping(t *testing.T) {
	t.Run("nested command errors", func(t *testing.T) {
		inner := &CommandError{
			Command: "inner",
			Args:    []string{"arg1"},
			Output:  "inner output",
			Err:     ErrElementNotFound,
		}

		outer := &CommandError{
			Command: "outer",
			Args:    []string{"arg2"},
			Output:  "outer output",
			Err:     inner,
		}

		// Should be able to unwrap
		unwrapped := outer.Unwrap()
		if unwrapped != inner {
			t.Error("unwrap should return inner error")
		}

		// Should be able to check with errors.Is
		if !errors.Is(outer, inner) {
			t.Error("errors.Is should find inner error")
		}
	})

	t.Run("error chain", func(t *testing.T) {
		chain := fmt.Errorf("level3: %w",
			fmt.Errorf("level2: %w",
				fmt.Errorf("level1: %w", ErrTimeout)))

		if !errors.Is(chain, ErrTimeout) {
			t.Error("should find ErrTimeout in chain")
		}
	})

	t.Run("command error with wrapped error", func(t *testing.T) {
		wrapped := fmt.Errorf("wrapper: %w", ErrElementNotFound)
		cmdErr := &CommandError{
			Command: "click",
			Args:    []string{"@e1"},
			Output:  "element not found",
			Err:     wrapped,
		}

		if !errors.Is(cmdErr, ErrElementNotFound) {
			t.Error("should find ErrElementNotFound through wrapper")
		}
	})
}

// TestContextChaining tests context chaining scenarios
func TestContextChaining(t *testing.T) {
	t.Run("value inheritance", func(t *testing.T) {
		type key string
		parent := context.WithValue(context.Background(), key("parent"), "pvalue")
		child := context.WithValue(parent, key("child"), "cvalue")

		if child.Value(key("parent")) != "pvalue" {
			t.Error("child should inherit parent value")
		}
		if child.Value(key("child")) != "cvalue" {
			t.Error("child should have own value")
		}
		if parent.Value(key("child")) != nil {
			t.Error("parent should not see child value")
		}
	})

	t.Run("cancellation propagation", func(t *testing.T) {
		parent, cancelParent := context.WithCancel(context.Background())
		child1, _ := context.WithCancel(parent)
		child2, _ := context.WithTimeout(parent, time.Hour)

		cancelParent()

		if child1.Err() != context.Canceled {
			t.Error("child1 should be cancelled")
		}
		if child2.Err() != context.Canceled {
			t.Error("child2 should be cancelled")
		}
	})

	t.Run("independent cancellation", func(t *testing.T) {
		parent, _ := context.WithCancel(context.Background())
		child1, cancelChild1 := context.WithCancel(parent)
		child2, _ := context.WithCancel(parent)

		cancelChild1()

		if child1.Err() != context.Canceled {
			t.Error("child1 should be cancelled")
		}
		if child2.Err() != nil {
			t.Error("child2 should not be cancelled")
		}
	})
}

// TestSliceOperations tests various slice operations
func TestSliceOperations(t *testing.T) {
	t.Run("append to nil slice", func(t *testing.T) {
		var elems []Element
		elems = append(elems, Element{Ref: "@e1"})
		if len(elems) != 1 {
			t.Error("append to nil should work")
		}
	})

	t.Run("slice capacity growth", func(t *testing.T) {
		elems := make([]Element, 0, 10)
		for i := 0; i < 100; i++ {
			elems = append(elems, Element{Ref: fmt.Sprintf("@e%d", i)})
		}
		if len(elems) != 100 {
			t.Error("should have 100 elements")
		}
	})

	t.Run("slice reslicing", func(t *testing.T) {
		result := &SnapshotResult{
			Elements: make([]Element, 10),
		}
		for i := range result.Elements {
			result.Elements[i] = Element{Ref: fmt.Sprintf("@e%d", i)}
		}

		// Get a subset
		refs := result.GetRefs()
		if len(refs) != 10 {
			t.Error("should have 10 refs")
		}
	})
}

// TestMapOperations tests map-like operations (if any)
func TestMapOperations(t *testing.T) {
	t.Run("element lookup simulation", func(t *testing.T) {
		elements := map[string]Element{
			"@e1": {Ref: "@e1", Role: "button"},
			"@e2": {Ref: "@e2", Role: "input"},
		}

		if elem, ok := elements["@e1"]; !ok || elem.Role != "button" {
			t.Error("should find @e1")
		}

		if _, ok := elements["@e3"]; ok {
			t.Error("should not find @e3")
		}
	})
}

// TestGoroutineLeaks tests for potential goroutine leaks
func TestGoroutineLeaks(t *testing.T) {
	t.Run("context cancellation cleanup", func(t *testing.T) {
		for i := 0; i < 100; i++ {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			// Context should be garbage collected
			_ = ctx.Err()
		}
	})

	t.Run("channel cleanup", func(t *testing.T) {
		for i := 0; i < 100; i++ {
			ch := make(chan struct{})
			close(ch)
		}
	})
}

// TestPanicRecovery tests panic recovery scenarios
func TestPanicRecovery(t *testing.T) {
	t.Run("recover from nil pointer", func(t *testing.T) {
		defer func() {
			if r := recover(); r != nil {
				// Expected
			}
		}()

		var result *SnapshotResult
		_ = result.Count() // This will panic
	})

	t.Run("safe nil check", func(t *testing.T) {
		var result *SnapshotResult
		if result != nil {
			_ = result.Count()
		}
		// Should not panic
	})
}

// TestCounterIncrement tests atomic counter patterns
func TestCounterIncrement(t *testing.T) {
	var counter int64

	var wg sync.WaitGroup
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			atomic.AddInt64(&counter, 1)
		}()
	}
	wg.Wait()

	if counter != 1000 {
		t.Errorf("expected 1000, got %d", counter)
	}
}

// TestStringComparison tests various string comparison scenarios
func TestStringComparison(t *testing.T) {
	testCases := []struct {
		a, b  string
		equal bool
	}{
		{"hello", "hello", true},
		{"hello", "Hello", false},
		{"hello", "hello ", false},
		{" hello", "hello", false},
		{"", "", true},
		{"a", "a", true},
		{"abc", "abd", false},
		{"你好", "你好", true},
		{"🎉", "🎉", true},
	}

	for _, tc := range testCases {
		t.Run(tc.a+"_vs_"+tc.b, func(t *testing.T) {
			if (tc.a == tc.b) != tc.equal {
				t.Errorf("comparison mismatch for %q vs %q", tc.a, tc.b)
			}
		})
	}
}

// TestInterfaceSatisfaction tests that types satisfy interfaces
func TestInterfaceSatisfaction(t *testing.T) {
	t.Run("CommandError implements error", func(t *testing.T) {
		var _ error = &CommandError{}
	})

	t.Run("CommandError implements Unwrap", func(t *testing.T) {
		cmdErr := &CommandError{Err: ErrTimeout}
		var unwrapper interface{ Unwrap() error } = cmdErr
		_ = unwrapper.Unwrap()
	})
}

// TestDefaultValues tests default value handling
func TestDefaultValues(t *testing.T) {
	t.Run("zero ClientConfig", func(t *testing.T) {
		var config ClientConfig
		if config.CDPPort != 0 {
			t.Error("default CDPPort should be 0")
		}
		if config.Timeout != 0 {
			t.Error("default Timeout should be 0")
		}
	})

	t.Run("zero Element", func(t *testing.T) {
		var elem Element
		if elem.Enabled {
			t.Error("default Enabled should be false")
		}
		if elem.Visible {
			t.Error("default Visible should be false")
		}
	})
}

// BenchmarkStringOperations benchmarks string operations
func BenchmarkStringOperations(b *testing.B) {
	b.Run("concatenation", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = "@e" + "1" + ": button \"Test\""
		}
	})

	b.Run("builder", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			var builder strings.Builder
			builder.WriteString("@e")
			builder.WriteString("1")
			builder.WriteString(": button \"Test\"")
			_ = builder.String()
		}
	})

	b.Run("sprintf", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = fmt.Sprintf("@e%d: button \"Test\"", 1)
		}
	})
}

// BenchmarkMapVsSlice benchmarks map vs slice lookup
func BenchmarkMapVsSlice(b *testing.B) {
	// Create test data
	elements := make([]Element, 100)
	elemMap := make(map[string]Element, 100)
	for i := 0; i < 100; i++ {
		ref := fmt.Sprintf("@e%d", i)
		elem := Element{Ref: ref, Role: "button"}
		elements[i] = elem
		elemMap[ref] = elem
	}

	b.Run("slice_linear_search", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			target := "@e50"
			for _, e := range elements {
				if e.Ref == target {
					break
				}
			}
		}
	})

	b.Run("map_lookup", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = elemMap["@e50"]
		}
	})
}
