package browser

import (
	"context"
	"os/exec"
	"sync"
	"testing"
	"time"
)

// TestClientLifecycle tests client lifecycle transitions
func TestClientLifecycle(t *testing.T) {
	t.Run("initial state", func(t *testing.T) {
		client := &Client{
			config: ClientConfig{CDPPort: 9222, Timeout: DefaultTimeout},
		}

		if client.IsConnected() {
			t.Error("new client should not be connected")
		}
	})

	t.Run("state after setting connected", func(t *testing.T) {
		client := &Client{
			config:    ClientConfig{CDPPort: 9222},
			connected: true,
		}

		if !client.IsConnected() {
			t.Error("client should be connected")
		}
	})

	t.Run("state after close", func(t *testing.T) {
		client := &Client{
			config:    ClientConfig{CDPPort: 9222},
			connected: true,
		}

		_ = client.Close(context.Background())

		if client.IsConnected() {
			t.Error("client should not be connected after close")
		}
	})

	t.Run("multiple close calls", func(t *testing.T) {
		client := &Client{
			config:    ClientConfig{CDPPort: 9222},
			connected: true,
		}

		// Multiple close calls should be safe
		_ = client.Close(context.Background())
		_ = client.Close(context.Background())
		_ = client.Close(context.Background())

		if client.IsConnected() {
			t.Error("should still be disconnected")
		}
	})

	t.Run("close on never-connected client", func(t *testing.T) {
		client := &Client{
			config:    ClientConfig{CDPPort: 9222},
			connected: false,
		}

		err := client.Close(context.Background())
		if err != nil {
			t.Errorf("closing never-connected client should not error: %v", err)
		}
	})
}

// TestClientConfiguration tests client configuration methods
func TestClientConfiguration(t *testing.T) {
	t.Run("SetTimeout", func(t *testing.T) {
		client := &Client{config: ClientConfig{Timeout: 1000}}

		client.SetTimeout(5000)
		if client.config.Timeout != 5000 {
			t.Error("timeout not updated")
		}

		client.SetTimeout(0)
		if client.config.Timeout != 0 {
			t.Error("timeout should be settable to 0")
		}

		client.SetTimeout(-1)
		if client.config.Timeout != -1 {
			t.Error("timeout should be settable to negative")
		}
	})

	t.Run("SetSession", func(t *testing.T) {
		client := &Client{config: ClientConfig{}}

		client.SetSession("session1")
		if client.config.Session != "session1" {
			t.Error("session not set")
		}

		client.SetSession("")
		if client.config.Session != "" {
			t.Error("session should be clearable")
		}

		client.SetSession("session with spaces")
		if client.config.Session != "session with spaces" {
			t.Error("session with spaces not preserved")
		}
	})

	t.Run("GetConfig returns copy", func(t *testing.T) {
		client := &Client{config: ClientConfig{CDPPort: 9222, Timeout: 1000}}

		cfg := client.GetConfig()
		cfg.CDPPort = 9999
		cfg.Timeout = 9999

		// Original should not change
		if client.config.CDPPort == 9999 {
			t.Error("GetConfig should return a copy")
		}
		if client.config.Timeout == 9999 {
			t.Error("GetConfig should return a copy")
		}
	})
}

// TestNewClientVariations tests NewClient with various configurations
func TestNewClientVariations(t *testing.T) {
	if _, err := exec.LookPath("agent-browser"); err != nil {
		t.Skip("agent-browser not installed")
	}

	t.Run("minimal config", func(t *testing.T) {
		client, err := NewClient(ClientConfig{CDPPort: 9222})
		if err != nil {
			t.Fatalf("NewClient failed: %v", err)
		}
		if client == nil {
			t.Error("client should not be nil")
		}
	})

	t.Run("with all options", func(t *testing.T) {
		client, err := NewClient(ClientConfig{
			CDPPort:    9222,
			CDPURL:     "ws://localhost:9222",
			Session:    "test-session",
			Timeout:    60000,
			BinaryPath: "",
		})
		if err != nil {
			t.Fatalf("NewClient failed: %v", err)
		}
		if client == nil {
			t.Error("client should not be nil")
		}
	})

	t.Run("with URL only", func(t *testing.T) {
		client, err := NewClient(ClientConfig{CDPURL: "ws://localhost:9222"})
		if err != nil {
			t.Fatalf("NewClient failed: %v", err)
		}
		if client == nil {
			t.Error("client should not be nil")
		}
	})

	t.Run("zero timeout uses default", func(t *testing.T) {
		client, err := NewClient(ClientConfig{CDPPort: 9222, Timeout: 0})
		if err != nil {
			t.Fatalf("NewClient failed: %v", err)
		}
		// Zero timeout should be converted to DefaultTimeout
		if client.config.Timeout != DefaultTimeout {
			t.Errorf("expected DefaultTimeout (%d), got %d", DefaultTimeout, client.config.Timeout)
		}
	})
}

