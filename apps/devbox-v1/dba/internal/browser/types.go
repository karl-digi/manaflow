// Package browser provides a Go wrapper around the agent-browser CLI
// for browser automation via Chrome DevTools Protocol (CDP).
package browser

// Element represents an interactive element from a snapshot
type Element struct {
	Ref         string `json:"ref"`         // @e1, @e2, etc.
	Role        string `json:"role"`        // button, input, link, etc.
	Name        string `json:"name"`        // Accessible name
	Description string `json:"description"` // Additional description
	Enabled     bool   `json:"enabled"`
	Visible     bool   `json:"visible"`
}

// SnapshotResult contains parsed snapshot data
type SnapshotResult struct {
	Elements []Element `json:"elements"`
	Raw      string    `json:"raw"`   // Original output
	URL      string    `json:"url"`   // Current page URL
	Title    string    `json:"title"` // Page title
}

// ClickOptions configures click behavior
type ClickOptions struct {
	Button     string // "left", "right", "middle"
	ClickCount int    // 1 for single, 2 for double
	Delay      int    // ms between mousedown/mouseup
}

// TypeOptions configures typing behavior
type TypeOptions struct {
	Delay int // ms between keystrokes
}

// ScreenshotOptions configures screenshot capture
type ScreenshotOptions struct {
	Path     string // Output file path
	FullPage bool   // Capture full scrollable page
	Quality  int    // JPEG quality (0-100)
}

// WaitOptions configures wait behavior
type WaitOptions struct {
	Timeout int    // ms to wait before failing
	State   string // "visible", "hidden", "attached", "detached"
}

// ScrollDirection represents scroll direction
type ScrollDirection string

const (
	ScrollUp    ScrollDirection = "up"
	ScrollDown  ScrollDirection = "down"
	ScrollLeft  ScrollDirection = "left"
	ScrollRight ScrollDirection = "right"
)

// ClientConfig holds client configuration
type ClientConfig struct {
	CDPPort    int    // Local CDP port (e.g., 9222)
	CDPURL     string // Full CDP WebSocket URL (overrides CDPPort)
	Session    string // Session name for isolation
	Timeout    int    // Default timeout in ms
	BinaryPath string // Path to agent-browser binary
}
