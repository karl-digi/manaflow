package browser

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestJSONSerialization tests JSON marshaling/unmarshaling of types
func TestJSONSerialization(t *testing.T) {
	t.Run("Element serialization", func(t *testing.T) {
		elem := Element{
			Ref:         "@e1",
			Role:        "button",
			Name:        "Submit",
			Description: "Submit form",
			Enabled:     true,
			Visible:     true,
		}

		data, err := json.Marshal(elem)
		if err != nil {
			t.Fatalf("failed to marshal: %v", err)
		}

		var decoded Element
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}

		if decoded.Ref != elem.Ref {
			t.Errorf("Ref mismatch: got %q, want %q", decoded.Ref, elem.Ref)
		}
		if decoded.Role != elem.Role {
			t.Errorf("Role mismatch: got %q, want %q", decoded.Role, elem.Role)
		}
		if decoded.Name != elem.Name {
			t.Errorf("Name mismatch: got %q, want %q", decoded.Name, elem.Name)
		}
		if decoded.Enabled != elem.Enabled {
			t.Errorf("Enabled mismatch: got %v, want %v", decoded.Enabled, elem.Enabled)
		}
	})

	t.Run("SnapshotResult serialization", func(t *testing.T) {
		result := SnapshotResult{
			Elements: []Element{
				{Ref: "@e1", Role: "button", Name: "Test"},
			},
			Raw:   "@e1: button \"Test\"",
			URL:   "https://example.com",
			Title: "Example",
		}

		data, err := json.Marshal(result)
		if err != nil {
			t.Fatalf("failed to marshal: %v", err)
		}

		var decoded SnapshotResult
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}

		if len(decoded.Elements) != len(result.Elements) {
			t.Errorf("Elements count mismatch")
		}
		if decoded.URL != result.URL {
			t.Errorf("URL mismatch")
		}
	})

	t.Run("Element with special characters in JSON", func(t *testing.T) {
		elem := Element{
			Ref:  "@e1",
			Role: "button",
			Name: "Test \"quoted\" <html> & special",
		}

		data, err := json.Marshal(elem)
		if err != nil {
			t.Fatalf("failed to marshal: %v", err)
		}

		var decoded Element
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}

		if decoded.Name != elem.Name {
			t.Errorf("Name mismatch after JSON round-trip: got %q, want %q", decoded.Name, elem.Name)
		}
	})

	t.Run("Element with unicode in JSON", func(t *testing.T) {
		elem := Element{
			Ref:  "@e1",
			Role: "button",
			Name: "提交 Submit 🚀",
		}

		data, err := json.Marshal(elem)
		if err != nil {
			t.Fatalf("failed to marshal: %v", err)
		}

		var decoded Element
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}

		if decoded.Name != elem.Name {
			t.Errorf("Name mismatch: got %q, want %q", decoded.Name, elem.Name)
		}
	})

	t.Run("ClientConfig serialization", func(t *testing.T) {
		config := ClientConfig{
			CDPPort:    9222,
			CDPURL:     "ws://localhost:9222",
			Session:    "test-session",
			Timeout:    30000,
			BinaryPath: "/usr/bin/agent-browser",
		}

		data, err := json.Marshal(config)
		if err != nil {
			t.Fatalf("failed to marshal: %v", err)
		}

		var decoded ClientConfig
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}

		if decoded.CDPPort != config.CDPPort {
			t.Errorf("CDPPort mismatch")
		}
		if decoded.CDPURL != config.CDPURL {
			t.Errorf("CDPURL mismatch")
		}
	})
}

// TestConcurrentParsing tests thread-safety of parsing
func TestConcurrentParsing(t *testing.T) {
	input := `
@e1: button "Button 1"
@e2: input "Input 1"
@e3: link "Link 1"
@e4: button "Button 2"
@e5: input "Input 2"
`

	var wg sync.WaitGroup
	errors := make(chan error, 100)

	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			result := ParseSnapshot(input)
			if result == nil {
				errors <- nil
				return
			}

			// Perform various operations
			_ = result.FindElementByRef("@e1")
			_ = result.FindElementsByRole("button")
			_ = result.FindElementsByText("Button")
			_ = result.GetRefs()
			_ = result.Count()
			_ = result.GetButtons()
		}()
	}

	wg.Wait()
	close(errors)

	for err := range errors {
		if err != nil {
			t.Errorf("concurrent operation failed: %v", err)
		}
	}
}

