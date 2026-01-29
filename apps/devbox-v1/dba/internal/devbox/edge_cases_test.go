// internal/devbox/edge_cases_test.go
package devbox

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dba-cli/dba/internal/config"
	"github.com/dba-cli/dba/internal/workspace"
)

// ═══════════════════════════════════════════════════════════════════════════════
// extractBinaryName Extended Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

func TestExtractBinaryName_AllMappings(t *testing.T) {
	// Test every mapping in the binaryMap
	tests := []struct {
		pkg      string
		expected string
	}{
		// Node.js ecosystem
		{"nodejs", "node"},
		{"nodejs@20", "node"},
		{"nodejs@20.10.0", "node"},
		{"nodejs@latest", "node"},

		// Python ecosystem
		{"python", "python3"},
		{"python3", "python3"},
		{"python310", "python3"},
		{"python311", "python3"},
		{"python312", "python3"},
		{"python@3.11", "python3"},
		{"python@3.12.0", "python3"},

		// Go ecosystem
		{"go", "go"},
		{"golang", "go"},
		{"go@1.21", "go"},
		{"golang@1.22", "go"},

		// Rust ecosystem
		{"rustc", "rustc"},
		{"rust", "rustc"},
		{"cargo", "cargo"},
		{"rustc@1.75", "rustc"},

		// Package managers
		{"pnpm", "pnpm"},
		{"yarn", "yarn"},
		{"npm", "npm"},
		{"pnpm@8", "pnpm"},
		{"yarn@4", "yarn"},

		// Common tools
		{"git", "git"},
		{"curl", "curl"},
		{"wget", "wget"},
		{"jq", "jq"},

		// Modern CLI tools
		{"ripgrep", "rg"},
		{"fd", "fd"},
		{"bat", "bat"},
		{"exa", "exa"},
		{"fzf", "fzf"},

		// Editors and shells
		{"tmux", "tmux"},
		{"vim", "vim"},
		{"neovim", "nvim"},
		{"zsh", "zsh"},
		{"bash", "bash"},
		{"fish", "fish"},

		// DevOps tools
		{"docker", "docker"},
		{"kubectl", "kubectl"},
		{"terraform", "terraform"},
		{"awscli", "aws"},
		{"awscli2", "aws"},
		{"gcloud", "gcloud"},

		// Databases
		{"postgresql", "psql"},
		{"mysql", "mysql"},
		{"redis", "redis-cli"},
		{"mongodb", "mongo"},
		{"sqlite", "sqlite3"},

		// Unknown packages return as-is
		{"custom-tool", "custom-tool"},
		{"my-package", "my-package"},
		{"unknown", "unknown"},
	}

	for _, tc := range tests {
		t.Run(tc.pkg, func(t *testing.T) {
			result := extractBinaryName(tc.pkg)
			if result != tc.expected {
				t.Errorf("extractBinaryName(%s) = %s, want %s", tc.pkg, result, tc.expected)
			}
		})
	}
}

func TestExtractBinaryName_VersionFormats(t *testing.T) {
	// Test various version format styles
	tests := []struct {
		pkg      string
		expected string
	}{
		{"nodejs@20", "node"},
		{"nodejs@20.10", "node"},
		{"nodejs@20.10.0", "node"},
		{"nodejs@v20.10.0", "node"},
		{"nodejs@latest", "node"},
		{"nodejs@lts", "node"},
		{"nodejs@^20.0.0", "node"},
		{"nodejs@>=20", "node"},
		{"nodejs@~20.10.0", "node"},
	}

	for _, tc := range tests {
		t.Run(tc.pkg, func(t *testing.T) {
			result := extractBinaryName(tc.pkg)
			if result != tc.expected {
				t.Errorf("extractBinaryName(%s) = %s, want %s", tc.pkg, result, tc.expected)
			}
		})
	}
}

