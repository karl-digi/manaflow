package browser

import (
	"errors"
	"testing"
)

// TestParseErrorEdgeCases tests edge cases for error parsing
func TestParseErrorEdgeCases(t *testing.T) {
	testCases := []struct {
		name     string
		output   string
		expected error
	}{
		// Element not found variations
		{"element not found lowercase", "element not found", ErrElementNotFound},
		{"element not found uppercase", "ELEMENT NOT FOUND", ErrElementNotFound},
		{"element not found mixed case", "Element Not Found", ErrElementNotFound},
		{"element not found with context", "Error: Element @e99 not found in page", ErrElementNotFound},
		{"selector not found", "Selector not found: #missing-id", ErrElementNotFound},
		{"ref not found", "Ref @e5 not found", ErrElementNotFound},

		// Not visible variations
		{"not visible lowercase", "element is not visible", ErrElementNotVisible},
		{"not visible uppercase", "ELEMENT IS NOT VISIBLE", ErrElementNotVisible},
		{"element hidden", "element not visible on page", ErrElementNotVisible},

		// Not enabled variations
		{"not enabled", "element is not enabled", ErrElementNotEnabled},
		{"disabled", "element is disabled", ErrElementNotEnabled},
		{"button disabled", "button is disabled", ErrElementNotEnabled},

		// Not editable variations
		{"not editable", "element is not editable", ErrElementNotEditable},
		{"cannot type in non-editable", "Cannot type: element is not editable", ErrElementNotEditable},

		// Timeout variations
		{"timeout", "operation timeout", ErrTimeout},
		{"timed out", "operation timed out", ErrTimeout},
		{"timeout after seconds", "Timeout after 30 seconds", ErrTimeout},
		{"timed out waiting", "Timed out waiting for element", ErrTimeout},
		{"connection timeout", "Connection timeout to CDP", ErrTimeout},

		// Navigation failures
		{"navigation failed", "navigation failed", ErrNavigationFailed},
		{"navigation error", "Navigation to URL failed", ErrNavigationFailed},

		// Stale ref variations
		{"stale reference", "element reference is stale", ErrStaleRef},
		{"stale element", "Stale element reference", ErrStaleRef},

		// Invalid key variations
		{"unknown key", "Unknown key: FakeKey", ErrInvalidKey},
		{"invalid key", "Invalid key name: NotReal", ErrInvalidKey},

		// No match (should return nil)
		{"random error", "Some random error message", nil},
		{"empty string", "", nil},
		{"just whitespace", "   ", nil},
		{"unrelated message", "Operation completed successfully", nil},
		{"partial match not", "This is noted", nil}, // "not" shouldn't trigger
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got := ParseError(tc.output)
			if got != tc.expected {
				t.Errorf("ParseError(%q) = %v, want %v", tc.output, got, tc.expected)
			}
		})
	}
}

// TestCommandErrorFormat tests CommandError formatting
func TestCommandErrorFormat(t *testing.T) {
	testCases := []struct {
		name     string
		cmdErr   *CommandError
		contains []string
	}{
		{
			name: "click error",
			cmdErr: &CommandError{
				Command: "click",
				Args:    []string{"@e1"},
				Output:  "element not found",
				Err:     ErrElementNotFound,
			},
			contains: []string{"click", "element not found"},
		},
		{
			name: "fill error",
			cmdErr: &CommandError{
				Command: "fill",
				Args:    []string{"@e2", "test@example.com"},
				Output:  "element is not editable",
				Err:     ErrElementNotEditable,
			},
			contains: []string{"fill", "not editable"},
		},
		{
			name: "navigate error",
			cmdErr: &CommandError{
				Command: "open",
				Args:    []string{"https://invalid.invalid"},
				Output:  "Navigation failed: net::ERR_NAME_NOT_RESOLVED",
				Err:     ErrNavigationFailed,
			},
			contains: []string{"open", "Navigation failed"},
		},
		{
			name: "empty command",
			cmdErr: &CommandError{
				Command: "",
				Args:    nil,
				Output:  "error",
				Err:     errors.New("unknown error"),
			},
			contains: []string{"agent-browser", "error"},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			errMsg := tc.cmdErr.Error()
			for _, substr := range tc.contains {
				if !containsIgnoreCase(errMsg, substr) {
					t.Errorf("expected error message to contain %q, got: %s", substr, errMsg)
				}
			}
		})
	}
}