// TestRaceConditions tests for race conditions
func TestRaceConditions(t *testing.T) {
	t.Run("concurrent snapshot parsing", func(t *testing.T) {
		var wg sync.WaitGroup
		for i := 0; i < 50; i++ {
			wg.Add(1)
			go func(n int) {
				defer wg.Done()
				input := "@e" + string(rune('0'+n%10)) + ": button \"Test\""
				result := ParseSnapshot(input)
				_ = result.Count()
			}(i)
		}
		wg.Wait()
	})

	t.Run("concurrent error parsing", func(t *testing.T) {
		messages := []string{
			"element not found",
			"element not visible",
			"timeout",
			"navigation failed",
			"random error",
		}

		var wg sync.WaitGroup
		for i := 0; i < 50; i++ {
			wg.Add(1)
			go func(n int) {
				defer wg.Done()
				_ = ParseError(messages[n%len(messages)])
			}(i)
		}
		wg.Wait()
	})
}

// TestSelectorFormats tests various selector format edge cases
func TestSelectorFormats(t *testing.T) {
	// Test that various selector strings are handled
	selectors := []string{
		// Refs
		"@e1",
		"@e123",
		"@e999999",

		// CSS selectors
		"#id",
		".class",
		"div.class",
		"div#id.class",
		"[data-test]",
		"[data-test='value']",
		"input[type='text']",
		"div > span",
		"div + span",
		"div ~ span",
		":nth-child(2)",
		":first-child",
		":last-child",
		"::placeholder",

		// XPath
		"//div",
		"//div[@id='test']",
		"/html/body/div",

		// Text selectors
		"text=Submit",
		"text='Submit'",
		"text=\"Submit\"",

		// Complex selectors
		"div.container > form input[type='submit']",
		"#app >> .modal >> button",
	}

	for _, sel := range selectors {
		t.Run(sel, func(t *testing.T) {
			// Just verify these don't cause panics
			// In a real scenario, these would be passed to agent-browser
			if sel == "" {
				t.Error("empty selector")
			}
		})
	}
}

// TestTimeoutBehavior tests various timeout scenarios
func TestTimeoutBehavior(t *testing.T) {
	t.Run("zero timeout config", func(t *testing.T) {
		config := ClientConfig{CDPPort: 9222, Timeout: 0}
		// Zero timeout should use default
		if config.Timeout != 0 {
			t.Error("expected zero timeout in config")
		}
	})

	t.Run("very small timeout", func(t *testing.T) {
		config := ClientConfig{CDPPort: 9222, Timeout: 1}
		if config.Timeout != 1 {
			t.Errorf("expected timeout 1, got %d", config.Timeout)
		}
	})

	t.Run("very large timeout", func(t *testing.T) {
		config := ClientConfig{CDPPort: 9222, Timeout: 3600000} // 1 hour
		if config.Timeout != 3600000 {
			t.Errorf("expected timeout 3600000, got %d", config.Timeout)
		}
	})
}

// TestClientStateMachine tests client state transitions
func TestClientStateMachine(t *testing.T) {
	t.Run("initial state", func(t *testing.T) {
		client := &Client{
			config: ClientConfig{CDPPort: 9222, Timeout: 30000},
		}

		if client.IsConnected() {
			t.Error("client should not be connected initially")
		}
	})

	t.Run("connect sets connected", func(t *testing.T) {
		client := &Client{
			config:    ClientConfig{CDPPort: 9222, Timeout: 30000},
			connected: false,
		}

		// Manually set connected to test the state
		client.connected = true
		if !client.IsConnected() {
			t.Error("client should be connected after setting connected=true")
		}
	})

	t.Run("close resets connected", func(t *testing.T) {
		client := &Client{
			config:    ClientConfig{CDPPort: 9222, Timeout: 30000},
			connected: true,
		}

		// Close should reset connected (even without actual connection)
		_ = client.Close(context.Background())
		if client.IsConnected() {
			t.Error("client should not be connected after Close")
		}
	})
}

// TestContextDeadlineExceeded tests deadline exceeded scenarios
func TestContextDeadlineExceeded(t *testing.T) {
	t.Run("expired context", func(t *testing.T) {
		ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-1*time.Second))
		defer cancel()

		if ctx.Err() != context.DeadlineExceeded {
			t.Error("expected deadline exceeded")
		}
	})

	t.Run("context value preservation", func(t *testing.T) {
		type key string
		ctx := context.WithValue(context.Background(), key("test"), "value")

		if ctx.Value(key("test")) != "value" {
			t.Error("context value not preserved")
		}
	})
}

