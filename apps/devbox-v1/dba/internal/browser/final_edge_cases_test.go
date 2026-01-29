package browser

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestParseErrorMessagePatterns tests various error message patterns
func TestParseErrorMessagePatterns(t *testing.T) {
	// Test all known error keywords and variations
	testCases := []struct {
		message  string
		expected error
	}{
		// "not found" patterns
		{"not found", ErrElementNotFound},
		{"NOT FOUND", ErrElementNotFound},
		{"Not Found", ErrElementNotFound},
		{"element not found", ErrElementNotFound},
		{"selector not found", ErrElementNotFound},
		{"@e1 not found", ErrElementNotFound},
		{"Error: not found", ErrElementNotFound},
		{"not found in DOM", ErrElementNotFound},
		{"element was not found", ErrElementNotFound},
		{"cannot find element - not found", ErrElementNotFound},

		// "not visible" patterns
		{"not visible", ErrElementNotVisible},
		{"NOT VISIBLE", ErrElementNotVisible},
		{"element not visible", ErrElementNotVisible},
		{"element is not visible", ErrElementNotVisible},
		{"hidden - not visible", ErrElementNotVisible},
		{"visibility: not visible", ErrElementNotVisible},

		// "not enabled" / "disabled" patterns
		{"not enabled", ErrElementNotEnabled},
		{"disabled", ErrElementNotEnabled},
		{"DISABLED", ErrElementNotEnabled},
		{"element disabled", ErrElementNotEnabled},
		{"button is disabled", ErrElementNotEnabled},
		{"input not enabled", ErrElementNotEnabled},
		{"disabled attribute present", ErrElementNotEnabled},

		// "not editable" patterns
		{"not editable", ErrElementNotEditable},
		{"NOT EDITABLE", ErrElementNotEditable},
		{"element not editable", ErrElementNotEditable},
		{"cannot type: not editable", ErrElementNotEditable},

		// "timeout" / "timed out" patterns
		{"timeout", ErrTimeout},
		{"TIMEOUT", ErrTimeout},
		{"Timeout", ErrTimeout},
		{"timed out", ErrTimeout},
		{"operation timed out", ErrTimeout},
		{"connection timeout", ErrTimeout},
		{"waiting timeout", ErrTimeout},
		{"TimeoutError: timed out", ErrTimeout},

		// "navigation" patterns
		{"navigation failed", ErrNavigationFailed},
		{"NAVIGATION FAILED", ErrNavigationFailed},
		{"navigation error", ErrNavigationFailed},
		{"page navigation failed", ErrNavigationFailed},
		{"frame navigation failed", ErrNavigationFailed},

		// "stale" patterns
		{"stale", ErrStaleRef},
		{"STALE", ErrStaleRef},
		{"stale element", ErrStaleRef},
		{"stale reference", ErrStaleRef},
		{"element is stale", ErrStaleRef},

		// "invalid key" / "unknown key" patterns
		{"invalid key", ErrInvalidKey},
		{"INVALID KEY", ErrInvalidKey},
		{"unknown key", ErrInvalidKey},
		{"key not recognized: invalid key", ErrInvalidKey},

		// No match patterns (return nil)
		{"success", nil},
		{"ok", nil},
		{"completed", nil},
		{"element clicked", nil},
		{"random error message", nil},
		{"", nil},
		{"   ", nil},
	}

	for _, tc := range testCases {
		t.Run(tc.message, func(t *testing.T) {
			result := ParseError(tc.message)
			if result != tc.expected {
				t.Errorf("ParseError(%q) = %v, want %v", tc.message, result, tc.expected)
			}
		})
	}
}

// TestParseErrorPriorityOrder tests error priority when multiple keywords present
func TestParseErrorPriorityOrder(t *testing.T) {
	// The switch statement checks conditions in order
	// First match wins

	t.Run("not found before timeout", func(t *testing.T) {
		// "not found" is checked before "timeout"
		result := ParseError("not found after timeout")
		if result != ErrElementNotFound {
			t.Errorf("expected ErrElementNotFound, got %v", result)
		}
	})

	t.Run("not visible before not enabled", func(t *testing.T) {
		result := ParseError("element not visible and not enabled")
		if result != ErrElementNotVisible {
			t.Errorf("expected ErrElementNotVisible, got %v", result)
		}
	})

	t.Run("disabled before stale", func(t *testing.T) {
		result := ParseError("disabled element is stale")
		// "not enabled" check includes "disabled"
		if result != ErrElementNotEnabled {
			t.Errorf("expected ErrElementNotEnabled, got %v", result)
		}
	})
}

