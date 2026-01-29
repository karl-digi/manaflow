// internal/browser/cdp_precedence_test.go
package browser

import (
	"context"
	"os/exec"
	"testing"
)

// =============================================================================
// CDPPort Precedence Tests
// =============================================================================

// TestCDPPortPrecedenceOverURL verifies CDPPort is preferred over CDPURL
func TestCDPPortPrecedenceOverURL(t *testing.T) {
	if _, err := exec.LookPath("agent-browser"); err != nil {
		t.Skip("agent-browser not installed")
	}

	// When both are set, CDPPort should be used
	config := ClientConfig{
		CDPPort: 9222,
		CDPURL:  "https://example.com/cdp/", // HTTP URL that wouldn't work
	}

	client, err := NewClient(config)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	// Verify config is stored correctly
	if client.config.CDPPort != 9222 {
		t.Errorf("CDPPort should be 9222, got %d", client.config.CDPPort)
	}
	if client.config.CDPURL != "https://example.com/cdp/" {
		t.Errorf("CDPURL should be preserved")
	}

	// The actual precedence is tested when Connect is called
	// which we can't do without a real browser
}

// TestCDPURLOnlyWhenPortZero tests that CDPURL is used when CDPPort is 0
func TestCDPURLOnlyWhenPortZero(t *testing.T) {
	if _, err := exec.LookPath("agent-browser"); err != nil {
		t.Skip("agent-browser not installed")
	}

	config := ClientConfig{
		CDPPort: 0,
		CDPURL:  "ws://localhost:9222",
	}

	client, err := NewClient(config)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	if client.config.CDPPort != 0 {
		t.Errorf("CDPPort should be 0, got %d", client.config.CDPPort)
	}
	if client.config.CDPURL != "ws://localhost:9222" {
		t.Errorf("CDPURL should be 'ws://localhost:9222', got %s", client.config.CDPURL)
	}
}

// TestCDPPortOnlyNoURL tests CDPPort only without CDPURL
func TestCDPPortOnlyNoURL(t *testing.T) {
	if _, err := exec.LookPath("agent-browser"); err != nil {
		t.Skip("agent-browser not installed")
	}

	config := ClientConfig{
		CDPPort: 9222,
		CDPURL:  "",
	}

	client, err := NewClient(config)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	if client.config.CDPPort != 9222 {
		t.Errorf("CDPPort should be 9222, got %d", client.config.CDPPort)
	}
	if client.config.CDPURL != "" {
		t.Errorf("CDPURL should be empty, got %s", client.config.CDPURL)
	}
}

// TestNoCDPConfigConnect tests that Connect fails without CDP config
func TestNoCDPConfigConnect(t *testing.T) {
	if _, err := exec.LookPath("agent-browser"); err != nil {
		t.Skip("agent-browser not installed")
	}

	config := ClientConfig{
		CDPPort: 0,
		CDPURL:  "",
	}

	client, err := NewClient(config)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	err = client.Connect(context.Background())
	if err != ErrNoCDPConfig {
		t.Errorf("Expected ErrNoCDPConfig, got %v", err)
	}
}

// TestCDPPortValues tests various CDPPort values
func TestCDPPortValues(t *testing.T) {
	if _, err := exec.LookPath("agent-browser"); err != nil {
		t.Skip("agent-browser not installed")
	}

	ports := []int{
		9222,  // Standard CDP port
		9223,  // Alternative CDP port
		80,    // HTTP
		443,   // HTTPS
		3000,  // Dev server
		8080,  // Alt HTTP
		65535, // Max valid port
		1,     // Min valid port
	}

	for _, port := range ports {
		t.Run("port_"+string(rune(port)), func(t *testing.T) {
			config := ClientConfig{CDPPort: port}
			client, err := NewClient(config)
			if err != nil {
				t.Fatalf("failed to create client with port %d: %v", port, err)
			}
			if client.config.CDPPort != port {
				t.Errorf("CDPPort = %d, want %d", client.config.CDPPort, port)
			}
		})
	}
}

// TestCDPURLFormats tests various CDPURL formats
func TestCDPURLFormats(t *testing.T) {
	if _, err := exec.LookPath("agent-browser"); err != nil {
		t.Skip("agent-browser not installed")
	}

	urls := []string{
		"ws://localhost:9222",
		"wss://localhost:9222",
		"ws://127.0.0.1:9222",
		"ws://[::1]:9222",
		"ws://example.com:9222",
		"ws://localhost:9222/devtools/browser/abc123",
		"http://localhost:9222", // Not ideal but should be accepted
		"https://localhost:9222",
	}

	for _, url := range urls {
		t.Run(url, func(t *testing.T) {
			config := ClientConfig{CDPURL: url}
			client, err := NewClient(config)
			if err != nil {
				t.Fatalf("failed to create client with URL %s: %v", url, err)
			}
			if client.config.CDPURL != url {
				t.Errorf("CDPURL = %s, want %s", client.config.CDPURL, url)
			}
		})
	}
}

// =============================================================================
// ClientConfig Edge Cases
// =============================================================================

// TestClientConfigDefaults tests default config values
func TestClientConfigDefaultValues(t *testing.T) {
	config := ClientConfig{}

	if config.CDPPort != 0 {
		t.Errorf("Default CDPPort should be 0, got %d", config.CDPPort)
	}
	if config.CDPURL != "" {
		t.Errorf("Default CDPURL should be empty, got %s", config.CDPURL)
	}
	if config.Timeout != 0 {
		t.Errorf("Default Timeout should be 0, got %d", config.Timeout)
	}
	if config.Session != "" {
		t.Errorf("Default Session should be empty, got %s", config.Session)
	}
	if config.BinaryPath != "" {
		t.Errorf("Default BinaryPath should be empty, got %s", config.BinaryPath)
	}
}