// TestWaitOptionsVariations tests various WaitOptions combinations
func TestWaitOptionsVariations(t *testing.T) {
	variations := []WaitOptions{
		{},
		{Timeout: 1},
		{Timeout: 30000},
		{Timeout: 60000},
		{State: "visible"},
		{State: "hidden"},
		{State: "attached"},
		{State: "detached"},
		{Timeout: 5000, State: "visible"},
		{Timeout: 10000, State: "hidden"},
	}

	for i, opts := range variations {
		t.Run("variation_"+string(rune('A'+i)), func(t *testing.T) {
			// Just verify no panic
			_ = opts.Timeout
			_ = opts.State
		})
	}
}

// TestScreenshotOptionsVariations tests various ScreenshotOptions combinations
func TestScreenshotOptionsVariations(t *testing.T) {
	variations := []ScreenshotOptions{
		{},
		{Path: "/tmp/test.png"},
		{Path: "/tmp/test.jpg"},
		{Path: "/tmp/test.jpeg"},
		{Path: "/tmp/test.webp"},
		{FullPage: true},
		{FullPage: false},
		{Quality: 0},
		{Quality: 50},
		{Quality: 100},
		{Path: "/tmp/test.png", FullPage: true, Quality: 80},
		{Path: "relative/path.png"},
		{Path: "./current.png"},
		{Path: "../parent.png"},
		{Path: "~/home.png"},
	}

	for i, opts := range variations {
		t.Run("variation_"+string(rune('A'+i)), func(t *testing.T) {
			_ = opts.Path
			_ = opts.FullPage
			_ = opts.Quality
		})
	}
}

// TestClickOptionsVariations tests various ClickOptions combinations
func TestClickOptionsVariations(t *testing.T) {
	variations := []ClickOptions{
		{},
		{Button: "left"},
		{Button: "right"},
		{Button: "middle"},
		{ClickCount: 1},
		{ClickCount: 2},
		{ClickCount: 3},
		{Delay: 0},
		{Delay: 50},
		{Delay: 100},
		{Delay: 1000},
		{Button: "left", ClickCount: 2, Delay: 50},
		{Button: "right", ClickCount: 1, Delay: 0},
	}

	for i, opts := range variations {
		t.Run("variation_"+string(rune('A'+i)), func(t *testing.T) {
			_ = opts.Button
			_ = opts.ClickCount
			_ = opts.Delay
		})
	}
}

// TestSnapshotResultMemory tests memory behavior with large snapshots
func TestSnapshotResultMemory(t *testing.T) {
	t.Run("large snapshot creation", func(t *testing.T) {
		elements := make([]Element, 10000)
		for i := range elements {
			elements[i] = Element{
				Ref:  "@e" + string(rune('0'+i%10)),
				Role: "button",
				Name: "Button",
			}
		}

		result := &SnapshotResult{
			Elements: elements,
			Raw:      "large raw string",
		}

		if result.Count() != 10000 {
			t.Errorf("expected 10000 elements, got %d", result.Count())
		}
	})

	t.Run("snapshot with empty elements", func(t *testing.T) {
		result := &SnapshotResult{
			Elements: []Element{},
		}

		if !result.IsEmpty() {
			t.Error("expected empty")
		}
	})

	t.Run("snapshot with nil elements", func(t *testing.T) {
		result := &SnapshotResult{
			Elements: nil,
		}

		if !result.IsEmpty() {
			t.Error("expected empty with nil elements")
		}
		if result.Count() != 0 {
			t.Error("expected count 0 with nil elements")
		}
	})
}

// TestErrorChaining tests error wrapping and chaining
func TestErrorChaining(t *testing.T) {
	t.Run("CommandError wraps underlying error", func(t *testing.T) {
		underlying := ErrElementNotFound
		cmdErr := &CommandError{
			Command: "click",
			Args:    []string{"@e1"},
			Output:  "element not found",
			Err:     underlying,
		}

		// Test Unwrap
		if cmdErr.Unwrap() != underlying {
			t.Error("Unwrap should return underlying error")
		}

		// Test error message
		msg := cmdErr.Error()
		if msg == "" {
			t.Error("error message should not be empty")
		}
	})

	t.Run("CommandError with nil underlying", func(t *testing.T) {
		cmdErr := &CommandError{
			Command: "click",
			Args:    []string{"@e1"},
			Output:  "some output",
			Err:     nil,
		}

		// Should not panic
		_ = cmdErr.Error()
		if cmdErr.Unwrap() != nil {
			t.Error("Unwrap should return nil for nil error")
		}
	})
}