// TestCommandErrorFormatting tests CommandError string formatting
func TestCommandErrorFormatting(t *testing.T) {
	testCases := []struct {
		name string
		err  *CommandError
	}{
		{
			name: "basic",
			err: &CommandError{
				Command: "click",
				Args:    []string{"@e1"},
				Output:  "element not found",
				Err:     ErrElementNotFound,
			},
		},
		{
			name: "no args",
			err: &CommandError{
				Command: "snapshot",
				Args:    nil,
				Output:  "timeout",
				Err:     ErrTimeout,
			},
		},
		{
			name: "empty args",
			err: &CommandError{
				Command: "reload",
				Args:    []string{},
				Output:  "navigation failed",
				Err:     ErrNavigationFailed,
			},
		},
		{
			name: "many args",
			err: &CommandError{
				Command: "type",
				Args:    []string{"@e1", "hello world", "--delay", "50", "--clear"},
				Output:  "not editable",
				Err:     ErrElementNotEditable,
			},
		},
		{
			name: "empty output",
			err: &CommandError{
				Command: "click",
				Args:    []string{"@e1"},
				Output:  "",
				Err:     ErrTimeout,
			},
		},
		{
			name: "nil underlying error",
			err: &CommandError{
				Command: "test",
				Args:    []string{},
				Output:  "some output",
				Err:     nil,
			},
		},
		{
			name: "multiline output",
			err: &CommandError{
				Command: "eval",
				Args:    []string{"script"},
				Output:  "line1\nline2\nline3",
				Err:     errors.New("script error"),
			},
		},
		{
			name: "special chars in output",
			err: &CommandError{
				Command: "type",
				Args:    []string{"@e1", "test"},
				Output:  "Error: <html>&entity;\"quotes\"",
				Err:     errors.New("typing failed"),
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			msg := tc.err.Error()
			if msg == "" {
				t.Error("error message should not be empty")
			}

			// Message should contain command name
			if !strings.Contains(msg, tc.err.Command) {
				t.Errorf("message should contain command name %q", tc.err.Command)
			}
		})
	}
}

// TestConfigurationCombinations tests various configuration combinations
func TestConfigurationCombinations(t *testing.T) {
	testCases := []struct {
		name   string
		config ClientConfig
	}{
		{"empty", ClientConfig{}},
		{"port_only", ClientConfig{CDPPort: 9222}},
		{"url_only", ClientConfig{CDPURL: "ws://localhost:9222"}},
		{"port_and_url", ClientConfig{CDPPort: 9222, CDPURL: "ws://localhost:9222"}},
		{"with_session", ClientConfig{CDPPort: 9222, Session: "test"}},
		{"with_timeout", ClientConfig{CDPPort: 9222, Timeout: 60000}},
		{"with_binary", ClientConfig{CDPPort: 9222, BinaryPath: "/usr/bin/agent-browser"}},
		{"all_fields", ClientConfig{
			CDPPort:    9222,
			CDPURL:     "ws://localhost:9222",
			Session:    "test-session",
			Timeout:    60000,
			BinaryPath: "/custom/path",
		}},
		{"minimal_port", ClientConfig{CDPPort: 1}},
		{"max_port", ClientConfig{CDPPort: 65535}},
		{"large_timeout", ClientConfig{CDPPort: 9222, Timeout: 3600000}},
		{"small_timeout", ClientConfig{CDPPort: 9222, Timeout: 1}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Should not panic
			_ = tc.config.CDPPort
			_ = tc.config.CDPURL
			_ = tc.config.Session
			_ = tc.config.Timeout
			_ = tc.config.BinaryPath

			// JSON round-trip should work
			data, err := json.Marshal(tc.config)
			if err != nil {
				t.Errorf("marshal failed: %v", err)
			}

			var decoded ClientConfig
			if err := json.Unmarshal(data, &decoded); err != nil {
				t.Errorf("unmarshal failed: %v", err)
			}

			if decoded != tc.config {
				t.Error("config not preserved through JSON round-trip")
			}
		})
	}
}

// TestOptionsCombinations tests various option type combinations
func TestOptionsCombinations(t *testing.T) {
	t.Run("ClickOptions", func(t *testing.T) {
		buttons := []string{"", "left", "right", "middle"}
		counts := []int{0, 1, 2, 3}
		delays := []int{0, 50, 100, 1000}

		for _, button := range buttons {
			for _, count := range counts {
				for _, delay := range delays {
					opts := ClickOptions{
						Button:     button,
						ClickCount: count,
						Delay:      delay,
					}
					// Should not panic
					_ = opts.Button
					_ = opts.ClickCount
					_ = opts.Delay
				}
			}
		}
	})

	t.Run("ScreenshotOptions", func(t *testing.T) {
		paths := []string{"", "/tmp/test.png", "/tmp/test.jpg", "relative.png"}
		fullPages := []bool{true, false}
		qualities := []int{0, 50, 80, 100}

		for _, path := range paths {
			for _, fullPage := range fullPages {
				for _, quality := range qualities {
					opts := ScreenshotOptions{
						Path:     path,
						FullPage: fullPage,
						Quality:  quality,
					}
					_ = opts.Path
					_ = opts.FullPage
					_ = opts.Quality
				}
			}
		}
	})

	t.Run("WaitOptions", func(t *testing.T) {
		timeouts := []int{0, 1000, 5000, 30000}
		states := []string{"", "visible", "hidden", "attached", "detached"}

		for _, timeout := range timeouts {
			for _, state := range states {
				opts := WaitOptions{
					Timeout: timeout,
					State:   state,
				}
				_ = opts.Timeout
				_ = opts.State
			}
		}
	})
}

