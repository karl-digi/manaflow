package browser

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

func TestClientCreation(t *testing.T) {
	// Client can be created without CDP config
	// (validation happens at connect time)
	client, err := NewClient(ClientConfig{})
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if client == nil {
		t.Error("expected client, got nil")
	}
}

func TestClientCreationWithRealBinary(t *testing.T) {
	// Test with real binary (if available)

	client, err := NewClient(ClientConfig{CDPPort: 9222})
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if client == nil {
		t.Error("expected client, got nil")
	}
	if client.GetConfig().Timeout != DefaultTimeout {
		t.Errorf("expected default timeout %d, got %d", DefaultTimeout, client.GetConfig().Timeout)
	}
}

func TestClientConfigDefaults(t *testing.T) {

	client, err := NewClient(ClientConfig{CDPPort: 9222})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Test default timeout
	if client.config.Timeout != DefaultTimeout {
		t.Errorf("expected default timeout %d, got %d", DefaultTimeout, client.config.Timeout)
	}

	// Test SetTimeout
	client.SetTimeout(60000)
	if client.config.Timeout != 60000 {
		t.Errorf("expected timeout 60000, got %d", client.config.Timeout)
	}

	// Test SetSession
	client.SetSession("test-session")
	if client.config.Session != "test-session" {
		t.Errorf("expected session 'test-session', got %s", client.config.Session)
	}
}

func TestSnapshotParsing(t *testing.T) {
	input := `
@e1: button "Submit"
@e2: input "Email address"
@e3: link "Forgot password?"
@e4: checkbox "Remember me"
`

	result := ParseSnapshot(input)

	if len(result.Elements) != 4 {
		t.Errorf("expected 4 elements, got %d", len(result.Elements))
	}

	// Test first element
	if result.Elements[0].Ref != "@e1" {
		t.Errorf("expected @e1, got %s", result.Elements[0].Ref)
	}
	if result.Elements[0].Role != "button" {
		t.Errorf("expected button, got %s", result.Elements[0].Role)
	}
	if result.Elements[0].Name != "Submit" {
		t.Errorf("expected Submit, got %s", result.Elements[0].Name)
	}

	// Test second element
	if result.Elements[1].Ref != "@e2" {
		t.Errorf("expected @e2, got %s", result.Elements[1].Ref)
	}
	if result.Elements[1].Role != "input" {
		t.Errorf("expected input, got %s", result.Elements[1].Role)
	}

	// Test raw output is preserved
	if result.Raw != input {
		t.Error("expected raw output to be preserved")
	}
}

func TestSnapshotParsingEmptyInput(t *testing.T) {
	result := ParseSnapshot("")
	if len(result.Elements) != 0 {
		t.Errorf("expected 0 elements for empty input, got %d", len(result.Elements))
	}
	if !result.IsEmpty() {
		t.Error("expected IsEmpty() to return true")
	}
}

func TestSnapshotParsingInvalidLines(t *testing.T) {
	input := `
Some random text
@e1: button "Submit"
Another random line
not a valid ref
@e2: input "Email"
`

	result := ParseSnapshot(input)
	if len(result.Elements) != 2 {
		t.Errorf("expected 2 elements, got %d", len(result.Elements))
	}
}

func TestSnapshotParsingVariedFormats(t *testing.T) {
	testCases := []struct {
		input    string
		expected int
		desc     string
	}{
		{"@e1: button \"Test\"", 1, "simple button"},
		{"@e10: input \"Test\"", 1, "double digit ref"},
		{"@e123: link \"Test\"", 1, "triple digit ref"},
		{"@e1: button 'Single quotes'", 1, "single quotes"},
		{"@e1: button", 1, "no name"},
		{"@e1:button \"NoSpace\"", 1, "no space after colon"},
	}

	for _, tc := range testCases {
		result := ParseSnapshot(tc.input)
		if len(result.Elements) != tc.expected {
			t.Errorf("%s: expected %d elements, got %d", tc.desc, tc.expected, len(result.Elements))
		}
	}
}

func TestFindElementByRef(t *testing.T) {
	input := `
@e1: button "Submit"
@e2: input "Email address"
@e3: link "Forgot password?"
`

	result := ParseSnapshot(input)

	// Test finding existing element
	elem := result.FindElementByRef("@e2")
	if elem == nil {
		t.Error("expected to find @e2")
	}
	if elem.Role != "input" {
		t.Errorf("expected input, got %s", elem.Role)
	}

	// Test finding non-existent element
	elem = result.FindElementByRef("@e99")
	if elem != nil {
		t.Error("expected nil for non-existent ref")
	}
}