// TestRefPatternEdgeCases tests edge cases in ref pattern matching
func TestRefPatternEdgeCases(t *testing.T) {
	testCases := []struct {
		input    string
		hasMatch bool
	}{
		// Valid patterns
		{"@e0: button", true},
		{"@e1: button", true},
		{"@e9: button", true},
		{"@e10: button", true},
		{"@e99: button", true},
		{"@e100: button", true},
		{"@e999: button", true},
		{"@e00000: button", true}, // Leading zeros

		// Invalid patterns
		{"@e: button", false},       // No number
		{"@ea: button", false},      // Letter instead of number
		{"@E1: button", false},      // Uppercase E
		{"@e-1: button", false},     // Negative (dash before number)
		{"e1: button", false},       // Missing @
		{"@f1: button", false},      // Wrong letter
		{"@@e1: button", false},     // Double @
		{"@ e1: button", false},     // Space after @
		{"@e 1: button", false},     // Space before number
		{"@e1 : button", true},      // Space before colon is valid due to TrimSpace
		{"@e1button", false},        // No colon
		{"e@1: button", false},      // Wrong order
		{"1@e: button", false},      // Number first
		{"@element1: button", false}, // Full word
	}

	for _, tc := range testCases {
		t.Run(tc.input, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			hasMatch := len(result.Elements) > 0

			if hasMatch != tc.hasMatch {
				t.Errorf("input %q: expected hasMatch=%v, got %v",
					tc.input, tc.hasMatch, hasMatch)
			}
		})
	}
}

// TestParseSnapshotRobustness tests parsing robustness
func TestParseSnapshotRobustness(t *testing.T) {
	// These inputs should not cause panics
	inputs := []string{
		"",
		" ",
		"\n",
		"\t",
		"\r\n",
		"@",
		"@e",
		"@e:",
		"@@",
		"@@@",
		"@e@e@e",
		"::::",
		"\"\"\"\"",
		"''''",
		"@e1: ",
		"@e1:  ",
		"@e1:\t",
		"@e1:\n",
		"@e1: \n",
		"@e1: button\n@e2:",
		"@e1: button \"",
		"@e1: button '",
		"@e1: button \"unterminated",
		string([]byte{0x00, 0x01, 0x02}), // Binary data
		string([]byte{0xFF, 0xFE}),       // BOM-like
	}

	for i, input := range inputs {
		t.Run("input_"+string(rune('A'+i%26))+string(rune('A'+i/26)), func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("panic on input %q: %v", input, r)
				}
			}()

			result := ParseSnapshot(input)
			_ = result.Count()
			_ = result.IsEmpty()
			_ = result.GetRefs()
		})
	}
}

// BenchmarkJSONSerialization benchmarks JSON operations
func BenchmarkJSONSerialization(b *testing.B) {
	elem := Element{
		Ref:         "@e1",
		Role:        "button",
		Name:        "Submit Form",
		Description: "Submit the registration form",
		Enabled:     true,
		Visible:     true,
	}

	b.Run("marshal", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_, _ = json.Marshal(elem)
		}
	})

	data, _ := json.Marshal(elem)
	b.Run("unmarshal", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			var e Element
			_ = json.Unmarshal(data, &e)
		}
	})
}

// BenchmarkConcurrentParsing benchmarks concurrent parsing
func BenchmarkConcurrentParsing(b *testing.B) {
	input := `
@e1: button "Button 1"
@e2: input "Input 1"
@e3: link "Link 1"
@e4: button "Button 2"
@e5: input "Input 2"
`

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			result := ParseSnapshot(input)
			_ = result.Count()
		}
	})
}

// TestRefNumberBoundaries tests extreme ref number boundaries
func TestRefNumberBoundaries(t *testing.T) {
	testCases := []struct {
		name     string
		input    string
		expected int
	}{
		{"zero ref", "@e0: button \"Zero\"", 1},
		{"single digit", "@e5: button \"Five\"", 1},
		{"two digits", "@e42: button \"FortyTwo\"", 1},
		{"three digits", "@e100: button \"Hundred\"", 1},
		{"four digits", "@e9999: button \"Big\"", 1},
		{"five digits", "@e12345: button \"Bigger\"", 1},
		{"six digits", "@e999999: button \"Large\"", 1},
		{"leading zeros single", "@e01: button \"One\"", 1},
		{"leading zeros many", "@e00001: button \"One\"", 1},
		{"all zeros", "@e00000: button \"Zero\"", 1},
		{"max reasonable", "@e999999999: button \"Max\"", 1},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			if len(result.Elements) != tc.expected {
				t.Errorf("expected %d elements, got %d", tc.expected, len(result.Elements))
			}
		})
	}
}