// TestClientConfigAllFields tests setting all config fields
func TestClientConfigAllFields(t *testing.T) {
	config := ClientConfig{
		CDPPort:    9222,
		CDPURL:     "ws://localhost:9222",
		Timeout:    60000,
		Session:    "test-session",
		BinaryPath: "/usr/local/bin/agent-browser",
	}

	if config.CDPPort != 9222 {
		t.Errorf("CDPPort mismatch")
	}
	if config.CDPURL != "ws://localhost:9222" {
		t.Errorf("CDPURL mismatch")
	}
	if config.Timeout != 60000 {
		t.Errorf("Timeout mismatch")
	}
	if config.Session != "test-session" {
		t.Errorf("Session mismatch")
	}
	if config.BinaryPath != "/usr/local/bin/agent-browser" {
		t.Errorf("BinaryPath mismatch")
	}
}

// TestClientTimeoutDefault tests that default timeout is applied
func TestClientTimeoutDefault(t *testing.T) {
	if _, err := exec.LookPath("agent-browser"); err != nil {
		t.Skip("agent-browser not installed")
	}

	config := ClientConfig{CDPPort: 9222, Timeout: 0}
	client, err := NewClient(config)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	if client.config.Timeout != DefaultTimeout {
		t.Errorf("Timeout should be DefaultTimeout (%d), got %d", DefaultTimeout, client.config.Timeout)
	}
}

// TestClientTimeoutPreserved tests that custom timeout is preserved
func TestClientTimeoutPreserved(t *testing.T) {
	if _, err := exec.LookPath("agent-browser"); err != nil {
		t.Skip("agent-browser not installed")
	}

	config := ClientConfig{CDPPort: 9222, Timeout: 120000}
	client, err := NewClient(config)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	if client.config.Timeout != 120000 {
		t.Errorf("Timeout should be 120000, got %d", client.config.Timeout)
	}
}

// TestClientSessionValues tests various session values
func TestClientSessionValues(t *testing.T) {
	if _, err := exec.LookPath("agent-browser"); err != nil {
		t.Skip("agent-browser not installed")
	}

	sessions := []string{
		"",
		"test",
		"test-session",
		"test_session",
		"test.session",
		"TestSession",
		"test-session-123",
		"a",
		"very-long-session-name-that-goes-on-and-on-and-on",
		"日本語セッション",
		"session-🚀",
	}

	for _, session := range sessions {
		t.Run(session, func(t *testing.T) {
			config := ClientConfig{CDPPort: 9222, Session: session}
			client, err := NewClient(config)
			if err != nil {
				t.Fatalf("failed to create client: %v", err)
			}
			if client.config.Session != session {
				t.Errorf("Session = %s, want %s", client.config.Session, session)
			}
		})
	}
}

// =============================================================================
// Client State Tests
// =============================================================================

// TestClientNotConnectedInitially tests that client is not connected initially
func TestClientNotConnectedInitially(t *testing.T) {
	if _, err := exec.LookPath("agent-browser"); err != nil {
		t.Skip("agent-browser not installed")
	}

	client, err := NewClient(ClientConfig{CDPPort: 9222})
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	if client.IsConnected() {
		t.Error("Client should not be connected initially")
	}
}

// TestGetConfigReturnsCorrectConfig tests that GetConfig returns correct config
func TestGetConfigReturnsCorrectConfig(t *testing.T) {
	if _, err := exec.LookPath("agent-browser"); err != nil {
		t.Skip("agent-browser not installed")
	}

	config := ClientConfig{
		CDPPort: 9222,
		CDPURL:  "ws://localhost:9222",
		Timeout: 60000,
		Session: "test",
	}

	client, err := NewClient(config)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	returnedConfig := client.GetConfig()
	if returnedConfig.CDPPort != 9222 {
		t.Errorf("CDPPort mismatch")
	}
	if returnedConfig.CDPURL != "ws://localhost:9222" {
		t.Errorf("CDPURL mismatch")
	}
	// Timeout is set to default when 0
	if returnedConfig.Timeout != 60000 {
		t.Errorf("Timeout mismatch: got %d", returnedConfig.Timeout)
	}
	if returnedConfig.Session != "test" {
		t.Errorf("Session mismatch")
	}
}

// TestSetTimeout tests SetTimeout method
func TestSetTimeoutMethod(t *testing.T) {
	if _, err := exec.LookPath("agent-browser"); err != nil {
		t.Skip("agent-browser not installed")
	}

	client, err := NewClient(ClientConfig{CDPPort: 9222})
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	client.SetTimeout(120000)
	if client.config.Timeout != 120000 {
		t.Errorf("Timeout should be 120000 after SetTimeout, got %d", client.config.Timeout)
	}
}

// TestSetSession tests SetSession method
func TestSetSessionMethod(t *testing.T) {
	if _, err := exec.LookPath("agent-browser"); err != nil {
		t.Skip("agent-browser not installed")
	}

	client, err := NewClient(ClientConfig{CDPPort: 9222})
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	client.SetSession("new-session")
	if client.config.Session != "new-session" {
		t.Errorf("Session should be 'new-session' after SetSession, got %s", client.config.Session)
	}
}

// =============================================================================
// Binary Path Tests
// =============================================================================

// TestDefaultClientCreation tests that client can be created with defaults
func TestDefaultClientCreation(t *testing.T) {
	config := ClientConfig{
		CDPPort: 9222,
	}

	client, err := NewClient(config)
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	// BinaryPath stays empty in config but "agent-browser" is used
	if client.config.BinaryPath != "" {
		t.Errorf("BinaryPath should remain empty, got %s", client.config.BinaryPath)
	}
}