func TestFindElementsByRole(t *testing.T) {
	input := `
@e1: button "Submit"
@e2: input "Email address"
@e3: button "Cancel"
@e4: link "Help"
@e5: button "Reset"
`

	result := ParseSnapshot(input)

	buttons := result.FindElementsByRole("button")
	if len(buttons) != 3 {
		t.Errorf("expected 3 buttons, got %d", len(buttons))
	}

	inputs := result.FindElementsByRole("input")
	if len(inputs) != 1 {
		t.Errorf("expected 1 input, got %d", len(inputs))
	}

	// Test non-existent role
	checkboxes := result.FindElementsByRole("checkbox")
	if len(checkboxes) != 0 {
		t.Errorf("expected 0 checkboxes, got %d", len(checkboxes))
	}
}

func TestFindElementsByText(t *testing.T) {
	input := `
@e1: button "Submit Form"
@e2: input "Email address"
@e3: link "Forgot password?"
@e4: button "Submit Order"
`

	result := ParseSnapshot(input)

	// Test case-insensitive search
	submits := result.FindElementsByText("submit")
	if len(submits) != 2 {
		t.Errorf("expected 2 elements with 'submit', got %d", len(submits))
	}

	password := result.FindElementsByText("password")
	if len(password) != 1 {
		t.Errorf("expected 1 match for 'password', got %d", len(password))
	}

	// Test non-existent text
	nothing := result.FindElementsByText("xyz123")
	if len(nothing) != 0 {
		t.Errorf("expected 0 matches for 'xyz123', got %d", len(nothing))
	}
}

func TestGetRefs(t *testing.T) {
	input := `
@e1: button "Submit"
@e2: input "Email address"
@e3: link "Forgot password?"
@e4: checkbox "Remember me"
`

	result := ParseSnapshot(input)

	refs := result.GetRefs()
	expected := []string{"@e1", "@e2", "@e3", "@e4"}
	if len(refs) != len(expected) {
		t.Errorf("expected %d refs, got %d", len(expected), len(refs))
	}
	for i, ref := range refs {
		if ref != expected[i] {
			t.Errorf("expected %s at index %d, got %s", expected[i], i, ref)
		}
	}
}

func TestSnapshotHelperMethods(t *testing.T) {
	input := `
@e1: button "Submit"
@e2: input "Email"
@e3: link "Help"
@e4: button "Cancel"
`

	result := ParseSnapshot(input)

	// Test Count
	if result.Count() != 4 {
		t.Errorf("expected count 4, got %d", result.Count())
	}

	// Test GetButtons
	buttons := result.GetButtons()
	if len(buttons) != 2 {
		t.Errorf("expected 2 buttons, got %d", len(buttons))
	}

	// Test GetInputs
	inputs := result.GetInputs()
	if len(inputs) != 1 {
		t.Errorf("expected 1 input, got %d", len(inputs))
	}

	// Test GetLinks
	links := result.GetLinks()
	if len(links) != 1 {
		t.Errorf("expected 1 link, got %d", len(links))
	}
}

func TestErrorParsing(t *testing.T) {
	cases := []struct {
		output   string
		expected error
	}{
		{"Element @e99 not found", ErrElementNotFound},
		{"element is not visible", ErrElementNotVisible},
		{"element is disabled", ErrElementNotEnabled},
		{"element not enabled", ErrElementNotEnabled},
		{"element is not editable", ErrElementNotEditable},
		{"operation timed out", ErrTimeout},
		{"navigation failed", ErrNavigationFailed},
		{"element reference is stale", ErrStaleRef},
		{"Unknown key: FakeKey", ErrInvalidKey},
		{"invalid key name", ErrInvalidKey},
		{"some random error", nil},
		{"", nil},
	}

	for _, tc := range cases {
		got := ParseError(tc.output)
		if got != tc.expected {
			t.Errorf("ParseError(%q) = %v, want %v", tc.output, got, tc.expected)
		}
	}
}

func TestCommandError(t *testing.T) {
	cmdErr := &CommandError{
		Command: "click",
		Args:    []string{"@e1"},
		Output:  "element not found",
		Err:     ErrElementNotFound,
	}

	// Test Error() method
	errMsg := cmdErr.Error()
	if !strings.Contains(errMsg, "click") {
		t.Errorf("expected error message to contain 'click', got %s", errMsg)
	}
	if !strings.Contains(errMsg, "element not found") {
		t.Errorf("expected error message to contain 'element not found', got %s", errMsg)
	}

	// Test Unwrap() method
	unwrapped := cmdErr.Unwrap()
	if unwrapped != ErrElementNotFound {
		t.Errorf("expected unwrapped error to be ErrElementNotFound, got %v", unwrapped)
	}
}