func TestExtractBinaryName_EdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		pkg      string
		expected string
	}{
		{"empty string", "", ""},
		{"just @", "@", ""},
		{"version only", "@20", ""},
		{"multiple @", "pkg@ver@extra", "pkg"},
		{"trailing @", "nodejs@", "node"}, // "nodejs" maps to "node" in binaryMap
		{"spaces", " nodejs ", " nodejs "},
		{"unicode", "日本語", "日本語"},
		{"special chars", "pkg-name_v2", "pkg-name_v2"},
		{"dots in name", "some.package", "some.package"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := extractBinaryName(tc.pkg)
			if result != tc.expected {
				t.Errorf("extractBinaryName(%q) = %q, want %q", tc.pkg, result, tc.expected)
			}
		})
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// parseSearchOutput Extended Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

func TestParseSearchOutput_VariousFormats(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected int
	}{
		{"empty", "", 0},
		{"whitespace only", "   \n\t\n  ", 0},
		{"single package", "nodejs (20.10.0) - Node.js runtime", 1},
		{"multiple packages", "nodejs (20.10.0)\npython (3.11.4)\ngo (1.21)", 3},
		{"with warnings", "Warning: something\nnodejs (20.10.0)", 1},
		{"with found prefix", "Found 5 packages\nnodejs (20.10.0)", 1},
		{"mixed content", "Warning: test\nFound 2 packages\nnodejs (20)\npython (3.11)", 2},
		{"no version", "nodejs", 1},
		{"version in parens", "nodejs (20)", 1},
		{"with description", "nodejs (20.10.0) - A very long description here", 1},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := parseSearchOutput(tc.input)
			if len(result) != tc.expected {
				t.Errorf("parseSearchOutput() returned %d packages, want %d", len(result), tc.expected)
			}
		})
	}
}

func TestParseSearchOutput_PackageDetails(t *testing.T) {
	output := "nodejs (20.10.0) - Node.js JavaScript runtime"
	result := parseSearchOutput(output)

	if len(result) != 1 {
		t.Fatalf("Expected 1 package, got %d", len(result))
	}

	pkg := result[0]
	if pkg.Name != "nodejs" {
		t.Errorf("Expected name 'nodejs', got %q", pkg.Name)
	}
	if pkg.Version != "20.10.0" {
		t.Errorf("Expected version '20.10.0', got %q", pkg.Version)
	}
	if pkg.Description != "Node.js JavaScript runtime" {
		t.Errorf("Expected description 'Node.js JavaScript runtime', got %q", pkg.Description)
	}
}

func TestParseSearchOutput_SpecialCharacters(t *testing.T) {
	tests := []struct {
		name   string
		output string
	}{
		{"unicode package name", "日本語 (1.0.0) - Unicode package"},
		{"special chars", "pkg-name_v2 (1.0) - Has special chars"},
		{"dots in version", "pkg (1.2.3.4.5) - Many dots"},
		{"empty description", "pkg (1.0) - "},
		{"no hyphen separator", "pkg (1.0) description without hyphen"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Should not panic
			result := parseSearchOutput(tc.output)
			if len(result) == 0 {
				t.Error("Expected at least one package")
			}
		})
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// difference Function Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

func TestDifference_ExtendedCases(t *testing.T) {
	tests := []struct {
		name     string
		a        []string
		b        []string
		expected int
	}{
		{"both empty", []string{}, []string{}, 0},
		{"a empty", []string{}, []string{"x", "y"}, 0},
		{"b empty", []string{"x", "y"}, []string{}, 2},
		{"identical", []string{"a", "b"}, []string{"a", "b"}, 0},
		{"subset", []string{"a", "b", "c"}, []string{"a", "b"}, 1},
		{"no overlap", []string{"a", "b"}, []string{"c", "d"}, 2},
		{"duplicates in a", []string{"a", "a", "b"}, []string{"a"}, 1},
		{"duplicates in b", []string{"a", "b"}, []string{"a", "a"}, 1},
		{"large sets", generateStrings(100), generateStrings(50), 50},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := difference(tc.a, tc.b)
			if len(result) != tc.expected {
				t.Errorf("difference() returned %d elements, want %d", len(result), tc.expected)
			}
		})
	}
}

func generateStrings(n int) []string {
	result := make([]string, n)
	for i := 0; i < n; i++ {
		result[i] = fmt.Sprintf("pkg_%d", i) // Generate unique strings
	}
	return result
}

// ═══════════════════════════════════════════════════════════════════════════════
// PackageInfo JSON Serialization Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

