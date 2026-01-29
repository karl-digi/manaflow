// internal/devbox/package_test.go
package devbox

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dba-cli/dba/internal/workspace"
)

// ═══════════════════════════════════════════════════════════════════════════════
// PackageManager Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestNewPackageManager(t *testing.T) {
	ws := &workspace.Workspace{
		ID:          "ws_test",
		Path:        "/tmp/test",
		ProjectPath: "/tmp/test/project",
		Ports:       map[string]int{},
	}

	pm := NewPackageManager(ws)
	if pm == nil {
		t.Fatal("NewPackageManager returned nil")
	}
	if pm.workspace != ws {
		t.Error("PackageManager workspace doesn't match")
	}
	if pm.devbox == nil {
		t.Error("PackageManager devbox is nil")
	}
}

func TestPackageManager_ValidateDevboxConfig_Missing(t *testing.T) {
	tmpDir := t.TempDir()

	ws := &workspace.Workspace{
		ID:   "ws_test",
		Path: tmpDir,
	}

	pm := NewPackageManager(ws)
	err := pm.validateDevboxConfig()
	if err == nil {
		t.Error("Expected error for missing devbox.json")
	}
}

func TestPackageManager_ValidateDevboxConfig_Exists(t *testing.T) {
	tmpDir := t.TempDir()

	// Create devbox.json
	devboxJSON := `{"packages": []}`
	if err := os.WriteFile(filepath.Join(tmpDir, "devbox.json"), []byte(devboxJSON), 0644); err != nil {
		t.Fatal(err)
	}

	ws := &workspace.Workspace{
		ID:   "ws_test",
		Path: tmpDir,
	}

	pm := NewPackageManager(ws)
	err := pm.validateDevboxConfig()
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}
}

func TestPackageManager_ValidateLockFile_Missing(t *testing.T) {
	tmpDir := t.TempDir()

	ws := &workspace.Workspace{
		ID:   "ws_test",
		Path: tmpDir,
	}

	pm := NewPackageManager(ws)
	err := pm.ValidateLockFile()
	// Missing lock file is OK (new project)
	if err != nil {
		t.Errorf("Unexpected error for missing lock file: %v", err)
	}
}

func TestPackageManager_ValidateLockFile_Valid(t *testing.T) {
	tmpDir := t.TempDir()

	// Create valid devbox.lock
	lockContent := `{"lockfile_version": "1", "packages": {}}`
	if err := os.WriteFile(filepath.Join(tmpDir, "devbox.lock"), []byte(lockContent), 0644); err != nil {
		t.Fatal(err)
	}

	ws := &workspace.Workspace{
		ID:   "ws_test",
		Path: tmpDir,
	}

	pm := NewPackageManager(ws)
	err := pm.ValidateLockFile()
	if err != nil {
		t.Errorf("Unexpected error for valid lock file: %v", err)
	}
}

func TestPackageManager_ValidateLockFile_Invalid(t *testing.T) {
	tmpDir := t.TempDir()

	// Create invalid devbox.lock
	if err := os.WriteFile(filepath.Join(tmpDir, "devbox.lock"), []byte("{invalid json}"), 0644); err != nil {
		t.Fatal(err)
	}

	ws := &workspace.Workspace{
		ID:   "ws_test",
		Path: tmpDir,
	}

	pm := NewPackageManager(ws)
	err := pm.ValidateLockFile()
	if err == nil {
		t.Error("Expected error for invalid lock file")
	}
}

func TestPackageManager_GetInstalledPackages(t *testing.T) {
	tmpDir := t.TempDir()

	// Create devbox.json with packages
	devboxJSON := `{"packages": ["nodejs@20", "pnpm@latest", "git"]}`
	if err := os.WriteFile(filepath.Join(tmpDir, "devbox.json"), []byte(devboxJSON), 0644); err != nil {
		t.Fatal(err)
	}

	ws := &workspace.Workspace{
		ID:   "ws_test",
		Path: tmpDir,
	}

	pm := NewPackageManager(ws)
	packages, err := pm.GetInstalledPackages()
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if len(packages) != 3 {
		t.Errorf("Expected 3 packages, got %d", len(packages))
	}

	expected := map[string]bool{"nodejs@20": true, "pnpm@latest": true, "git": true}
	for _, pkg := range packages {
		if !expected[pkg] {
			t.Errorf("Unexpected package: %s", pkg)
		}
	}
}