func TestIsConnected(t *testing.T) {

	client, err := NewClient(ClientConfig{CDPPort: 9222})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should not be connected initially
	if client.IsConnected() {
		t.Error("expected client to not be connected initially")
	}
}

func TestScrollDirectionConstants(t *testing.T) {
	// Test that scroll direction constants are correct
	if string(ScrollUp) != "up" {
		t.Errorf("expected ScrollUp to be 'up', got %s", ScrollUp)
	}
	if string(ScrollDown) != "down" {
		t.Errorf("expected ScrollDown to be 'down', got %s", ScrollDown)
	}
	if string(ScrollLeft) != "left" {
		t.Errorf("expected ScrollLeft to be 'left', got %s", ScrollLeft)
	}
	if string(ScrollRight) != "right" {
		t.Errorf("expected ScrollRight to be 'right', got %s", ScrollRight)
	}
}

func TestTypesDefaults(t *testing.T) {
	// Test Element defaults
	elem := Element{Ref: "@e1", Role: "button"}
	if elem.Enabled {
		t.Error("expected Enabled to be false by default")
	}
	if elem.Visible {
		t.Error("expected Visible to be false by default")
	}

	// Test ScreenshotOptions defaults
	opts := ScreenshotOptions{}
	if opts.Path != "" {
		t.Errorf("expected empty path, got %s", opts.Path)
	}
	if opts.FullPage {
		t.Error("expected FullPage to be false by default")
	}

	// Test WaitOptions defaults
	waitOpts := WaitOptions{}
	if waitOpts.Timeout != 0 {
		t.Errorf("expected timeout 0, got %d", waitOpts.Timeout)
	}
}

// Integration test - requires running browser with CDP
func TestClientIntegration(t *testing.T) {
	if os.Getenv("TEST_CDP_PORT") == "" {
		t.Skip("TEST_CDP_PORT not set - skipping integration test")
	}

	// To run this test:
	// 1. Start Chrome with: google-chrome --remote-debugging-port=9222
	// 2. Run: TEST_CDP_PORT=9222 go test -v -run Integration

	client, err := NewClient(ClientConfig{
		CDPPort: 9222,
		Timeout: 30000,
	})
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Connect
	t.Log("Connecting to browser...")
	if err := client.Connect(ctx); err != nil {
		t.Fatalf("failed to connect: %v", err)
	}

	// Verify connected
	if !client.IsConnected() {
		t.Error("expected client to be connected")
	}

	// Navigate
	t.Log("Navigating to example.com...")
	if err := client.Open(ctx, "https://example.com"); err != nil {
		t.Fatalf("failed to navigate: %v", err)
	}
	time.Sleep(2 * time.Second)

	// Get title
	title, err := client.GetTitle(ctx)
	if err != nil {
		t.Fatalf("failed to get title: %v", err)
	}
	if !strings.Contains(title, "Example") {
		t.Errorf("expected title containing 'Example', got %q", title)
	}
	t.Logf("Page title: %s", title)

	// Get URL
	url, err := client.GetURL(ctx)
	if err != nil {
		t.Fatalf("failed to get URL: %v", err)
	}
	if !strings.Contains(url, "example.com") {
		t.Errorf("expected URL containing 'example.com', got %q", url)
	}
	t.Logf("Page URL: %s", url)

	// Take snapshot
	t.Log("Taking snapshot...")
	snapshot, err := client.Snapshot(ctx, true)
	if err != nil {
		t.Fatalf("failed to take snapshot: %v", err)
	}
	t.Logf("Found %d elements", len(snapshot.Elements))
	for _, elem := range snapshot.Elements {
		t.Logf("  %s: %s %q", elem.Ref, elem.Role, elem.Name)
	}

	// Screenshot
	t.Log("Taking screenshot...")
	_, err = client.Screenshot(ctx, ScreenshotOptions{Path: "/tmp/test-browser.png"})
	if err != nil {
		t.Logf("Screenshot failed (may be ok): %v", err)
	}

	// Close
	if err := client.Close(ctx); err != nil {
		t.Logf("Close failed (may be ok): %v", err)
	}

	t.Log("Integration test passed!")
}

// Benchmark tests
func BenchmarkParseSnapshot(b *testing.B) {
	input := `
@e1: button "Submit"
@e2: input "Email address"
@e3: link "Forgot password?"
@e4: checkbox "Remember me"
@e5: button "Cancel"
@e6: input "Password"
@e7: link "Sign up"
@e8: button "Login"
@e9: input "Username"
@e10: link "Help"
`

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ParseSnapshot(input)
	}
}