// TestCommandErrorUnwrap tests error unwrapping
func TestCommandErrorUnwrap(t *testing.T) {
	originalErr := ErrElementNotFound
	cmdErr := &CommandError{
		Command: "click",
		Args:    []string{"@e1"},
		Output:  "element not found",
		Err:     originalErr,
	}

	// Test Unwrap
	unwrapped := cmdErr.Unwrap()
	if unwrapped != originalErr {
		t.Errorf("Unwrap() = %v, want %v", unwrapped, originalErr)
	}

	// Test errors.Is
	if !errors.Is(cmdErr, originalErr) {
		t.Error("errors.Is should return true for wrapped error")
	}

	// Test errors.As
	var cmdErrAs *CommandError
	if !errors.As(cmdErr, &cmdErrAs) {
		t.Error("errors.As should work for CommandError")
	}
	if cmdErrAs.Command != "click" {
		t.Errorf("expected command 'click', got %q", cmdErrAs.Command)
	}
}

// TestDefinedErrors tests that all defined errors are unique and non-nil
func TestDefinedErrors(t *testing.T) {
	definedErrors := []struct {
		name string
		err  error
	}{
		{"ErrNotConnected", ErrNotConnected},
		{"ErrElementNotFound", ErrElementNotFound},
		{"ErrElementNotVisible", ErrElementNotVisible},
		{"ErrElementNotEnabled", ErrElementNotEnabled},
		{"ErrElementNotEditable", ErrElementNotEditable},
		{"ErrNavigationFailed", ErrNavigationFailed},
		{"ErrTimeout", ErrTimeout},
		{"ErrCDPConnectionFailed", ErrCDPConnectionFailed},
		{"ErrStaleRef", ErrStaleRef},
		{"ErrInvalidKey", ErrInvalidKey},
		{"ErrNoCDPConfig", ErrNoCDPConfig},
	}

	// Check all errors are non-nil
	for _, e := range definedErrors {
		if e.err == nil {
			t.Errorf("%s should not be nil", e.name)
		}
	}

	// Check all errors are unique
	seen := make(map[string]string)
	for _, e := range definedErrors {
		msg := e.err.Error()
		if existingName, exists := seen[msg]; exists {
			t.Errorf("%s and %s have the same error message: %q", e.name, existingName, msg)
		}
		seen[msg] = e.name
	}
}

// TestErrorMessages tests that error messages are descriptive
func TestErrorMessages(t *testing.T) {
	testCases := []struct {
		err      error
		contains string
	}{
		{ErrNotConnected, "not connected"},
		{ErrElementNotFound, "not found"},
		{ErrElementNotVisible, "not visible"},
		{ErrElementNotEnabled, "not enabled"},
		{ErrElementNotEditable, "not editable"},
		{ErrNavigationFailed, "navigation"},
		{ErrTimeout, "timed out"},
		{ErrCDPConnectionFailed, "connect"},
		{ErrStaleRef, "stale"},
		{ErrInvalidKey, "key"},
		{ErrNoCDPConfig, "CDP"},
	}

	for _, tc := range testCases {
		msg := tc.err.Error()
		if !containsIgnoreCase(msg, tc.contains) {
			t.Errorf("error %v should contain %q, got: %s", tc.err, tc.contains, msg)
		}
	}
}

// Helper function
func containsIgnoreCase(s, substr string) bool {
	return len(s) >= len(substr) &&
		(s == substr ||
			len(substr) == 0 ||
			(len(s) > 0 && len(substr) > 0 &&
				(containsLower(s, substr))))
}

func containsLower(s, substr string) bool {
	sLower := make([]byte, len(s))
	substrLower := make([]byte, len(substr))
	for i := 0; i < len(s); i++ {
		if s[i] >= 'A' && s[i] <= 'Z' {
			sLower[i] = s[i] + 32
		} else {
			sLower[i] = s[i]
		}
	}
	for i := 0; i < len(substr); i++ {
		if substr[i] >= 'A' && substr[i] <= 'Z' {
			substrLower[i] = substr[i] + 32
		} else {
			substrLower[i] = substr[i]
		}
	}

	for i := 0; i <= len(sLower)-len(substrLower); i++ {
		match := true
		for j := 0; j < len(substrLower); j++ {
			if sLower[i+j] != substrLower[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

// TestParseErrorPriority tests error parsing priority when multiple patterns match
func TestParseErrorPriority(t *testing.T) {
	// "not found" appears before "timeout" in the switch, so it should match first
	output := "Element not found after timeout"
	result := ParseError(output)
	if result != ErrElementNotFound {
		t.Errorf("expected ErrElementNotFound for %q, got %v", output, result)
	}
}

// BenchmarkParseError benchmarks error parsing
func BenchmarkParseError(b *testing.B) {
	outputs := []string{
		"element not found",
		"element is not visible",
		"operation timed out",
		"navigation failed",
		"some random error",
		"",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, output := range outputs {
			ParseError(output)
		}
	}
}

// BenchmarkCommandErrorFormat benchmarks error formatting
func BenchmarkCommandErrorFormat(b *testing.B) {
	cmdErr := &CommandError{
		Command: "click",
		Args:    []string{"@e1"},
		Output:  "element not found",
		Err:     ErrElementNotFound,
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = cmdErr.Error()
	}
}