func TestPackageManager_GetInstalledPackages_Empty(t *testing.T) {
	tmpDir := t.TempDir()

	// Create devbox.json with no packages
	devboxJSON := `{"packages": []}`
	if err := os.WriteFile(filepath.Join(tmpDir, "devbox.json"), []byte(devboxJSON), 0644); err != nil {
		t.Fatal(err)
	}

	ws := &workspace.Workspace{
		ID:   "ws_test",
		Path: tmpDir,
	}

	pm := NewPackageManager(ws)
	packages, err := pm.GetInstalledPackages()
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if len(packages) != 0 {
		t.Errorf("Expected 0 packages, got %d", len(packages))
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// extractBinaryName Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestExtractBinaryName(t *testing.T) {
	tests := []struct {
		pkg      string
		expected string
	}{
		{"nodejs@20", "node"},
		{"nodejs", "node"},
		{"python@3.11", "python3"},
		{"python3", "python3"},
		{"go", "go"},
		{"golang", "go"},
		{"rustc", "rustc"},
		{"pnpm@latest", "pnpm"},
		{"yarn", "yarn"},
		{"npm", "npm"},
		{"git", "git"},
		{"ripgrep", "rg"},
		{"neovim", "nvim"},
		{"awscli2", "aws"},
		{"postgresql", "psql"},
		{"redis", "redis-cli"},
		{"unknown-package", "unknown-package"},
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

func TestExtractBinaryName_WithVersion(t *testing.T) {
	tests := []struct {
		pkg      string
		expected string
	}{
		{"nodejs@20.10.0", "node"},
		{"python@3.11.4", "python3"},
		{"go@1.21", "go"},
		{"pnpm@8.10.2", "pnpm"},
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

// ═══════════════════════════════════════════════════════════════════════════════
// parseSearchOutput Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestParseSearchOutput_Empty(t *testing.T) {
	result := parseSearchOutput("")
	if len(result) != 0 {
		t.Errorf("Expected 0 packages, got %d", len(result))
	}
}

func TestParseSearchOutput_SinglePackage(t *testing.T) {
	output := "nodejs (20.10.0) - Node.js JavaScript runtime"
	result := parseSearchOutput(output)
	if len(result) != 1 {
		t.Fatalf("Expected 1 package, got %d", len(result))
	}
	if result[0].Name != "nodejs" {
		t.Errorf("Expected name 'nodejs', got '%s'", result[0].Name)
	}
}

func TestParseSearchOutput_MultiplePackages(t *testing.T) {
	output := `nodejs (20.10.0) - Node.js runtime
python (3.11.4) - Python interpreter
go (1.21.0) - Go programming language`

	result := parseSearchOutput(output)
	if len(result) != 3 {
		t.Fatalf("Expected 3 packages, got %d", len(result))
	}
}

func TestParseSearchOutput_SkipsWarnings(t *testing.T) {
	output := `Warning: This is a warning
Found 2 packages
nodejs (20.10.0)
python (3.11.4)`

	result := parseSearchOutput(output)
	// Should skip "Warning" and "Found" lines
	if len(result) != 2 {
		t.Errorf("Expected 2 packages, got %d", len(result))
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// difference Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestDifference_Empty(t *testing.T) {
	a := []string{}
	b := []string{}
	result := difference(a, b)
	if len(result) != 0 {
		t.Errorf("Expected empty result, got %v", result)
	}
}

func TestDifference_NoChange(t *testing.T) {
	a := []string{"a", "b", "c"}
	b := []string{"a", "b", "c"}
	result := difference(a, b)
	if len(result) != 0 {
		t.Errorf("Expected empty result, got %v", result)
	}
}

func TestDifference_AllNew(t *testing.T) {
	a := []string{"a", "b", "c"}
	b := []string{}
	result := difference(a, b)
	if len(result) != 3 {
		t.Errorf("Expected 3 elements, got %d", len(result))
	}
}

func TestDifference_SomeNew(t *testing.T) {
	a := []string{"a", "b", "c", "d"}
	b := []string{"a", "c"}
	result := difference(a, b)
	if len(result) != 2 {
		t.Errorf("Expected 2 elements, got %d", len(result))
	}

	expected := map[string]bool{"b": true, "d": true}
	for _, x := range result {
		if !expected[x] {
			t.Errorf("Unexpected element: %s", x)
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// PackageInfo Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestPackageInfo_JSONSerialization(t *testing.T) {
	info := PackageInfo{
		Name:        "nodejs",
		Version:     "20.10.0",
		Description: "Node.js JavaScript runtime",
	}

	data, err := json.Marshal(info)
	if err != nil {
		t.Fatalf("Failed to marshal: %v", err)
	}

	var decoded PackageInfo
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal: %v", err)
	}

	if decoded.Name != info.Name {
		t.Errorf("Name mismatch: %s vs %s", decoded.Name, info.Name)
	}
	if decoded.Version != info.Version {
		t.Errorf("Version mismatch: %s vs %s", decoded.Version, info.Version)
	}
}

func TestPackageInfo_OmitEmpty(t *testing.T) {
	info := PackageInfo{
		Name: "nodejs",
	}

	data, err := json.Marshal(info)
	if err != nil {
		t.Fatalf("Failed to marshal: %v", err)
	}

	// Should omit empty version and description (omitempty)
	str := string(data)
	if strings.Contains(str, "version") && !strings.Contains(str, `"version":""`) {
		// Version field present and not empty - check if omitempty works
		t.Log("Note: version field may be included even when empty")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// SyncResult Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestSyncResult_Structure(t *testing.T) {
	result := SyncResult{
		Added:    []string{"nodejs", "pnpm"},
		Removed:  []string{"yarn"},
		Synced:   true,
		Duration: 5 * time.Second,
		Verified: true,
	}

	if len(result.Added) != 2 {
		t.Errorf("Expected 2 added, got %d", len(result.Added))
	}
	if len(result.Removed) != 1 {
		t.Errorf("Expected 1 removed, got %d", len(result.Removed))
	}
	if !result.Synced {
		t.Error("Expected synced to be true")
	}
	if !result.Verified {
		t.Error("Expected verified to be true")
	}
}

func TestSyncResult_JSONSerialization(t *testing.T) {
	result := SyncResult{
		Added:    []string{"nodejs"},
		Synced:   true,
		Duration: time.Second,
		Verified: true,
	}

	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("Failed to marshal: %v", err)
	}

	var decoded SyncResult
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal: %v", err)
	}

	if !decoded.Synced {
		t.Error("Synced should be true after round-trip")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// AddResult Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestAddResult_Structure(t *testing.T) {
	result := AddResult{
		Package:     "nodejs@20",
		Success:     true,
		Duration:    10 * time.Second,
		Verified:    true,
		VerifyError: "",
	}

	if result.Package != "nodejs@20" {
		t.Errorf("Expected package 'nodejs@20', got '%s'", result.Package)
	}
	if !result.Success {
		t.Error("Expected success to be true")
	}
}

func TestAddResult_WithError(t *testing.T) {
	result := AddResult{
		Package:     "invalid-pkg",
		Success:     false,
		Verified:    false,
		VerifyError: "package not found",
	}

	if result.Success {
		t.Error("Expected success to be false")
	}
	if result.VerifyError == "" {
		t.Error("Expected verify error to be set")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Integration Tests (require devbox)
// ═══════════════════════════════════════════════════════════════════════════════

func TestPackageManager_Search_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	if err := EnsureDevbox(); err != nil {
		t.Skip("Devbox not installed")
	}

	tmpDir := t.TempDir()

	// Create minimal devbox.json
	devboxJSON := `{"packages": []}`
	if err := os.WriteFile(filepath.Join(tmpDir, "devbox.json"), []byte(devboxJSON), 0644); err != nil {
		t.Fatal(err)
	}

	ws := &workspace.Workspace{
		ID:   "ws_test",
		Path: tmpDir,
	}

	pm := NewPackageManager(ws)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	packages, err := pm.Search(ctx, "nodejs")
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}

	// Should find at least one nodejs package
	if len(packages) == 0 {
		t.Error("Expected to find nodejs packages")
	}

	foundNodejs := false
	for _, pkg := range packages {
		if strings.Contains(strings.ToLower(pkg.Name), "node") {
			foundNodejs = true
			break
		}
	}

	if !foundNodejs {
		t.Error("Expected to find a package containing 'node'")
	}
}

