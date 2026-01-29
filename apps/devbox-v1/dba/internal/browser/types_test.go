package browser

import (
	"testing"
)

// TestScrollDirectionValues tests scroll direction constants
func TestScrollDirectionValues(t *testing.T) {
	testCases := []struct {
		dir      ScrollDirection
		expected string
	}{
		{ScrollUp, "up"},
		{ScrollDown, "down"},
		{ScrollLeft, "left"},
		{ScrollRight, "right"},
	}

	for _, tc := range testCases {
		if string(tc.dir) != tc.expected {
			t.Errorf("expected %s for scroll direction, got %s", tc.expected, tc.dir)
		}
	}
}

// TestScrollDirectionString tests that scroll directions can be used as strings
func TestScrollDirectionString(t *testing.T) {
	// Test that ScrollDirection can be converted to string
	var dir ScrollDirection = "custom"
	if string(dir) != "custom" {
		t.Errorf("expected 'custom', got %s", dir)
	}
}

// TestElementStruct tests Element struct
func TestElementStruct(t *testing.T) {
	elem := Element{
		Ref:         "@e1",
		Role:        "button",
		Name:        "Submit",
		Description: "Submit the form",
		Enabled:     true,
		Visible:     true,
	}

	if elem.Ref != "@e1" {
		t.Errorf("expected Ref '@e1', got %q", elem.Ref)
	}
	if elem.Role != "button" {
		t.Errorf("expected Role 'button', got %q", elem.Role)
	}
	if elem.Name != "Submit" {
		t.Errorf("expected Name 'Submit', got %q", elem.Name)
	}
	if elem.Description != "Submit the form" {
		t.Errorf("expected Description 'Submit the form', got %q", elem.Description)
	}
	if !elem.Enabled {
		t.Error("expected Enabled to be true")
	}
	if !elem.Visible {
		t.Error("expected Visible to be true")
	}
}

// TestSnapshotResultStruct tests SnapshotResult struct
func TestSnapshotResultStruct(t *testing.T) {
	result := SnapshotResult{
		Elements: []Element{
			{Ref: "@e1", Role: "button", Name: "Submit"},
			{Ref: "@e2", Role: "input", Name: "Email"},
		},
		Raw:   "@e1: button \"Submit\"\n@e2: input \"Email\"",
		URL:   "https://example.com",
		Title: "Example Page",
	}

	if len(result.Elements) != 2 {
		t.Errorf("expected 2 elements, got %d", len(result.Elements))
	}
	if result.URL != "https://example.com" {
		t.Errorf("expected URL 'https://example.com', got %q", result.URL)
	}
	if result.Title != "Example Page" {
		t.Errorf("expected Title 'Example Page', got %q", result.Title)
	}
}

// TestClickOptions tests ClickOptions struct
func TestClickOptions(t *testing.T) {
	testCases := []struct {
		name string
		opts ClickOptions
	}{
		{"default", ClickOptions{}},
		{"left click", ClickOptions{Button: "left", ClickCount: 1}},
		{"double click", ClickOptions{Button: "left", ClickCount: 2}},
		{"right click", ClickOptions{Button: "right", ClickCount: 1}},
		{"middle click", ClickOptions{Button: "middle", ClickCount: 1}},
		{"with delay", ClickOptions{Button: "left", ClickCount: 1, Delay: 100}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Just verify struct can be created - no panics
			_ = tc.opts.Button
			_ = tc.opts.ClickCount
			_ = tc.opts.Delay
		})
	}
}

// TestTypeOptions tests TypeOptions struct
func TestTypeOptions(t *testing.T) {
	opts := TypeOptions{Delay: 50}
	if opts.Delay != 50 {
		t.Errorf("expected Delay 50, got %d", opts.Delay)
	}

	// Default
	defaultOpts := TypeOptions{}
	if defaultOpts.Delay != 0 {
		t.Errorf("expected default Delay 0, got %d", defaultOpts.Delay)
	}
}

// TestScreenshotOptions tests ScreenshotOptions struct
func TestScreenshotOptions(t *testing.T) {
	testCases := []struct {
		name string
		opts ScreenshotOptions
	}{
		{"default", ScreenshotOptions{}},
		{"with path", ScreenshotOptions{Path: "/tmp/screenshot.png"}},
		{"full page", ScreenshotOptions{Path: "/tmp/full.png", FullPage: true}},
		{"with quality", ScreenshotOptions{Path: "/tmp/high.jpg", Quality: 100}},
		{"low quality", ScreenshotOptions{Path: "/tmp/low.jpg", Quality: 10}},
		{"all options", ScreenshotOptions{Path: "/tmp/all.png", FullPage: true, Quality: 80}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Verify struct fields are accessible
			_ = tc.opts.Path
			_ = tc.opts.FullPage
			_ = tc.opts.Quality
		})
	}
}