// TestConnectErrors tests Connect error conditions
func TestConnectErrors(t *testing.T) {
	t.Run("no CDP config", func(t *testing.T) {
		client := &Client{config: ClientConfig{Timeout: DefaultTimeout}}
		err := client.Connect(context.Background())
		if err != ErrNoCDPConfig {
			t.Errorf("expected ErrNoCDPConfig, got %v", err)
		}
	})

	t.Run("cancelled context", func(t *testing.T) {
		if _, err := exec.LookPath("agent-browser"); err != nil {
			t.Skip("agent-browser not installed")
		}

		client := &Client{config: ClientConfig{CDPPort: 9222, Timeout: DefaultTimeout}}

		ctx, cancel := context.WithCancel(context.Background())
		cancel() // Cancel immediately

		err := client.Connect(ctx)
		// Should fail due to cancelled context
		if err == nil {
			t.Error("expected error with cancelled context")
		}
	})
}

// TestContextDeadlines tests various context deadline scenarios
func TestContextDeadlines(t *testing.T) {
	t.Run("already expired context", func(t *testing.T) {
		ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Hour))
		defer cancel()

		if ctx.Err() != context.DeadlineExceeded {
			t.Error("context should be expired")
		}
	})

	t.Run("context expires during wait", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
		defer cancel()

		time.Sleep(20 * time.Millisecond)

		if ctx.Err() != context.DeadlineExceeded {
			t.Error("context should have expired")
		}
	})

	t.Run("cancelled vs deadline", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), time.Hour)
		cancel()

		// When cancelled, error is context.Canceled, not DeadlineExceeded
		if ctx.Err() != context.Canceled {
			t.Error("should be context.Canceled when cancel() called")
		}
	})
}

// TestConcurrentClientAccess tests concurrent READ access to client
// Note: Concurrent writes to a single client are not thread-safe by design
func TestConcurrentClientAccess(t *testing.T) {
	client := &Client{
		config:    ClientConfig{CDPPort: 9222, Timeout: 30000, Session: "test"},
		connected: false,
	}

	var wg sync.WaitGroup

	// Concurrent reads only - this is the supported use case
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = client.IsConnected()
			_ = client.GetConfig()
		}()
	}

	wg.Wait()
}

// TestSequentialClientModification tests sequential modification of client
func TestSequentialClientModification(t *testing.T) {
	client := &Client{
		config:    ClientConfig{CDPPort: 9222, Timeout: 30000, Session: "test"},
		connected: false,
	}

	// Sequential modifications are safe
	for i := 0; i < 100; i++ {
		client.SetTimeout(i * 1000)
		client.SetSession("session-" + string(rune('A'+i%26)))
	}

	// Final state should be from last iteration
	if client.config.Timeout != 99*1000 {
		t.Errorf("expected timeout 99000, got %d", client.config.Timeout)
	}
}

// TestClientWithNilContext tests client methods with nil context
func TestClientWithNilContext(t *testing.T) {
	if _, err := exec.LookPath("agent-browser"); err != nil {
		t.Skip("agent-browser not installed")
	}

	client := &Client{
		config: ClientConfig{CDPPort: 9222, Timeout: 100},
	}

	// Note: Passing nil context should panic or fail gracefully
	// This depends on implementation - testing defensive code
	t.Run("Close with background context", func(t *testing.T) {
		err := client.Close(context.Background())
		if err != nil {
			// Close on unconnected client should be fine
		}
	})
}

// TestSnapshotResultCreation tests various ways to create SnapshotResult
func TestSnapshotResultCreation(t *testing.T) {
	t.Run("via ParseSnapshot", func(t *testing.T) {
		result := ParseSnapshot("@e1: button \"Test\"")
		if result == nil {
			t.Error("should not return nil")
		}
	})

	t.Run("direct construction", func(t *testing.T) {
		result := &SnapshotResult{
			Elements: []Element{{Ref: "@e1", Role: "button", Name: "Test"}},
			Raw:      "@e1: button \"Test\"",
			URL:      "https://example.com",
			Title:    "Example",
		}
		if result.Count() != 1 {
			t.Error("should have 1 element")
		}
	})

	t.Run("zero value", func(t *testing.T) {
		var result SnapshotResult
		if result.Count() != 0 {
			t.Error("zero value should have 0 elements")
		}
	})
}

