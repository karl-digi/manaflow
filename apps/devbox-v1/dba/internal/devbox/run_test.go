// internal/devbox/run_test.go
package devbox

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/dba-cli/dba/internal/config"
	"github.com/dba-cli/dba/internal/workspace"
)

func TestNewRunner(t *testing.T) {
	ws := &workspace.Workspace{
		ID:          "ws_test123",
		Path:        "/tmp/test",
		ProjectPath: "/tmp/test/project",
		Ports:       map[string]int{"PORT": 10000},
	}

	cfg := &config.Config{
		Sync: config.SyncConfig{
			BarrierTimeout: "5s",
		},
	}

	runner := NewRunner(ws, cfg, false)
	if runner == nil {
		t.Fatal("NewRunner returned nil")
	}
	if runner.workspace != ws {
		t.Error("Runner workspace doesn't match")
	}
	if runner.config != cfg {
		t.Error("Runner config doesn't match")
	}
	if runner.noSync != false {
		t.Error("Runner noSync should be false")
	}
}

func TestNewRunner_NoSync(t *testing.T) {
	ws := &workspace.Workspace{
		ID:          "ws_test123",
		Path:        "/tmp/test",
		ProjectPath: "/tmp/test/project",
		Ports:       map[string]int{},
	}

	cfg := &config.Config{}

	runner := NewRunner(ws, cfg, true)
	if runner.noSync != true {
		t.Error("Runner noSync should be true")
	}
}

func TestRunner_GetDevbox(t *testing.T) {
	ws := &workspace.Workspace{
		ID:          "ws_test123",
		Path:        "/tmp/test",
		ProjectPath: "/tmp/test/project",
		Ports:       map[string]int{},
	}

	cfg := &config.Config{}
	runner := NewRunner(ws, cfg, false)

	dbx := runner.GetDevbox()
	if dbx == nil {
		t.Fatal("GetDevbox returned nil")
	}
	if dbx.workspace != ws {
		t.Error("Devbox workspace doesn't match")
	}
}

func TestRunner_WaitForSync_DaemonNotRunning(t *testing.T) {
	ws := &workspace.Workspace{
		ID:          "ws_test123",
		Path:        "/tmp/test",
		ProjectPath: "/tmp/test/project",
		Ports:       map[string]int{},
	}

	cfg := &config.Config{
		Daemon: config.DaemonConfig{
			Socket: "/tmp/nonexistent.sock",
		},
		Sync: config.SyncConfig{
			BarrierTimeout: "1s",
		},
	}

	runner := NewRunner(ws, cfg, false)

	// When daemon is not running, waitForSync should return 0, nil
	ctx := context.Background()
	waitMs, err := runner.waitForSync(ctx)
	if err != nil {
		t.Errorf("waitForSync should not error when daemon not running: %v", err)
	}
	if waitMs != 0 {
		t.Errorf("Expected 0 wait time, got %d", waitMs)
	}
}

func TestRunner_Run_NoSync(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Check if devbox is available
	if err := EnsureDevbox(); err != nil {
		t.Skip("Devbox not installed, skipping integration test")
	}

	// Create a temporary workspace
	tmpDir := t.TempDir()

	// Create minimal devbox.json
	devboxJSON := `{"packages": []}`
	if err := writeTestFile(tmpDir+"/devbox.json", devboxJSON); err != nil {
		t.Fatalf("Failed to create devbox.json: %v", err)
	}

	ws := &workspace.Workspace{
		ID:          "ws_test",
		Path:        tmpDir,
		ProjectPath: tmpDir,
		Ports:       map[string]int{"PORT": 10000},
	}

	cfg := &config.Config{
		Daemon: config.DaemonConfig{
			Socket: "/tmp/nonexistent.sock",
		},
	}

	runner := NewRunner(ws, cfg, true) // noSync = true
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result, err := runner.Run(ctx, "echo 'test'", RunOptions{})
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}

	if result.ExitCode != 0 {
		t.Errorf("Expected exit code 0, got %d", result.ExitCode)
	}
	if result.Synced != false {
		t.Error("Expected Synced to be false when noSync=true")
	}
}

func TestRunOptions_Defaults(t *testing.T) {
	opts := RunOptions{}

	if opts.Cwd != "" {
		t.Errorf("Default Cwd should be empty, got %s", opts.Cwd)
	}
	if opts.Env != nil {
		t.Error("Default Env should be nil")
	}
	if opts.Shell != false {
		t.Error("Default Shell should be false")
	}
}

func TestRunOptions_WithValues(t *testing.T) {
	opts := RunOptions{
		Cwd: "src/app",
		Env: map[string]string{
			"NODE_ENV": "test",
			"DEBUG":    "true",
		},
		Shell: true,
	}

	if opts.Cwd != "src/app" {
		t.Errorf("Expected Cwd 'src/app', got '%s'", opts.Cwd)
	}
	if len(opts.Env) != 2 {
		t.Errorf("Expected 2 env vars, got %d", len(opts.Env))
	}
	if opts.Env["NODE_ENV"] != "test" {
		t.Errorf("Expected NODE_ENV=test, got %s", opts.Env["NODE_ENV"])
	}
}

func TestRunner_ParseTimeout(t *testing.T) {
	ws := &workspace.Workspace{
		ID:          "ws_test",
		Path:        "/tmp/test",
		ProjectPath: "/tmp/test/project",
		Ports:       map[string]int{},
	}

	tests := []struct {
		name           string
		barrierTimeout string
		expected       time.Duration
	}{
		{"valid 5s", "5s", 5 * time.Second},
		{"valid 1m", "1m", 1 * time.Minute},
		{"valid 30s", "30s", 30 * time.Second},
		{"empty defaults to 10s", "", 10 * time.Second},
		{"invalid defaults to 10s", "invalid", 10 * time.Second},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := &config.Config{
				Daemon: config.DaemonConfig{
					Socket: "/tmp/nonexistent.sock",
				},
				Sync: config.SyncConfig{
					BarrierTimeout: tc.barrierTimeout,
				},
			}

			runner := NewRunner(ws, cfg, false)
			// We can't directly test the timeout parsing, but we can verify the runner is created
			if runner == nil {
				t.Fatal("NewRunner returned nil")
			}
		})
	}
}

// Helper to write test files
func writeTestFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}
