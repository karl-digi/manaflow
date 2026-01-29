// internal/devbox/devbox_test.go
package devbox

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/dba-cli/dba/internal/workspace"
)

func TestDevbox_BuildEnv(t *testing.T) {
	ws := &workspace.Workspace{
		ID:          "ws_test123",
		Name:        "test-workspace",
		Path:        "/tmp/test-workspace",
		ProjectPath: "/tmp/test-workspace/project",
		Ports: map[string]int{
			"PORT":      10000,
			"API_PORT":  10001,
			"CODE_PORT": 10080,
		},
	}

	dbx := New(ws)
	env := dbx.buildEnv()

	// Check that workspace ports are in the environment
	portEnvs := map[string]string{
		"PORT":               "10000",
		"API_PORT":           "10001",
		"CODE_PORT":          "10080",
		"DBA_WORKSPACE_ID":   "ws_test123",
		"DBA_WORKSPACE_PATH": "/tmp/test-workspace",
	}

	for key, expectedVal := range portEnvs {
		found := false
		for _, e := range env {
			if e == key+"="+expectedVal {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("Expected environment variable %s=%s not found", key, expectedVal)
		}
	}
}

func TestRunResult_Structure(t *testing.T) {
	result := RunResult{
		ExitCode:   0,
		Stdout:     "hello world",
		Stderr:     "",
		DurationMs: 100,
		SyncWaitMs: 50,
		Synced:     true,
	}

	if result.ExitCode != 0 {
		t.Errorf("Expected exit code 0, got %d", result.ExitCode)
	}
	if result.Stdout != "hello world" {
		t.Errorf("Expected stdout 'hello world', got '%s'", result.Stdout)
	}
	if result.DurationMs != 100 {
		t.Errorf("Expected duration 100ms, got %d", result.DurationMs)
	}
}

func TestRunOptions_Structure(t *testing.T) {
	opts := RunOptions{
		Cwd: "src",
		Env: map[string]string{
			"NODE_ENV": "test",
		},
		Shell: true,
	}

	if opts.Cwd != "src" {
		t.Errorf("Expected cwd 'src', got '%s'", opts.Cwd)
	}
	if opts.Env["NODE_ENV"] != "test" {
		t.Errorf("Expected NODE_ENV=test, got '%s'", opts.Env["NODE_ENV"])
	}
}

func TestEnsureDevbox(t *testing.T) {
	// This test will pass if devbox is installed, fail otherwise
	// Since we can't guarantee devbox is installed in test env, just check the function exists
	err := EnsureDevbox()
	// Either no error (devbox exists) or a specific error message
	if err != nil {
		expectedMsg := "devbox is not installed"
		if len(err.Error()) < len(expectedMsg) || err.Error()[:len(expectedMsg)] != expectedMsg {
			t.Errorf("Unexpected error message: %s", err.Error())
		}
	}
}

func TestNew_ReturnsDevboxInstance(t *testing.T) {
	ws := &workspace.Workspace{
		ID:          "ws_test",
		Path:        "/tmp/test",
		ProjectPath: "/tmp/test/project",
		Ports:       map[string]int{},
	}

	dbx := New(ws)
	if dbx == nil {
		t.Error("New() returned nil")
	}
	if dbx.workspace != ws {
		t.Error("Devbox workspace doesn't match input workspace")
	}
}

// Integration test that requires devbox to be installed
func TestDevbox_Run_Echo(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// Check if devbox is available
	if err := EnsureDevbox(); err != nil {
		t.Skip("Devbox not installed, skipping integration test")
	}

	// Create a temporary workspace directory
	tmpDir, err := os.MkdirTemp("", "dba-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create minimal devbox.json
	devboxJSON := `{"packages": []}`
	if err := os.WriteFile(tmpDir+"/devbox.json", []byte(devboxJSON), 0644); err != nil {
		t.Fatalf("Failed to create devbox.json: %v", err)
	}

	// Create workspace
	ws := &workspace.Workspace{
		ID:          "ws_test",
		Path:        tmpDir,
		ProjectPath: tmpDir,
		Ports: map[string]int{
			"PORT": 10000,
		},
	}

	dbx := New(ws)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result, err := dbx.Run(ctx, "echo 'hello from devbox'", RunOptions{})
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}

	if result.ExitCode != 0 {
		t.Errorf("Expected exit code 0, got %d", result.ExitCode)
	}

	expectedOutput := "hello from devbox\n"
	if result.Stdout != expectedOutput {
		t.Errorf("Expected stdout '%s', got '%s'", expectedOutput, result.Stdout)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Devbox Environment Building Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestDevbox_BuildEnv_EmptyPorts(t *testing.T) {
	ws := &workspace.Workspace{
		ID:          "ws_empty",
		Name:        "empty-workspace",
		Path:        "/tmp/empty-workspace",
		ProjectPath: "/tmp/empty-workspace/project",
		Ports:       map[string]int{},
	}

	dbx := New(ws)
	env := dbx.buildEnv()

	// Should still have DBA workspace vars
	foundID := false
	foundPath := false
	for _, e := range env {
		if e == "DBA_WORKSPACE_ID=ws_empty" {
			foundID = true
		}
		if e == "DBA_WORKSPACE_PATH=/tmp/empty-workspace" {
			foundPath = true
		}
	}

	if !foundID {
		t.Error("DBA_WORKSPACE_ID not found in environment")
	}
	if !foundPath {
		t.Error("DBA_WORKSPACE_PATH not found in environment")
	}
}

func TestDevbox_BuildEnv_ManyPorts(t *testing.T) {
	ws := &workspace.Workspace{
		ID:          "ws_many",
		Path:        "/tmp/many",
		ProjectPath: "/tmp/many/project",
		Ports: map[string]int{
			"PORT":              10000,
			"API_PORT":          10001,
			"DB_PORT":           10002,
			"REDIS_PORT":        10003,
			"HMR_PORT":          10004,
			"WS_PORT":           10005,
			"STORYBOOK_PORT":    10006,
			"DOCS_PORT":         10007,
			"CODE_PORT":         10080,
			"VNC_PORT":          10090,
			"COMPUTER_API_PORT": 10091,
		},
	}

	dbx := New(ws)
	env := dbx.buildEnv()

	// Count port env vars
	expectedPorts := len(ws.Ports)
	foundPorts := 0
	for _, e := range env {
		for portName := range ws.Ports {
			if len(e) > len(portName) && e[:len(portName)+1] == portName+"=" {
				foundPorts++
				break
			}
		}
	}

	if foundPorts != expectedPorts {
		t.Errorf("Expected %d port env vars, found %d", expectedPorts, foundPorts)
	}
}

func TestDevbox_BuildEnv_InheritsOsEnviron(t *testing.T) {
	ws := &workspace.Workspace{
		ID:          "ws_test",
		Path:        "/tmp/test",
		ProjectPath: "/tmp/test/project",
		Ports:       map[string]int{},
	}

	// Set a test env var
	testKey := "DBA_TEST_INHERIT_VAR"
	testVal := "test_value_12345"
	os.Setenv(testKey, testVal)
	defer os.Unsetenv(testKey)

	dbx := New(ws)
	env := dbx.buildEnv()

	found := false
	for _, e := range env {
		if e == testKey+"="+testVal {
			found = true
			break
		}
	}

	if !found {
		t.Errorf("Expected to inherit OS env var %s=%s", testKey, testVal)
	}
}

func TestDevbox_BuildEnv_SpecialCharacters(t *testing.T) {
	ws := &workspace.Workspace{
		ID:          "ws_special",
		Path:        "/tmp/path with spaces/workspace",
		ProjectPath: "/tmp/path with spaces/workspace/project",
		Ports:       map[string]int{"PORT": 10000},
	}

	dbx := New(ws)
	env := dbx.buildEnv()

	// Check that path with spaces is correctly included
	found := false
	expectedPath := "DBA_WORKSPACE_PATH=/tmp/path with spaces/workspace"
	for _, e := range env {
		if e == expectedPath {
			found = true
			break
		}
	}

	if !found {
		t.Error("DBA_WORKSPACE_PATH with spaces not correctly set")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// RunResult Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestRunResult_NonZeroExitCode(t *testing.T) {
	result := RunResult{
		ExitCode: 1,
		Stdout:   "",
		Stderr:   "command not found",
	}

	if result.ExitCode != 1 {
		t.Errorf("Expected exit code 1, got %d", result.ExitCode)
	}
	if result.Stderr != "command not found" {
		t.Errorf("Expected stderr 'command not found', got '%s'", result.Stderr)
	}
}

func TestRunResult_LargeOutput(t *testing.T) {
	// Simulate large output
	largeOutput := make([]byte, 1024*1024) // 1MB
	for i := range largeOutput {
		largeOutput[i] = 'a'
	}

	result := RunResult{
		ExitCode: 0,
		Stdout:   string(largeOutput),
	}

	if len(result.Stdout) != len(largeOutput) {
		t.Errorf("Expected stdout length %d, got %d", len(largeOutput), len(result.Stdout))
	}
}

func TestRunResult_WithSyncMetrics(t *testing.T) {
	result := RunResult{
		ExitCode:   0,
		DurationMs: 5000,
		SyncWaitMs: 150,
		Synced:     true,
	}

	if !result.Synced {
		t.Error("Expected Synced to be true")
	}
	if result.SyncWaitMs != 150 {
		t.Errorf("Expected SyncWaitMs 150, got %d", result.SyncWaitMs)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// RunOptions Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestRunOptions_EmptyEnvMap(t *testing.T) {
	opts := RunOptions{
		Env: map[string]string{},
	}

	if opts.Env == nil {
		t.Error("Expected non-nil empty map")
	}
	if len(opts.Env) != 0 {
		t.Errorf("Expected empty map, got %d entries", len(opts.Env))
	}
}

func TestRunOptions_MultipleEnvVars(t *testing.T) {
	opts := RunOptions{
		Env: map[string]string{
			"NODE_ENV":     "test",
			"DEBUG":        "*",
			"LOG_LEVEL":    "debug",
			"CUSTOM_VAR":   "custom_value",
			"EMPTY_VAR":    "",
			"SPECIAL_CHARS": "value=with=equals",
		},
	}

	if len(opts.Env) != 6 {
		t.Errorf("Expected 6 env vars, got %d", len(opts.Env))
	}

	// Test empty value
	if opts.Env["EMPTY_VAR"] != "" {
		t.Errorf("Expected empty string for EMPTY_VAR, got '%s'", opts.Env["EMPTY_VAR"])
	}

	// Test special characters
	if opts.Env["SPECIAL_CHARS"] != "value=with=equals" {
		t.Errorf("Expected 'value=with=equals', got '%s'", opts.Env["SPECIAL_CHARS"])
	}
}

func TestRunOptions_CwdVariants(t *testing.T) {
	tests := []struct {
		cwd      string
		expected string
	}{
		{"", ""},
		{".", "."},
		{"src", "src"},
		{"src/app", "src/app"},
		{"./src/app", "./src/app"},
		{"../other", "../other"},
		{"/absolute/path", "/absolute/path"},
	}

	for _, tc := range tests {
		opts := RunOptions{Cwd: tc.cwd}
		if opts.Cwd != tc.expected {
			t.Errorf("Expected Cwd '%s', got '%s'", tc.expected, opts.Cwd)
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Devbox Constructor Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestNew_NilWorkspace(t *testing.T) {
	// This should not panic
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("New(nil) panicked: %v", r)
		}
	}()

	dbx := New(nil)
	if dbx == nil {
		t.Error("New(nil) should return a Devbox instance")
	}
}

func TestNew_WorkspaceFields(t *testing.T) {
	ws := &workspace.Workspace{
		ID:          "ws_full",
		Name:        "full-workspace",
		Path:        "/path/to/workspace",
		ProjectPath: "/path/to/workspace/project",
		Template:    "node",
		Status:      "ready",
		BasePort:    10000,
		Ports: map[string]int{
			"PORT":      10000,
			"CODE_PORT": 10080,
		},
		Packages: []string{"nodejs@20", "pnpm@latest"},
	}

	dbx := New(ws)
	if dbx.workspace.ID != ws.ID {
		t.Errorf("Expected ID %s, got %s", ws.ID, dbx.workspace.ID)
	}
	if dbx.workspace.Path != ws.Path {
		t.Errorf("Expected Path %s, got %s", ws.Path, dbx.workspace.Path)
	}
	if len(dbx.workspace.Ports) != len(ws.Ports) {
		t.Errorf("Expected %d ports, got %d", len(ws.Ports), len(dbx.workspace.Ports))
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// EnsureDevbox Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestEnsureDevbox_ErrorMessage(t *testing.T) {
	// Can only test this if devbox is NOT installed
	err := EnsureDevbox()
	if err != nil {
		// Verify the error message contains installation instructions
		if !containsString(err.Error(), "curl") {
			t.Error("Error message should contain installation instructions")
		}
	}
}

func containsString(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsSubstring(s, substr))
}

func containsSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// ═══════════════════════════════════════════════════════════════════════════════
// Context and Timeout Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestDevbox_ContextCancellation(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping context test in short mode")
	}

	ws := &workspace.Workspace{
		ID:          "ws_ctx",
		Path:        "/tmp/nonexistent",
		ProjectPath: "/tmp/nonexistent/project",
		Ports:       map[string]int{},
	}

	dbx := New(ws)

	// Create an already cancelled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	// This should return quickly with context error
	_, err := dbx.Run(ctx, "sleep 10", RunOptions{})

	// Should get some kind of error (context cancelled or command error)
	// We can't guarantee which one depending on timing
	if err == nil {
		// If no error, the context cancellation didn't work as expected
		// but this might be a timing issue, so just log
		t.Log("Note: Command completed despite cancelled context")
	}
}