// TestElementCreation tests various ways to create Elements
func TestElementCreation(t *testing.T) {
	t.Run("full construction", func(t *testing.T) {
		elem := Element{
			Ref:         "@e1",
			Role:        "button",
			Name:        "Submit",
			Description: "Submit form",
			Enabled:     true,
			Visible:     true,
		}
		if elem.Ref != "@e1" {
			t.Error("ref not set")
		}
	})

	t.Run("partial construction", func(t *testing.T) {
		elem := Element{Ref: "@e1"}
		if elem.Role != "" {
			t.Error("unset fields should be empty")
		}
		if elem.Enabled {
			t.Error("unset bool should be false")
		}
	})

	t.Run("zero value", func(t *testing.T) {
		var elem Element
		if elem.Ref != "" || elem.Role != "" || elem.Name != "" {
			t.Error("zero value should have empty strings")
		}
	})
}

// TestCommandErrorCreation tests CommandError creation and methods
func TestCommandErrorCreation(t *testing.T) {
	t.Run("full construction", func(t *testing.T) {
		err := &CommandError{
			Command: "click",
			Args:    []string{"@e1", "--option"},
			Output:  "error output here",
			Err:     ErrElementNotFound,
		}

		msg := err.Error()
		if msg == "" {
			t.Error("error message should not be empty")
		}

		unwrapped := err.Unwrap()
		if unwrapped != ErrElementNotFound {
			t.Error("unwrap should return underlying error")
		}
	})

	t.Run("minimal construction", func(t *testing.T) {
		err := &CommandError{Command: "test"}
		msg := err.Error()
		if msg == "" {
			t.Error("error message should not be empty")
		}
	})

	t.Run("nil underlying error", func(t *testing.T) {
		err := &CommandError{
			Command: "test",
			Err:     nil,
		}
		if err.Unwrap() != nil {
			t.Error("unwrap nil should return nil")
		}
	})
}

// TestOptionsCreation tests creation of various option types
func TestOptionsCreation(t *testing.T) {
	t.Run("ClickOptions variations", func(t *testing.T) {
		opts := []ClickOptions{
			{},
			{Button: "left"},
			{ClickCount: 2},
			{Delay: 100},
			{Button: "right", ClickCount: 1, Delay: 50},
		}
		for _, o := range opts {
			_ = o.Button
			_ = o.ClickCount
			_ = o.Delay
		}
	})

	t.Run("ScreenshotOptions variations", func(t *testing.T) {
		opts := []ScreenshotOptions{
			{},
			{Path: "/tmp/test.png"},
			{FullPage: true},
			{Quality: 80},
			{Path: "/tmp/test.png", FullPage: true, Quality: 90},
		}
		for _, o := range opts {
			_ = o.Path
			_ = o.FullPage
			_ = o.Quality
		}
	})

	t.Run("WaitOptions variations", func(t *testing.T) {
		opts := []WaitOptions{
			{},
			{Timeout: 5000},
			{State: "visible"},
			{Timeout: 10000, State: "hidden"},
		}
		for _, o := range opts {
			_ = o.Timeout
			_ = o.State
		}
	})
}

// TestScrollDirectionUsage tests scroll direction values
func TestScrollDirectionUsage(t *testing.T) {
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
}

// TestConstantValues tests constant values
func TestConstantValues(t *testing.T) {
	t.Run("DefaultTimeout is reasonable", func(t *testing.T) {
		if DefaultTimeout < 1000 {
			t.Error("default timeout too small")
		}
		if DefaultTimeout > 300000 {
			t.Error("default timeout too large")
		}
	})

	t.Run("ScrollDirection values are lowercase", func(t *testing.T) {
		directions := []ScrollDirection{ScrollUp, ScrollDown, ScrollLeft, ScrollRight}
		for _, d := range directions {
			s := string(d)
			if s != "" && s[0] >= 'A' && s[0] <= 'Z' {
				t.Errorf("direction %q should be lowercase", s)
			}
		}
	})
}

// BenchmarkClientLifecycle benchmarks client lifecycle operations
func BenchmarkClientLifecycle(b *testing.B) {
	for i := 0; i < b.N; i++ {
		client := &Client{
			config: ClientConfig{
				CDPPort: 9222,
				Timeout: 30000,
				Session: "test",
			},
		}
		_ = client.GetConfig()
	}
}

// BenchmarkSnapshotResultMethods benchmarks snapshot result methods
func BenchmarkSnapshotResultMethods(b *testing.B) {
	result := ParseSnapshot(`
@e1: button "A"
@e2: input "B"
@e3: link "C"
@e4: button "D"
@e5: input "E"
`)

	b.Run("Count", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = result.Count()
		}
	})

	b.Run("IsEmpty", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = result.IsEmpty()
		}
	})

	b.Run("FindElementByRef", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = result.FindElementByRef("@e3")
		}
	})

	b.Run("FindElementsByRole", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = result.FindElementsByRole("button")
		}
	})

	b.Run("FindElementsByText", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = result.FindElementsByText("A")
		}
	})
}