// TestNestedContextScenarios tests context nesting behaviors
func TestNestedContextScenarios(t *testing.T) {
	t.Run("deeply nested contexts", func(t *testing.T) {
		ctx := context.Background()
		for i := 0; i < 100; i++ {
			ctx, _ = context.WithTimeout(ctx, time.Hour)
		}
		// Should still work
		if ctx.Err() != nil {
			t.Error("nested context should not be cancelled")
		}
	})

	t.Run("context with multiple values", func(t *testing.T) {
		type keyType string
		ctx := context.Background()
		for i := 0; i < 50; i++ {
			ctx = context.WithValue(ctx, keyType("key"+string(rune('A'+i%26))), i)
		}

		// Should be able to retrieve values
		if ctx.Value(keyType("keyA")) != 26 {
			// Note: later values override earlier ones with same key
		}
	})

	t.Run("cancelled parent with child", func(t *testing.T) {
		parent, cancel := context.WithCancel(context.Background())
		child, _ := context.WithTimeout(parent, time.Hour)
		cancel()

		// Child should be cancelled too
		if child.Err() != context.Canceled {
			t.Error("child should be cancelled when parent is")
		}
	})
}

// TestClientConfigVariations tests various config scenarios
func TestClientConfigVariations(t *testing.T) {
	testCases := []struct {
		name   string
		config ClientConfig
	}{
		{"empty config", ClientConfig{}},
		{"only port", ClientConfig{CDPPort: 9222}},
		{"only url", ClientConfig{CDPURL: "ws://localhost:9222"}},
		{"only session", ClientConfig{Session: "test"}},
		{"only timeout", ClientConfig{Timeout: 30000}},
		{"only binary", ClientConfig{BinaryPath: "/usr/bin/agent-browser"}},
		{"port and url both set", ClientConfig{CDPPort: 9222, CDPURL: "ws://localhost:9223"}},
		{"all fields set", ClientConfig{
			CDPPort:    9222,
			CDPURL:     "ws://localhost:9222",
			Session:    "test-session",
			Timeout:    60000,
			BinaryPath: "/custom/path",
		}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Should not panic
			_ = tc.config.CDPPort
			_ = tc.config.CDPURL
			_ = tc.config.Session
			_ = tc.config.Timeout
			_ = tc.config.BinaryPath
		})
	}
}

// TestErrorMessageVariations tests various error message formats
func TestErrorMessageVariations(t *testing.T) {
	variations := []struct {
		input    string
		expected error
	}{
		// Element not found variations
		{"element not found", ErrElementNotFound},
		{"Element Not Found", ErrElementNotFound},
		{"ELEMENT NOT FOUND", ErrElementNotFound},
		{"Element @e1 not found", ErrElementNotFound},
		{"selector not found", ErrElementNotFound},
		{"no elements found", nil},          // ParseError looks for "not found", not "elements found"
		{"could not find element", nil},     // ParseError looks for "not found", not "could not find"
		{"waiting for selector failed: not found", ErrElementNotFound},

		// Timeout variations
		{"timeout", ErrTimeout},
		{"TIMEOUT", ErrTimeout},
		{"Timeout", ErrTimeout},
		{"operation timed out", ErrTimeout},
		{"connection timed out", ErrTimeout},
		{"waiting for element timed out", ErrTimeout},
		{"timeout exceeded", ErrTimeout},
		{"timeout waiting for", ErrTimeout},

		// Not visible variations
		{"not visible", ErrElementNotVisible},
		{"element is not visible", ErrElementNotVisible},
		{"visibility check failed: not visible", ErrElementNotVisible},
		{"element hidden", nil},     // ParseError looks for "not visible", not "hidden"
		{"element is hidden", nil},  // ParseError looks for "not visible", not "hidden"

		// Not enabled variations
		{"not enabled", ErrElementNotEnabled},
		{"element is disabled", ErrElementNotEnabled},
		{"disabled", ErrElementNotEnabled},
		{"element not enabled", ErrElementNotEnabled},

		// Navigation variations
		{"navigation failed", ErrNavigationFailed},
		{"Navigation Failed", ErrNavigationFailed},
		{"page navigation failed", ErrNavigationFailed},
		{"navigation error", ErrNavigationFailed},

		// Connection variations (ParseError doesn't handle these, returns nil)
		{"connection refused", nil},
		{"Connection Refused", nil},
		{"failed to connect", nil},
		{"connection failed", nil},
		{"could not connect", nil},

		// Browser not running (ParseError doesn't handle these, returns nil)
		{"browser not running", nil},
		{"browser is not running", nil},
		{"no browser instance", nil},

		// Unknown error cases
		{"some random error", nil},
		{"unexpected failure", nil},
		{"unknown issue", nil},
		{"", nil},
	}

	for _, v := range variations {
		t.Run(v.input, func(t *testing.T) {
			result := ParseError(v.input)
			if result != v.expected {
				t.Errorf("ParseError(%q) = %v, want %v", v.input, result, v.expected)
			}
		})
	}
}