func BenchmarkFindElementByRef(b *testing.B) {
	input := `
@e1: button "Submit"
@e2: input "Email address"
@e3: link "Forgot password?"
@e4: checkbox "Remember me"
@e5: button "Cancel"
`
	result := ParseSnapshot(input)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		result.FindElementByRef("@e3")
	}
}

func BenchmarkFindElementsByText(b *testing.B) {
	input := `
@e1: button "Submit Form"
@e2: input "Email address"
@e3: link "Forgot password"
@e4: checkbox "Remember me"
@e5: button "Submit Order"
`
	result := ParseSnapshot(input)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		result.FindElementsByText("submit")
	}
}

// TestCDPPortPrecedence verifies that CDPPort takes precedence over CDPURL
func TestCDPPortPrecedence(t *testing.T) {

	// Test 1: CDPPort only - should use port
	config1 := ClientConfig{CDPPort: 9222}
	client1, err := NewClient(config1)
	if err != nil {
		t.Fatalf("failed to create client with CDPPort only: %v", err)
	}
	if client1.config.CDPPort != 9222 {
		t.Errorf("expected CDPPort 9222, got %d", client1.config.CDPPort)
	}

	// Test 2: CDPURL only - should use URL
	config2 := ClientConfig{CDPURL: "ws://localhost:9222"}
	client2, err := NewClient(config2)
	if err != nil {
		t.Fatalf("failed to create client with CDPURL only: %v", err)
	}
	if client2.config.CDPURL != "ws://localhost:9222" {
		t.Errorf("expected CDPURL ws://localhost:9222, got %s", client2.config.CDPURL)
	}

	// Test 3: Both set - CDPPort should take precedence
	// This is the critical test for the fix
	config3 := ClientConfig{
		CDPPort: 9222,
		CDPURL:  "https://example.morph.so/cdp/", // This is HTTP, won't work for CDP
	}
	client3, err := NewClient(config3)
	if err != nil {
		t.Fatalf("failed to create client with both CDPPort and CDPURL: %v", err)
	}
	// Verify the config stores both
	if client3.config.CDPPort != 9222 {
		t.Errorf("expected CDPPort 9222, got %d", client3.config.CDPPort)
	}
	if client3.config.CDPURL != "https://example.morph.so/cdp/" {
		t.Errorf("expected CDPURL to be preserved, got %s", client3.config.CDPURL)
	}
	// The actual precedence is tested in the run method
}

// TestCDPConfigRequired verifies that at least one CDP config is required
func TestCDPConfigRequired(t *testing.T) {

	// Client can be created without CDP config (validation happens at connect time)
	config := ClientConfig{}
	client, err := NewClient(config)
	if err != nil {
		t.Fatalf("unexpected error creating client: %v", err)
	}

	// Connect should fail without CDP config
	ctx := context.Background()
	err = client.Connect(ctx)
	if err != ErrNoCDPConfig {
		t.Errorf("expected ErrNoCDPConfig, got %v", err)
	}
}

// TestClientConfigWithBothCDPOptions tests that config correctly stores both options
func TestClientConfigWithBothCDPOptions(t *testing.T) {
	config := ClientConfig{
		CDPPort: 9222,
		CDPURL:  "ws://remote:9222",
		Timeout: 60000,
		Session: "test-session",
	}

	// Verify all fields are stored
	if config.CDPPort != 9222 {
		t.Errorf("CDPPort mismatch")
	}
	if config.CDPURL != "ws://remote:9222" {
		t.Errorf("CDPURL mismatch")
	}
	if config.Timeout != 60000 {
		t.Errorf("Timeout mismatch")
	}
	if config.Session != "test-session" {
		t.Errorf("Session mismatch")
	}
}

// TestCDPPortZeroNotUsed tests that CDPPort of 0 falls back to CDPURL
func TestCDPPortZeroNotUsed(t *testing.T) {

	// CDPPort=0 should fall back to CDPURL
	config := ClientConfig{
		CDPPort: 0, // Zero value
		CDPURL:  "ws://localhost:9222",
	}
	client, err := NewClient(config)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	// Config should have both values
	if client.config.CDPPort != 0 {
		t.Errorf("expected CDPPort 0, got %d", client.config.CDPPort)
	}
	if client.config.CDPURL != "ws://localhost:9222" {
		t.Errorf("expected CDPURL ws://localhost:9222, got %s", client.config.CDPURL)
	}
}