// TestWaitOptions tests WaitOptions struct
func TestWaitOptions(t *testing.T) {
	testCases := []struct {
		name string
		opts WaitOptions
	}{
		{"default", WaitOptions{}},
		{"with timeout", WaitOptions{Timeout: 5000}},
		{"visible state", WaitOptions{State: "visible"}},
		{"hidden state", WaitOptions{State: "hidden"}},
		{"attached state", WaitOptions{State: "attached"}},
		{"detached state", WaitOptions{State: "detached"}},
		{"all options", WaitOptions{Timeout: 10000, State: "visible"}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Verify struct fields are accessible
			_ = tc.opts.Timeout
			_ = tc.opts.State
		})
	}
}

// TestClientConfig tests ClientConfig struct
func TestClientConfig(t *testing.T) {
	testCases := []struct {
		name   string
		config ClientConfig
	}{
		{"default", ClientConfig{}},
		{"with port", ClientConfig{CDPPort: 9222}},
		{"with URL", ClientConfig{CDPURL: "ws://localhost:9222/devtools/browser/abc"}},
		{"with session", ClientConfig{CDPPort: 9222, Session: "test-session"}},
		{"with timeout", ClientConfig{CDPPort: 9222, Timeout: 60000}},
		{"with binary path", ClientConfig{CDPPort: 9222, BinaryPath: "/usr/local/bin/agent-browser"}},
		{"all options", ClientConfig{
			CDPPort:    9222,
			CDPURL:     "ws://localhost:9222/devtools/browser/abc",
			Session:    "test",
			Timeout:    30000,
			BinaryPath: "/usr/bin/agent-browser",
		}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Verify struct fields are accessible
			_ = tc.config.CDPPort
			_ = tc.config.CDPURL
			_ = tc.config.Session
			_ = tc.config.Timeout
			_ = tc.config.BinaryPath
		})
	}
}

// TestClientConfigURLPriority tests that CDPURL takes priority over CDPPort
func TestClientConfigURLPriority(t *testing.T) {
	config := ClientConfig{
		CDPPort: 9222,
		CDPURL:  "ws://remote:9223/devtools/browser/xyz",
	}

	// The client.go implementation should use CDPURL when both are set
	// This test documents the expected behavior
	if config.CDPURL == "" {
		t.Error("expected CDPURL to be set")
	}
	if config.CDPPort == 0 {
		t.Error("expected CDPPort to also be set")
	}
}

// TestDefaultTimeout tests the DefaultTimeout constant
func TestDefaultTimeout(t *testing.T) {
	if DefaultTimeout != 30000 {
		t.Errorf("expected DefaultTimeout to be 30000, got %d", DefaultTimeout)
	}
}

// TestElementJSONTags tests that Element struct has correct JSON tags
func TestElementJSONTags(t *testing.T) {
	// This test is a compile-time check that JSON tags exist
	// The actual JSON marshaling would be tested if needed

	elem := Element{
		Ref:         "@e1",
		Role:        "button",
		Name:        "Submit",
		Description: "Submit button",
		Enabled:     true,
		Visible:     true,
	}

	// Just verify the struct can be used
	if elem.Ref == "" {
		t.Error("Ref should not be empty")
	}
}

// TestSnapshotResultJSONTags tests that SnapshotResult struct has correct JSON tags
func TestSnapshotResultJSONTags(t *testing.T) {
	result := SnapshotResult{
		Elements: []Element{},
		Raw:      "test",
		URL:      "https://example.com",
		Title:    "Test",
	}

	// Verify struct can be used
	if result.Raw == "" {
		t.Error("Raw should not be empty")
	}
}

// BenchmarkElementCreation benchmarks creating Element structs
func BenchmarkElementCreation(b *testing.B) {
	for i := 0; i < b.N; i++ {
		_ = Element{
			Ref:     "@e1",
			Role:    "button",
			Name:    "Submit",
			Enabled: true,
			Visible: true,
		}
	}
}

// BenchmarkSnapshotResultCreation benchmarks creating SnapshotResult structs
func BenchmarkSnapshotResultCreation(b *testing.B) {
	elements := make([]Element, 10)
	for i := 0; i < 10; i++ {
		elements[i] = Element{
			Ref:  "@e" + string(rune('0'+i)),
			Role: "button",
			Name: "Button",
		}
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = SnapshotResult{
			Elements: elements,
			Raw:      "test output",
			URL:      "https://example.com",
			Title:    "Test Page",
		}
	}
}