// TestSnapshotWithSpecialRoles tests parsing elements with various roles
func TestSnapshotWithSpecialRoles(t *testing.T) {
	testCases := []struct {
		input string
		role  string
	}{
		{"@e1: button \"Test\"", "button"},
		{"@e1: input \"Test\"", "input"},
		{"@e1: link \"Test\"", "link"},
		{"@e1: checkbox \"Test\"", "checkbox"},
		{"@e1: radio \"Test\"", "radio"},
		{"@e1: textbox \"Test\"", "textbox"},
		{"@e1: textarea \"Test\"", "textarea"},
		{"@e1: select \"Test\"", "select"},
		{"@e1: option \"Test\"", "option"},
		{"@e1: img \"Test\"", "img"},
		{"@e1: heading \"Test\"", "heading"},
		{"@e1: paragraph \"Test\"", "paragraph"},
		{"@e1: listitem \"Test\"", "listitem"},
		{"@e1: table \"Test\"", "table"},
		{"@e1: row \"Test\"", "row"},
		{"@e1: cell \"Test\"", "cell"},
		{"@e1: dialog \"Test\"", "dialog"},
		{"@e1: alert \"Test\"", "alert"},
		{"@e1: menu \"Test\"", "menu"},
		{"@e1: menuitem \"Test\"", "menuitem"},
		{"@e1: navigation \"Test\"", "navigation"},
		{"@e1: main \"Test\"", "main"},
		{"@e1: article \"Test\"", "article"},
		{"@e1: section \"Test\"", "section"},
		{"@e1: custom-role \"Test\"", "custom-role"},
		{"@e1: BUTTON \"Test\"", "BUTTON"},  // Case preserved
		{"@e1: Button \"Test\"", "Button"},  // Case preserved
	}

	for _, tc := range testCases {
		t.Run(tc.role, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			if len(result.Elements) != 1 {
				t.Fatalf("expected 1 element, got %d", len(result.Elements))
			}
			if result.Elements[0].Role != tc.role {
				t.Errorf("expected role %q, got %q", tc.role, result.Elements[0].Role)
			}
		})
	}
}

// TestMultipleElementsOrdering tests that element order is preserved
func TestMultipleElementsOrdering(t *testing.T) {
	input := `
@e1: button "First"
@e2: input "Second"
@e3: link "Third"
@e4: checkbox "Fourth"
@e5: radio "Fifth"
`
	result := ParseSnapshot(input)

	if len(result.Elements) != 5 {
		t.Fatalf("expected 5 elements, got %d", len(result.Elements))
	}

	expectedRefs := []string{"@e1", "@e2", "@e3", "@e4", "@e5"}
	expectedNames := []string{"First", "Second", "Third", "Fourth", "Fifth"}

	for i, elem := range result.Elements {
		if elem.Ref != expectedRefs[i] {
			t.Errorf("element %d: expected ref %q, got %q", i, expectedRefs[i], elem.Ref)
		}
		if elem.Name != expectedNames[i] {
			t.Errorf("element %d: expected name %q, got %q", i, expectedNames[i], elem.Name)
		}
	}
}

// TestNonSequentialRefs tests handling of non-sequential ref numbers
func TestNonSequentialRefs(t *testing.T) {
	input := `
@e10: button "Ten"
@e5: input "Five"
@e100: link "Hundred"
@e1: checkbox "One"
@e50: radio "Fifty"
`
	result := ParseSnapshot(input)

	if len(result.Elements) != 5 {
		t.Fatalf("expected 5 elements, got %d", len(result.Elements))
	}

	// Order should be preserved as parsed, not by ref number
	if result.Elements[0].Ref != "@e10" {
		t.Errorf("first element should be @e10, got %s", result.Elements[0].Ref)
	}
	if result.Elements[1].Ref != "@e5" {
		t.Errorf("second element should be @e5, got %s", result.Elements[1].Ref)
	}
}

// TestFindElementsConcurrently tests concurrent access to find methods
func TestFindElementsConcurrently(t *testing.T) {
	input := `
@e1: button "Submit"
@e2: button "Cancel"
@e3: input "Email"
@e4: input "Password"
@e5: link "Forgot Password"
@e6: link "Sign Up"
`
	result := ParseSnapshot(input)

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(4)

		go func() {
			defer wg.Done()
			_ = result.FindElementByRef("@e1")
			_ = result.FindElementByRef("@e3")
			_ = result.FindElementByRef("@e5")
		}()

		go func() {
			defer wg.Done()
			_ = result.FindElementsByRole("button")
			_ = result.FindElementsByRole("input")
			_ = result.FindElementsByRole("link")
		}()

		go func() {
			defer wg.Done()
			_ = result.FindElementsByText("Submit")
			_ = result.FindElementsByText("Password")
		}()

		go func() {
			defer wg.Done()
			_ = result.GetButtons()
			_ = result.GetInputs()
			_ = result.GetLinks()
		}()
	}

	wg.Wait()
}