// TestScrollDirectionStringValues tests all scroll direction string values
func TestScrollDirectionStringValues(t *testing.T) {
	directions := map[ScrollDirection]string{
		ScrollUp:    "up",
		ScrollDown:  "down",
		ScrollLeft:  "left",
		ScrollRight: "right",
	}

	for dir, expected := range directions {
		t.Run(expected, func(t *testing.T) {
			if string(dir) != expected {
				t.Errorf("expected %q, got %q", expected, string(dir))
			}
		})
	}

	// Ensure no duplicates
	seen := make(map[string]bool)
	for dir := range directions {
		s := string(dir)
		if seen[s] {
			t.Errorf("duplicate direction: %s", s)
		}
		seen[s] = true
	}
}

// TestClientMethodsWithNilConfig tests client methods with edge case configs
func TestClientMethodsWithNilConfig(t *testing.T) {
	t.Run("zero config client", func(t *testing.T) {
		client := &Client{}

		if client.IsConnected() {
			t.Error("zero client should not be connected")
		}

		config := client.GetConfig()
		if config.CDPPort != 0 || config.Timeout != 0 {
			t.Error("zero config should have zero values")
		}
	})

	t.Run("SetTimeout on zero client", func(t *testing.T) {
		client := &Client{}
		client.SetTimeout(5000)
		if client.config.Timeout != 5000 {
			t.Error("SetTimeout should work on zero client")
		}
	})

	t.Run("SetSession on zero client", func(t *testing.T) {
		client := &Client{}
		client.SetSession("test")
		if client.config.Session != "test" {
			t.Error("SetSession should work on zero client")
		}
	})
}

// TestSnapshotResultWithSpecialElements tests snapshot with unusual elements
func TestSnapshotResultWithSpecialElements(t *testing.T) {
	t.Run("element with all fields empty", func(t *testing.T) {
		result := &SnapshotResult{
			Elements: []Element{{}},
		}
		if result.Count() != 1 {
			t.Error("should have 1 element")
		}
		if result.IsEmpty() {
			t.Error("should not be empty")
		}
	})

	t.Run("element with only ref", func(t *testing.T) {
		result := &SnapshotResult{
			Elements: []Element{{Ref: "@e1"}},
		}
		found := result.FindElementByRef("@e1")
		if found == nil {
			t.Error("should find element by ref")
		}
	})

	t.Run("element with special role", func(t *testing.T) {
		result := &SnapshotResult{
			Elements: []Element{
				{Ref: "@e1", Role: "custom-role-123"},
			},
		}
		found := result.FindElementsByRole("custom-role-123")
		if len(found) != 1 {
			t.Error("should find element by custom role")
		}
	})
}

// TestConcurrentSnapshotOperations tests concurrent operations on snapshots
func TestConcurrentSnapshotOperations(t *testing.T) {
	// Create a large snapshot
	var builder strings.Builder
	for i := 0; i < 100; i++ {
		builder.WriteString(fmt.Sprintf("@e%d: button \"Button %d\"\n", i, i))
	}
	result := ParseSnapshot(builder.String())

	var wg sync.WaitGroup
	errors := make(chan error, 1000)

	// Concurrent reads
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()

			ref := fmt.Sprintf("@e%d", n)
			found := result.FindElementByRef(ref)
			if found == nil {
				errors <- fmt.Errorf("@e%d not found", n)
			}
		}(i)
	}

	// Concurrent role searches
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			buttons := result.FindElementsByRole("button")
			if len(buttons) != 100 {
				errors <- fmt.Errorf("expected 100 buttons, got %d", len(buttons))
			}
		}()
	}

	// Concurrent text searches
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			text := fmt.Sprintf("Button %d", n)
			found := result.FindElementsByText(text)
			if len(found) == 0 {
				errors <- fmt.Errorf("text %q not found", text)
			}
		}(i)
	}

	wg.Wait()
	close(errors)

	for err := range errors {
		t.Error(err)
	}
}

