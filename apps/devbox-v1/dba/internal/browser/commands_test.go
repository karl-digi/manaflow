package browser

import (
	"context"
	"testing"
	"time"
)

// TestCommandArguments tests type definitions and constants
// Note: CDPClient methods require a real browser connection to test
func TestCommandArguments(t *testing.T) {
	t.Run("Scroll directions", func(t *testing.T) {
		// Test that scroll directions are valid strings
		directions := []struct {
			dir      ScrollDirection
			expected string
		}{
			{ScrollUp, "up"},
			{ScrollDown, "down"},
			{ScrollLeft, "left"},
			{ScrollRight, "right"},
		}
		for _, d := range directions {
			if string(d.dir) != d.expected {
				t.Errorf("expected %q, got %q", d.expected, d.dir)
			}
		}
	})

	t.Run("Screenshot options", func(t *testing.T) {
		opts := []ScreenshotOptions{
			{},
			{Path: "/tmp/test.png"},
			{FullPage: true},
			{Quality: 80},
			{Path: "/tmp/test.png", FullPage: true, Quality: 100},
		}
		// Verify options can be constructed
		for i, opt := range opts {
			if i == 1 && opt.Path != "/tmp/test.png" {
				t.Errorf("path mismatch")
			}
		}
	})

	t.Run("Wait options", func(t *testing.T) {
		opts := []WaitOptions{
			{},
			{Timeout: 5000},
			{State: "visible"},
			{Timeout: 5000, State: "hidden"},
		}
		// Verify options can be constructed
		if opts[1].Timeout != 5000 {
			t.Error("timeout mismatch")
		}
		if opts[2].State != "visible" {
			t.Error("state mismatch")
		}
	})

	t.Run("Click options", func(t *testing.T) {
		opts := []ClickOptions{
			{},
			{Button: "left"},
			{Button: "right"},
			{ClickCount: 2},
			{Delay: 100},
			{Button: "left", ClickCount: 2, Delay: 50},
		}
		// Verify options can be constructed
		if opts[1].Button != "left" {
			t.Error("button mismatch")
		}
		if opts[3].ClickCount != 2 {
			t.Error("click count mismatch")
		}
	})
}

// TestClientCreationVariousConfigs tests that NewClient can be created with various configs
func TestClientCreationVariousConfigs(t *testing.T) {
	configs := []ClientConfig{
		{CDPPort: 9222},
		{CDPURL: "ws://localhost:9222"},
		{CDPPort: 9222, Timeout: 60000},
		{CDPPort: 9222, Session: "test"},
	}

	for _, cfg := range configs {
		client, err := NewClient(cfg)
		if err != nil {
			t.Fatalf("failed to create client: %v", err)
		}
		if client == nil {
			t.Error("client should not be nil")
		}
	}
}

// TestClientMethods tests that all Client methods exist and have correct signatures
// Note: These tests verify method signatures only; actual execution requires a browser
func TestClientMethods(t *testing.T) {
	// Test that all methods exist on CDPClient
	// This is a compile-time check - if methods don't exist, this won't compile

	var _ interface {
		Connect(ctx context.Context) error
		Close(ctx context.Context) error
		IsConnected() bool
		GetConfig() ClientConfig
		SetTimeout(timeout int)
		SetSession(session string)
		Open(ctx context.Context, url string) error
		Back(ctx context.Context) error
		Forward(ctx context.Context) error
		Reload(ctx context.Context) error
		Click(ctx context.Context, selector string) error
		DoubleClick(ctx context.Context, selector string) error
		Hover(ctx context.Context, selector string) error
		Type(ctx context.Context, selector, text string) error
		Fill(ctx context.Context, selector, text string) error
		Clear(ctx context.Context, selector string) error
		Press(ctx context.Context, key string) error
		Scroll(ctx context.Context, direction ScrollDirection, amount int) error
		GetText(ctx context.Context, selector string) (string, error)
		GetValue(ctx context.Context, selector string) (string, error)
		GetAttribute(ctx context.Context, selector, attribute string) (string, error)
		GetTitle(ctx context.Context) (string, error)
		GetURL(ctx context.Context) (string, error)
		Screenshot(ctx context.Context, opts ScreenshotOptions) (string, error)
		Snapshot(ctx context.Context, interactive bool) (*SnapshotResult, error)
	} = (*CDPClient)(nil)
}

// TestContextTimeout tests that context cancellation is respected
func TestContextTimeout(t *testing.T) {
	client, err := NewClient(ClientConfig{CDPPort: 9222, Timeout: 100})
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	// Create context with very short timeout
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Millisecond)
	defer cancel()

	// Connect should fail due to timeout (no browser running)
	err = client.Connect(ctx)
	if err == nil {
		t.Error("expected error due to timeout or no browser")
		client.Close(context.Background())
	}
}

// TestClientSetters tests setter methods
func TestClientSetters(t *testing.T) {
	client, err := NewClient(ClientConfig{CDPPort: 9222})
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	// Test SetTimeout
	client.SetTimeout(60000)
	if client.config.Timeout != 60000 {
		t.Errorf("expected timeout 60000, got %d", client.config.Timeout)
	}

	// Test SetSession
	client.SetSession("my-session")
	if client.config.Session != "my-session" {
		t.Errorf("expected session 'my-session', got %s", client.config.Session)
	}

	// Test GetConfig
	config := client.GetConfig()
	if config.CDPPort != 9222 {
		t.Errorf("expected CDPPort 9222, got %d", config.CDPPort)
	}
	if config.Timeout != 60000 {
		t.Errorf("expected Timeout 60000, got %d", config.Timeout)
	}
	if config.Session != "my-session" {
		t.Errorf("expected Session 'my-session', got %s", config.Session)
	}
}

// TestConnectWithNoCDPConfig tests Connect with no CDP configuration
func TestConnectWithNoCDPConfig(t *testing.T) {
	// Create client with no CDP config
	client := &CDPClient{
		config: ClientConfig{Timeout: DefaultTimeout},
	}

	err := client.Connect(context.Background())
	if err != ErrNoCDPConfig {
		t.Errorf("expected ErrNoCDPConfig, got %v", err)
	}
}

// TestCloseWhenNotConnected tests Close when not connected
func TestCloseWhenNotConnected(t *testing.T) {
	client, err := NewClient(ClientConfig{CDPPort: 9222})
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	// Close when not connected should return nil
	err = client.Close(context.Background())
	if err != nil {
		t.Errorf("expected nil error when closing unconnected client, got %v", err)
	}
}

// TestScrollDirectionValidity tests scroll direction usage
func TestScrollDirectionValidity(t *testing.T) {
	// Test that all directions are valid strings
	directions := []struct {
		dir      ScrollDirection
		expected string
	}{
		{ScrollUp, "up"},
		{ScrollDown, "down"},
		{ScrollLeft, "left"},
		{ScrollRight, "right"},
	}

	for _, tc := range directions {
		if string(tc.dir) != tc.expected {
			t.Errorf("expected %q, got %q", tc.expected, tc.dir)
		}
	}
}

// TestIsConnectedInitially tests that client is not connected initially
func TestIsConnectedInitially(t *testing.T) {
	client, err := NewClient(ClientConfig{CDPPort: 9222})
	if err != nil {
		t.Fatalf("failed to create client: %v", err)
	}

	if client.IsConnected() {
		t.Error("client should not be connected initially")
	}
}

// BenchmarkClientCreation benchmarks client creation
func BenchmarkClientCreation(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = NewClient(ClientConfig{CDPPort: 9222})
	}
}