func TestPackageInfo_JSONEdgeCases(t *testing.T) {
	tests := []struct {
		name string
		info PackageInfo
	}{
		{"all fields", PackageInfo{Name: "nodejs", Version: "20.10.0", Description: "Runtime"}},
		{"name only", PackageInfo{Name: "nodejs"}},
		{"empty version", PackageInfo{Name: "pkg", Version: ""}},
		{"unicode", PackageInfo{Name: "日本語", Version: "1.0", Description: "Unicode description 中文"}},
		{"special chars", PackageInfo{Name: "pkg@test", Version: "1.0.0-alpha+build.123", Description: "Has <>& chars"}},
		{"long description", PackageInfo{Name: "pkg", Description: strings.Repeat("a", 10000)}},
		{"newlines", PackageInfo{Name: "pkg", Description: "line1\nline2\nline3"}},
		{"quotes", PackageInfo{Name: "pkg", Description: `has "quotes" and 'apostrophes'`}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			data, err := json.Marshal(tc.info)
			if err != nil {
				t.Fatalf("Marshal failed: %v", err)
			}

			var decoded PackageInfo
			if err := json.Unmarshal(data, &decoded); err != nil {
				t.Fatalf("Unmarshal failed: %v", err)
			}

			if decoded.Name != tc.info.Name {
				t.Errorf("Name mismatch: got %q, want %q", decoded.Name, tc.info.Name)
			}
		})
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// SyncResult JSON Serialization Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

func TestSyncResult_JSONEdgeCases(t *testing.T) {
	tests := []struct {
		name   string
		result SyncResult
	}{
		{"empty", SyncResult{}},
		{"synced only", SyncResult{Synced: true, Verified: true}},
		{"with added", SyncResult{Added: []string{"pkg1", "pkg2"}, Synced: true}},
		{"with removed", SyncResult{Removed: []string{"pkg1"}, Synced: true}},
		{"both added and removed", SyncResult{Added: []string{"new"}, Removed: []string{"old"}, Synced: true}},
		{"with duration", SyncResult{Duration: 5 * time.Second, Synced: true}},
		{"with verify log", SyncResult{VerifyLog: "All packages verified", Verified: true}},
		{"large lists", SyncResult{Added: generateStrings(100), Removed: generateStrings(50)}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			data, err := json.Marshal(tc.result)
			if err != nil {
				t.Fatalf("Marshal failed: %v", err)
			}

			var decoded SyncResult
			if err := json.Unmarshal(data, &decoded); err != nil {
				t.Fatalf("Unmarshal failed: %v", err)
			}

			if decoded.Synced != tc.result.Synced {
				t.Errorf("Synced mismatch: got %v, want %v", decoded.Synced, tc.result.Synced)
			}
		})
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Workspace Path Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

func TestPackageManager_PathEdgeCases(t *testing.T) {
	tests := []struct {
		name string
		path string
	}{
		{"simple", "/tmp/test"},
		{"with spaces", "/tmp/path with spaces"},
		{"deep nesting", "/tmp/a/b/c/d/e/f/g/h/i/j"},
		{"unicode", "/tmp/日本語/workspace"},
		{"special chars", "/tmp/path-with_special.chars"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ws := &workspace.Workspace{
				ID:   "ws_test",
				Path: tc.path,
			}

			pm := NewPackageManager(ws)
			if pm == nil {
				t.Fatal("NewPackageManager returned nil")
			}
			if pm.workspace.Path != tc.path {
				t.Errorf("Path mismatch: got %q, want %q", pm.workspace.Path, tc.path)
			}
		})
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Lock File Validation Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

func TestValidateLockFile_EdgeCases(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		shouldError bool
	}{
		{"valid minimal", `{"packages": {}}`, false},
		{"valid with packages", `{"lockfile_version": "1", "packages": {"nodejs": {}}}`, false},
		{"empty object", `{}`, false},
		{"empty file", ``, false}, // Empty file is treated as no lock file (OK for new projects)
		{"invalid json", `{invalid}`, true},
		{"array instead of object", `[]`, true},
		{"null", `null`, false}, // null unmarshals to empty struct, which is valid
		{"string", `"string"`, true},
		{"number", `123`, true},
		{"nested packages", `{"packages": {"nodejs": {"version": "20.0.0", "resolved": "hash"}}}`, false},
		{"unicode in package name", `{"packages": {"日本語": {}}}`, false},
		{"very large", `{"packages": {` + strings.Repeat(`"pkg": {},`, 1000) + `"last": {}}}`, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tmpDir := t.TempDir()

			if tc.content != "" {
				if err := os.WriteFile(filepath.Join(tmpDir, "devbox.lock"), []byte(tc.content), 0644); err != nil {
					t.Fatal(err)
				}
			}

			ws := &workspace.Workspace{
				ID:   "ws_test",
				Path: tmpDir,
			}

			pm := NewPackageManager(ws)
			err := pm.ValidateLockFile()

			if tc.shouldError && err == nil {
				t.Error("Expected error but got nil")
			}
			if !tc.shouldError && err != nil {
				t.Errorf("Unexpected error: %v", err)
			}
		})
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// DevboxConfig Validation Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

func TestValidateDevboxConfig_EdgeCases(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		shouldError bool
	}{
		{"valid minimal", `{"packages": []}`, false},
		{"valid with packages", `{"packages": ["nodejs@20"]}`, false},
		{"no file", "", true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tmpDir := t.TempDir()

			if tc.content != "" {
				if err := os.WriteFile(filepath.Join(tmpDir, "devbox.json"), []byte(tc.content), 0644); err != nil {
					t.Fatal(err)
				}
			}

			ws := &workspace.Workspace{
				ID:   "ws_test",
				Path: tmpDir,
			}

			pm := NewPackageManager(ws)
			err := pm.validateDevboxConfig()

			if tc.shouldError && err == nil {
				t.Error("Expected error but got nil")
			}
			if !tc.shouldError && err != nil {
				t.Errorf("Unexpected error: %v", err)
			}
		})
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Concurrent Access Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestPackageManager_ConcurrentRead(t *testing.T) {
	tmpDir := t.TempDir()

	// Create devbox.json
	devboxJSON := `{"packages": ["nodejs@20", "python@3.11", "go@1.21"]}`
	if err := os.WriteFile(filepath.Join(tmpDir, "devbox.json"), []byte(devboxJSON), 0644); err != nil {
		t.Fatal(err)
	}

	ws := &workspace.Workspace{
		ID:   "ws_test",
		Path: tmpDir,
	}

	pm := NewPackageManager(ws)

	// Run concurrent reads
	var wg sync.WaitGroup
	errors := make(chan error, 10)

	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := pm.GetInstalledPackages()
			if err != nil {
				errors <- err
			}
		}()
	}

	wg.Wait()
	close(errors)

	for err := range errors {
		t.Errorf("Concurrent read error: %v", err)
	}
}

func TestRunner_ConcurrentCreate(t *testing.T) {
	ws := &workspace.Workspace{
		ID:   "ws_test",
		Path: "/tmp/test",
		Ports: map[string]int{},
	}

	cfg := &config.Config{}

	var wg sync.WaitGroup
	runners := make([]*Runner, 10)

	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			runners[idx] = NewRunner(ws, cfg, false)
		}(i)
	}

	wg.Wait()

	for i, runner := range runners {
		if runner == nil {
			t.Errorf("Runner %d is nil", i)
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Context Handling Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestRunner_ContextTimeout(t *testing.T) {
	ws := &workspace.Workspace{
		ID:   "ws_test",
		Path: "/tmp/test",
		Ports: map[string]int{},
	}

	cfg := &config.Config{
		Daemon: config.DaemonConfig{
			Socket: "/tmp/nonexistent.sock",
		},
		Sync: config.SyncConfig{
			BarrierTimeout: "100ms",
		},
	}

	runner := NewRunner(ws, cfg, false)

	// Create a very short timeout context
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Nanosecond)
	defer cancel()

	// Wait a bit for context to expire
	time.Sleep(1 * time.Millisecond)

	waitMs, err := runner.waitForSync(ctx)
	// Should not error when daemon isn't running, but context is expired
	if err != nil && err != context.DeadlineExceeded {
		t.Logf("waitForSync returned error (expected when daemon not running): %v", err)
	}
	if waitMs != 0 {
		t.Logf("Wait time: %d ms", waitMs)
	}
}

func TestRunner_ContextCancelled(t *testing.T) {
	ws := &workspace.Workspace{
		ID:   "ws_test",
		Path: "/tmp/test",
		Ports: map[string]int{},
	}

	cfg := &config.Config{
		Daemon: config.DaemonConfig{
			Socket: "/tmp/nonexistent.sock",
		},
	}

	runner := NewRunner(ws, cfg, false)

	// Create and immediately cancel context
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	waitMs, _ := runner.waitForSync(ctx)
	// When daemon isn't running, waitForSync should return quickly
	if waitMs != 0 {
		t.Logf("Wait time with cancelled context: %d ms", waitMs)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Environment Variable Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

func TestDevbox_BuildEnv_EdgeCases(t *testing.T) {
	tests := []struct {
		name  string
		ws    *workspace.Workspace
		check func([]string) bool
	}{
		{
			name: "zero port value",
			ws: &workspace.Workspace{
				ID:    "ws_test",
				Path:  "/tmp/test",
				Ports: map[string]int{"PORT": 0},
			},
			check: func(env []string) bool {
				for _, e := range env {
					if e == "PORT=0" {
						return true
					}
				}
				return false
			},
		},
		{
			name: "negative port value",
			ws: &workspace.Workspace{
				ID:    "ws_test",
				Path:  "/tmp/test",
				Ports: map[string]int{"PORT": -1},
			},
			check: func(env []string) bool {
				for _, e := range env {
					if e == "PORT=-1" {
						return true
					}
				}
				return false
			},
		},
		{
			name: "large port value",
			ws: &workspace.Workspace{
				ID:    "ws_test",
				Path:  "/tmp/test",
				Ports: map[string]int{"PORT": 65535},
			},
			check: func(env []string) bool {
				for _, e := range env {
					if e == "PORT=65535" {
						return true
					}
				}
				return false
			},
		},
		{
			name: "empty workspace ID",
			ws: &workspace.Workspace{
				ID:    "",
				Path:  "/tmp/test",
				Ports: map[string]int{},
			},
			check: func(env []string) bool {
				for _, e := range env {
					if e == "DBA_WORKSPACE_ID=" {
						return true
					}
				}
				return false
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			dbx := New(tc.ws)
			env := dbx.buildEnv()
			if !tc.check(env) {
				t.Error("Environment check failed")
			}
		})
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// AddResult Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

func TestAddResult_AllFields(t *testing.T) {
	result := AddResult{
		Package:     "nodejs@20.10.0",
		Success:     true,
		Duration:    15 * time.Second,
		Verified:    true,
		VerifyError: "",
	}

	// Test JSON serialization
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var decoded AddResult
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}

	if decoded.Package != result.Package {
		t.Errorf("Package mismatch: got %q, want %q", decoded.Package, result.Package)
	}
	if decoded.Success != result.Success {
		t.Errorf("Success mismatch: got %v, want %v", decoded.Success, result.Success)
	}
	if decoded.Verified != result.Verified {
		t.Errorf("Verified mismatch: got %v, want %v", decoded.Verified, result.Verified)
	}
}

func TestAddResult_WithVerifyError(t *testing.T) {
	result := AddResult{
		Package:     "invalid-package",
		Success:     false,
		Duration:    100 * time.Millisecond,
		Verified:    false,
		VerifyError: "package not found in Nix store",
	}

	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	// Verify the error message is preserved
	if !strings.Contains(string(data), "package not found") {
		t.Error("VerifyError not preserved in JSON")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// GetInstalledPackages Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

func TestGetInstalledPackages_EdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		expected int
		hasError bool
	}{
		{"empty array", `{"packages": []}`, 0, false},
		{"single package", `{"packages": ["nodejs"]}`, 1, false},
		{"many packages", `{"packages": ["a", "b", "c", "d", "e"]}`, 5, false},
		{"with versions", `{"packages": ["nodejs@20", "python@3.11"]}`, 2, false},
		{"duplicates", `{"packages": ["nodejs", "nodejs"]}`, 2, false},
		{"unicode", `{"packages": ["日本語"]}`, 1, false},
		{"invalid json", `{invalid}`, 0, true},
		{"missing packages key", `{"other": []}`, 0, false},
		{"packages not array", `{"packages": "nodejs"}`, 0, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tmpDir := t.TempDir()

			if err := os.WriteFile(filepath.Join(tmpDir, "devbox.json"), []byte(tc.content), 0644); err != nil {
				t.Fatal(err)
			}

			ws := &workspace.Workspace{
				ID:   "ws_test",
				Path: tmpDir,
			}

			pm := NewPackageManager(ws)
			packages, err := pm.GetInstalledPackages()

			if tc.hasError {
				if err == nil {
					t.Error("Expected error but got nil")
				}
				return
			}

			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			if len(packages) != tc.expected {
				t.Errorf("Got %d packages, want %d", len(packages), tc.expected)
			}
		})
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test Runner Immutability
// ═══════════════════════════════════════════════════════════════════════════════

func TestTestRunner_ArgsCopied(t *testing.T) {
	// Verify that BuildTestCommand doesn't modify original args
	runner := &TestRunner{
		Name:    "vitest",
		Command: "npx",
		Args:    []string{"vitest", "run"},
	}

	originalArgs := make([]string, len(runner.Args))
	copy(originalArgs, runner.Args)

	// Call BuildTestCommand with various options
	runner.BuildTestCommand("pattern", true, true)

	// Verify original args unchanged
	if len(runner.Args) != len(originalArgs) {
		t.Errorf("Args length changed: got %d, want %d", len(runner.Args), len(originalArgs))
	}
	for i, arg := range runner.Args {
		if arg != originalArgs[i] {
			t.Errorf("Args[%d] changed: got %q, want %q", i, arg, originalArgs[i])
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test Runner Detection with Symlinks
// ═══════════════════════════════════════════════════════════════════════════════

func TestDetectTestRunner_WithSymlinks(t *testing.T) {
	tmpDir := t.TempDir()

	// Create actual config in subdirectory
	subDir := filepath.Join(tmpDir, "configs")
	if err := os.MkdirAll(subDir, 0755); err != nil {
		t.Fatal(err)
	}

	actualConfig := filepath.Join(subDir, "vitest.config.ts")
	if err := os.WriteFile(actualConfig, []byte("export default {}"), 0644); err != nil {
		t.Fatal(err)
	}

	// Create symlink in main directory
	symlinkPath := filepath.Join(tmpDir, "vitest.config.ts")
	if err := os.Symlink(actualConfig, symlinkPath); err != nil {
		t.Skipf("Cannot create symlinks (may require elevated permissions): %v", err)
	}

	runner := DetectTestRunner(tmpDir)
	if runner.Name != "vitest" {
		t.Errorf("Expected vitest for symlinked config, got %s", runner.Name)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Nil Safety Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestNilWorkspace_Safety(t *testing.T) {
	// Test that nil workspace doesn't cause panics
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("Panic with nil workspace: %v", r)
		}
	}()

	dbx := New(nil)
	if dbx == nil {
		t.Error("New(nil) should return non-nil Devbox")
	}
}

func TestPackageManager_NilWorkspace(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("Panic with nil workspace: %v", r)
		}
	}()

	pm := NewPackageManager(nil)
	if pm == nil {
		t.Error("NewPackageManager(nil) should return non-nil PackageManager")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// parseUpdateOutput Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

func TestParseUpdateOutput_EdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		output   string
		expected int
	}{
		{"empty", "", 0},
		{"whitespace", "   \n\t\n  ", 0},
		{"with arrow", "nodejs 20.0.0 -> 20.10.0", 1},
		{"with update word", "update nodejs to 20.10.0", 1},
		{"no updates", "Everything is up to date", 0},
		{"multiple updates", "nodejs 20 -> 21\npython 3.11 -> 3.12", 2},
		{"mixed content", "Looking for changes...\nnodejs -> 21\nDone.", 1},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := parseUpdateOutput(tc.output)
			if len(result) != tc.expected {
				t.Errorf("parseUpdateOutput() returned %d packages, want %d", len(result), tc.expected)
			}
		})
	}
}