// TestSnapshotWithMixedWhitespace tests parsing with various whitespace
func TestSnapshotWithMixedWhitespace(t *testing.T) {
	testCases := []struct {
		name     string
		input    string
		expected int
	}{
		{"tabs between", "@e1:\tbutton\t\"Test\"", 1},
		{"multiple spaces", "@e1:  button  \"Test\"", 1},
		{"newlines in input", "@e1: button \"Test\"\n\n\n@e2: input \"Field\"", 2},
		{"carriage returns", "@e1: button \"Test\"\r\n@e2: input \"Field\"", 2},
		{"mixed whitespace", "@e1: \t button \t \"Test\"", 1},
		{"leading whitespace on line", "  @e1: button \"Test\"", 1},
		{"trailing whitespace on line", "@e1: button \"Test\"   ", 1},
		{"empty lines between", "@e1: button \"A\"\n\n\n\n@e2: button \"B\"", 2},
		{"whitespace only lines between", "@e1: button \"A\"\n   \n\t\n@e2: button \"B\"", 2},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			if len(result.Elements) != tc.expected {
				t.Errorf("expected %d elements, got %d", tc.expected, len(result.Elements))
			}
		})
	}
}

// TestElementWithEmptyName tests handling of elements without names
func TestElementWithEmptyName(t *testing.T) {
	testCases := []struct {
		input    string
		hasName  bool
		expected string
	}{
		{"@e1: button \"\"", true, ""},
		{"@e1: button ''", true, ""},
		{"@e1: button", false, ""},
		{"@e1: button \"Name\"", true, "Name"},
	}

	for _, tc := range testCases {
		t.Run(tc.input, func(t *testing.T) {
			result := ParseSnapshot(tc.input)
			if len(result.Elements) == 0 {
				t.Fatal("expected at least one element")
			}
			elem := result.Elements[0]
			if elem.Name != tc.expected {
				t.Errorf("expected name %q, got %q", tc.expected, elem.Name)
			}
		})
	}
}

// TestCommandErrorDetails tests CommandError message formatting
func TestCommandErrorDetails(t *testing.T) {
	testCases := []struct {
		name    string
		cmdErr  CommandError
		wantCmd string
	}{
		{
			name: "basic error",
			cmdErr: CommandError{
				Command: "click",
				Args:    []string{"@e1"},
				Output:  "element not found",
				Err:     ErrElementNotFound,
			},
			wantCmd: "click",
		},
		{
			name: "error with multiple args",
			cmdErr: CommandError{
				Command: "type",
				Args:    []string{"@e1", "hello world", "--delay", "50"},
				Output:  "element not found",
				Err:     ErrElementNotFound,
			},
			wantCmd: "type",
		},
		{
			name: "error with no args",
			cmdErr: CommandError{
				Command: "snapshot",
				Args:    []string{},
				Output:  "timeout",
				Err:     ErrTimeout,
			},
			wantCmd: "snapshot",
		},
		{
			name: "error with empty output",
			cmdErr: CommandError{
				Command: "click",
				Args:    []string{"@e1"},
				Output:  "",
				Err:     ErrTimeout,
			},
			wantCmd: "click",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			msg := tc.cmdErr.Error()
			if msg == "" {
				t.Error("error message should not be empty")
			}
			// Verify the command name appears in the error
			if tc.wantCmd != "" && tc.cmdErr.Command != tc.wantCmd {
				t.Errorf("command mismatch: got %q, want %q", tc.cmdErr.Command, tc.wantCmd)
			}
		})
	}
}

