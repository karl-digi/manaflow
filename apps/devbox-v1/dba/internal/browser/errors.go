package browser

import (
	"errors"
	"fmt"
	"strings"
)

var (
	// ErrNotConnected is returned when not connected to browser
	ErrNotConnected = errors.New("not connected to browser")

	// ErrElementNotFound is returned when element selector doesn't match
	ErrElementNotFound = errors.New("element not found")

	// ErrElementNotVisible is returned when element exists but isn't visible
	ErrElementNotVisible = errors.New("element is not visible")

	// ErrElementNotEnabled is returned when element is disabled
	ErrElementNotEnabled = errors.New("element is not enabled")

	// ErrElementNotEditable is returned when trying to type in non-input
	ErrElementNotEditable = errors.New("element is not editable")

	// ErrNavigationFailed is returned when navigation fails
	ErrNavigationFailed = errors.New("navigation failed")

	// ErrTimeout is returned when operation times out
	ErrTimeout = errors.New("operation timed out")


	// ErrCDPConnectionFailed is returned when CDP connection fails
	ErrCDPConnectionFailed = errors.New("failed to connect to CDP")

	// ErrStaleRef is returned when element ref is no longer valid
	ErrStaleRef = errors.New("element ref is stale - page may have changed")

	// ErrInvalidKey is returned when an unknown key is pressed
	ErrInvalidKey = errors.New("invalid key name")

	// ErrNoCDPConfig is returned when no CDP port or URL is configured
	ErrNoCDPConfig = errors.New("no CDP port or URL configured")
)

// CommandError represents an error from agent-browser command
type CommandError struct {
	Command string
	Args    []string
	Output  string
	Err     error
}

func (e *CommandError) Error() string {
	return fmt.Sprintf("agent-browser %s failed: %v\nOutput: %s", e.Command, e.Err, e.Output)
}

func (e *CommandError) Unwrap() error {
	return e.Err
}

// ParseError extracts specific error type from command output
func ParseError(output string) error {
	lower := strings.ToLower(output)

	switch {
	case strings.Contains(lower, "not found"):
		return ErrElementNotFound
	case strings.Contains(lower, "not visible"):
		return ErrElementNotVisible
	case strings.Contains(lower, "not enabled") || strings.Contains(lower, "disabled"):
		return ErrElementNotEnabled
	case strings.Contains(lower, "not editable"):
		return ErrElementNotEditable
	case strings.Contains(lower, "timeout") || strings.Contains(lower, "timed out"):
		return ErrTimeout
	case strings.Contains(lower, "navigation"):
		return ErrNavigationFailed
	case strings.Contains(lower, "stale"):
		return ErrStaleRef
	case strings.Contains(lower, "unknown key") || strings.Contains(lower, "invalid key"):
		return ErrInvalidKey
	default:
		return nil
	}
}