// TestContextTimeoutBehavior tests context timeout behavior
func TestContextTimeoutBehavior(t *testing.T) {
	t.Run("immediate timeout", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), time.Nanosecond)
		defer cancel()

		// Give it a moment to expire
		time.Sleep(time.Microsecond)

		if ctx.Err() != context.DeadlineExceeded {
			t.Error("context should be expired")
		}
	})

	t.Run("cancel before timeout", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), time.Hour)
		cancel()

		if ctx.Err() != context.Canceled {
			t.Error("context should be canceled")
		}
	})

	t.Run("context with value and timeout", func(t *testing.T) {
		type key string
		parent := context.WithValue(context.Background(), key("test"), "value")
		ctx, cancel := context.WithTimeout(parent, time.Hour)
		defer cancel()

		if ctx.Value(key("test")) != "value" {
			t.Error("value should be preserved")
		}
	})
}

// TestErrorIs tests errors.Is behavior with our errors
func TestErrorIs(t *testing.T) {
	allErrors := []error{
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

	t.Run("self equality", func(t *testing.T) {
		for _, err := range allErrors {
			if !errors.Is(err, err) {
				t.Errorf("error should equal itself: %v", err)
			}
		}
	})

	t.Run("wrapped equality", func(t *testing.T) {
		for _, err := range allErrors {
			wrapped := fmt.Errorf("wrapped: %w", err)
			if !errors.Is(wrapped, err) {
				t.Errorf("wrapped error should match: %v", err)
			}
		}
	})

	t.Run("double wrapped", func(t *testing.T) {
		for _, err := range allErrors {
			wrapped := fmt.Errorf("level2: %w", fmt.Errorf("level1: %w", err))
			if !errors.Is(wrapped, err) {
				t.Errorf("double wrapped should match: %v", err)
			}
		}
	})

	t.Run("command error unwrap", func(t *testing.T) {
		for _, err := range allErrors {
			cmdErr := &CommandError{
				Command: "test",
				Err:     err,
			}
			if !errors.Is(cmdErr, err) {
				t.Errorf("command error should match underlying: %v", err)
			}
		}
	})
}

// TestElementFieldsPreservation tests that all element fields are preserved
func TestElementFieldsPreservation(t *testing.T) {
	original := Element{
		Ref:         "@e123",
		Role:        "custom-role",
		Name:        "Custom Name",
		Description: "A description",
		Enabled:     true,
		Visible:     true,
	}

	// JSON round-trip
	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}

	var decoded Element
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	if decoded.Ref != original.Ref {
		t.Error("Ref not preserved")
	}
	if decoded.Role != original.Role {
		t.Error("Role not preserved")
	}
	if decoded.Name != original.Name {
		t.Error("Name not preserved")
	}
	if decoded.Description != original.Description {
		t.Error("Description not preserved")
	}
	if decoded.Enabled != original.Enabled {
		t.Error("Enabled not preserved")
	}
	if decoded.Visible != original.Visible {
		t.Error("Visible not preserved")
	}
}

// TestSnapshotResultFieldsPreservation tests snapshot result field preservation
func TestSnapshotResultFieldsPreservation(t *testing.T) {
	original := SnapshotResult{
		Elements: []Element{
			{Ref: "@e1", Role: "button", Name: "Test"},
		},
		Raw:   "@e1: button \"Test\"",
		URL:   "https://example.com/page",
		Title: "Test Page Title",
	}

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}

	var decoded SnapshotResult
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	if len(decoded.Elements) != len(original.Elements) {
		t.Error("Elements count not preserved")
	}
	if decoded.Raw != original.Raw {
		t.Error("Raw not preserved")
	}
	if decoded.URL != original.URL {
		t.Error("URL not preserved")
	}
	if decoded.Title != original.Title {
		t.Error("Title not preserved")
	}
}

// BenchmarkFinalEdgeCases benchmarks final edge cases
func BenchmarkFinalEdgeCases(b *testing.B) {
	b.Run("ParseError_known", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = ParseError("element not found")
		}
	})

	b.Run("ParseError_unknown", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = ParseError("random message")
		}
	})

	b.Run("CommandError_format", func(b *testing.B) {
		err := &CommandError{
			Command: "click",
			Args:    []string{"@e1"},
			Output:  "element not found",
			Err:     ErrElementNotFound,
		}
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = err.Error()
		}
	})

	b.Run("Element_JSON", func(b *testing.B) {
		elem := Element{Ref: "@e1", Role: "button", Name: "Test", Enabled: true, Visible: true}
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			data, _ := json.Marshal(elem)
			var decoded Element
			_ = json.Unmarshal(data, &decoded)
		}
	})
}