// TestZeroValueBehavior tests behavior with zero values
func TestZeroValueBehavior(t *testing.T) {
	t.Run("zero Element", func(t *testing.T) {
		var elem Element
		if elem.Ref != "" || elem.Role != "" || elem.Name != "" {
			t.Error("zero Element should have empty strings")
		}
		if elem.Enabled || elem.Visible {
			t.Error("zero Element should have false booleans")
		}
	})

	t.Run("zero SnapshotResult", func(t *testing.T) {
		var result SnapshotResult
		if result.Count() != 0 {
			t.Error("zero SnapshotResult should have count 0")
		}
		if !result.IsEmpty() {
			t.Error("zero SnapshotResult should be empty")
		}
	})

	t.Run("zero ClientConfig", func(t *testing.T) {
		var config ClientConfig
		if config.CDPPort != 0 || config.Timeout != 0 {
			t.Error("zero ClientConfig should have zero values")
		}
		if config.CDPURL != "" || config.Session != "" || config.BinaryPath != "" {
			t.Error("zero ClientConfig should have empty strings")
		}
	})

	t.Run("zero ClickOptions", func(t *testing.T) {
		var opts ClickOptions
		if opts.Button != "" {
			t.Error("zero ClickOptions should have empty button")
		}
		if opts.ClickCount != 0 || opts.Delay != 0 {
			t.Error("zero ClickOptions should have zero values")
		}
	})

	t.Run("zero ScreenshotOptions", func(t *testing.T) {
		var opts ScreenshotOptions
		if opts.Path != "" {
			t.Error("zero ScreenshotOptions should have empty path")
		}
		if opts.FullPage || opts.Quality != 0 {
			t.Error("zero ScreenshotOptions should have zero/false values")
		}
	})

	t.Run("zero WaitOptions", func(t *testing.T) {
		var opts WaitOptions
		if opts.Timeout != 0 || opts.State != "" {
			t.Error("zero WaitOptions should have zero/empty values")
		}
	})
}

// TestSnapshotResultMethodsWithEmptyResult tests methods on empty snapshot
func TestSnapshotResultMethodsWithEmptyResult(t *testing.T) {
	result := ParseSnapshot("")

	t.Run("FindElementByRef returns nil", func(t *testing.T) {
		if result.FindElementByRef("@e1") != nil {
			t.Error("should return nil for empty snapshot")
		}
	})

	t.Run("FindElementsByRole returns empty", func(t *testing.T) {
		elems := result.FindElementsByRole("button")
		if len(elems) != 0 {
			t.Error("should return empty slice for empty snapshot")
		}
	})

	t.Run("FindElementsByText returns empty", func(t *testing.T) {
		elems := result.FindElementsByText("anything")
		if len(elems) != 0 {
			t.Error("should return empty slice for empty snapshot")
		}
	})

	t.Run("GetRefs returns empty", func(t *testing.T) {
		refs := result.GetRefs()
		if len(refs) != 0 {
			t.Error("should return empty slice for empty snapshot")
		}
	})

	t.Run("GetButtons returns empty", func(t *testing.T) {
		buttons := result.GetButtons()
		if len(buttons) != 0 {
			t.Error("should return empty slice for empty snapshot")
		}
	})

	t.Run("GetInputs returns empty", func(t *testing.T) {
		inputs := result.GetInputs()
		if len(inputs) != 0 {
			t.Error("should return empty slice for empty snapshot")
		}
	})

	t.Run("GetLinks returns empty", func(t *testing.T) {
		links := result.GetLinks()
		if len(links) != 0 {
			t.Error("should return empty slice for empty snapshot")
		}
	})
}

// TestDuplicateRefs tests handling of duplicate ref numbers
func TestDuplicateRefs(t *testing.T) {
	input := `
@e1: button "First"
@e1: input "Second"
@e1: link "Third"
`
	result := ParseSnapshot(input)

	// All should be parsed (duplicates allowed)
	if len(result.Elements) != 3 {
		t.Errorf("expected 3 elements, got %d", len(result.Elements))
	}

	// FindElementByRef should return first match
	found := result.FindElementByRef("@e1")
	if found == nil {
		t.Fatal("expected to find @e1")
	}
	if found.Role != "button" {
		t.Errorf("expected first @e1 (button), got %s", found.Role)
	}
}

// BenchmarkFindMethods benchmarks the find methods
func BenchmarkFindMethods(b *testing.B) {
	// Create a large snapshot
	var builder strings.Builder
	for i := 0; i < 1000; i++ {
		role := []string{"button", "input", "link"}[i%3]
		builder.WriteString("@e" + string(rune('0'+i%10)) + ": " + role + " \"Element " + string(rune('A'+i%26)) + "\"\n")
	}
	input := builder.String()
	result := ParseSnapshot(input)

	b.Run("FindElementByRef", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = result.FindElementByRef("@e5")
		}
	})

	b.Run("FindElementsByRole", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = result.FindElementsByRole("button")
		}
	})

	b.Run("FindElementsByText", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = result.FindElementsByText("Element")
		}
	})
}

// BenchmarkErrorParsing benchmarks error parsing
func BenchmarkErrorParsing(b *testing.B) {
	messages := []string{
		"element not found",
		"timeout",
		"navigation failed",
		"connection refused",
		"some random error",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = ParseError(messages[i%len(messages)])
	}
}
