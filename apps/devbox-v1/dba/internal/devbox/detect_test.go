// internal/devbox/detect_test.go
package devbox

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDetectTestRunner_Vitest_Config(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-detect-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create vitest config
	if err := os.WriteFile(filepath.Join(tmpDir, "vitest.config.ts"), []byte(""), 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	if runner.Name != "vitest" {
		t.Errorf("Expected vitest runner, got %s", runner.Name)
	}
	if runner.Command != "npx" {
		t.Errorf("Expected npx command, got %s", runner.Command)
	}
}

func TestDetectTestRunner_Jest_Config(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-detect-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create jest config
	if err := os.WriteFile(filepath.Join(tmpDir, "jest.config.js"), []byte(""), 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	if runner.Name != "jest" {
		t.Errorf("Expected jest runner, got %s", runner.Name)
	}
}

func TestDetectTestRunner_Go(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-detect-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create go.mod
	if err := os.WriteFile(filepath.Join(tmpDir, "go.mod"), []byte("module test"), 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	if runner.Name != "go" {
		t.Errorf("Expected go runner, got %s", runner.Name)
	}
	if runner.Command != "go" {
		t.Errorf("Expected go command, got %s", runner.Command)
	}
}

func TestDetectTestRunner_Pytest(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-detect-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create pytest.ini
	if err := os.WriteFile(filepath.Join(tmpDir, "pytest.ini"), []byte("[pytest]"), 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	if runner.Name != "pytest" {
		t.Errorf("Expected pytest runner, got %s", runner.Name)
	}
	if runner.Command != "pytest" {
		t.Errorf("Expected pytest command, got %s", runner.Command)
	}
}

func TestDetectTestRunner_Cargo(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-detect-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create Cargo.toml
	if err := os.WriteFile(filepath.Join(tmpDir, "Cargo.toml"), []byte("[package]"), 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	if runner.Name != "cargo" {
		t.Errorf("Expected cargo runner, got %s", runner.Name)
	}
	if runner.Command != "cargo" {
		t.Errorf("Expected cargo command, got %s", runner.Command)
	}
}

func TestDetectTestRunner_PackageJSON_Vitest(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-detect-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create package.json with vitest
	pkg := map[string]interface{}{
		"devDependencies": map[string]string{
			"vitest": "^1.0.0",
		},
	}
	data, _ := json.Marshal(pkg)
	if err := os.WriteFile(filepath.Join(tmpDir, "package.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	if runner.Name != "vitest" {
		t.Errorf("Expected vitest runner, got %s", runner.Name)
	}
}

func TestDetectTestRunner_PackageJSON_Jest(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-detect-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create package.json with jest
	pkg := map[string]interface{}{
		"devDependencies": map[string]string{
			"jest": "^29.0.0",
		},
	}
	data, _ := json.Marshal(pkg)
	if err := os.WriteFile(filepath.Join(tmpDir, "package.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	if runner.Name != "jest" {
		t.Errorf("Expected jest runner, got %s", runner.Name)
	}
}

func TestDetectTestRunner_PackageJSON_Mocha(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-detect-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create package.json with mocha
	pkg := map[string]interface{}{
		"devDependencies": map[string]string{
			"mocha": "^10.0.0",
		},
	}
	data, _ := json.Marshal(pkg)
	if err := os.WriteFile(filepath.Join(tmpDir, "package.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	if runner.Name != "mocha" {
		t.Errorf("Expected mocha runner, got %s", runner.Name)
	}
}

func TestDetectTestRunner_Fallback(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-detect-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Empty directory - should fall back to npm
	runner := DetectTestRunner(tmpDir)
	if runner.Name != "npm" {
		t.Errorf("Expected npm runner as fallback, got %s", runner.Name)
	}
}

func TestBuildTestCommand_Vitest(t *testing.T) {
	runner := &TestRunner{
		Name:    "vitest",
		Command: "npx",
		Args:    []string{"vitest", "run"},
	}

	// Basic
	cmd := runner.BuildTestCommand("", false, false)
	expected := "npx vitest run"
	if cmd != expected {
		t.Errorf("Expected '%s', got '%s'", expected, cmd)
	}

	// With pattern
	cmd = runner.BuildTestCommand("auth", false, false)
	expected = "npx vitest run auth"
	if cmd != expected {
		t.Errorf("Expected '%s', got '%s'", expected, cmd)
	}

	// Watch mode
	runner = &TestRunner{
		Name:    "vitest",
		Command: "npx",
		Args:    []string{"vitest", "run"},
	}
	cmd = runner.BuildTestCommand("", true, false)
	expected = "npx vitest"
	if cmd != expected {
		t.Errorf("Expected '%s' for watch mode, got '%s'", expected, cmd)
	}

	// Coverage
	runner = &TestRunner{
		Name:    "vitest",
		Command: "npx",
		Args:    []string{"vitest", "run"},
	}
	cmd = runner.BuildTestCommand("", false, true)
	expected = "npx vitest run --coverage"
	if cmd != expected {
		t.Errorf("Expected '%s' for coverage, got '%s'", expected, cmd)
	}
}

func TestBuildTestCommand_Jest(t *testing.T) {
	runner := &TestRunner{
		Name:    "jest",
		Command: "npx",
		Args:    []string{"jest"},
	}

	// Basic
	cmd := runner.BuildTestCommand("", false, false)
	expected := "npx jest"
	if cmd != expected {
		t.Errorf("Expected '%s', got '%s'", expected, cmd)
	}

	// With pattern
	cmd = runner.BuildTestCommand("auth", false, false)
	expected = "npx jest auth"
	if cmd != expected {
		t.Errorf("Expected '%s', got '%s'", expected, cmd)
	}

	// Watch
	runner = &TestRunner{
		Name:    "jest",
		Command: "npx",
		Args:    []string{"jest"},
	}
	cmd = runner.BuildTestCommand("", true, false)
	expected = "npx jest --watch"
	if cmd != expected {
		t.Errorf("Expected '%s', got '%s'", expected, cmd)
	}

	// Coverage
	runner = &TestRunner{
		Name:    "jest",
		Command: "npx",
		Args:    []string{"jest"},
	}
	cmd = runner.BuildTestCommand("", false, true)
	expected = "npx jest --coverage"
	if cmd != expected {
		t.Errorf("Expected '%s', got '%s'", expected, cmd)
	}
}

func TestBuildTestCommand_Pytest(t *testing.T) {
	runner := &TestRunner{
		Name:    "pytest",
		Command: "pytest",
		Args:    []string{"-v"},
	}

	// Basic
	cmd := runner.BuildTestCommand("", false, false)
	expected := "pytest -v"
	if cmd != expected {
		t.Errorf("Expected '%s', got '%s'", expected, cmd)
	}

	// With pattern
	runner = &TestRunner{
		Name:    "pytest",
		Command: "pytest",
		Args:    []string{"-v"},
	}
	cmd = runner.BuildTestCommand("test_auth", false, false)
	expected = "pytest -v -k test_auth"
	if cmd != expected {
		t.Errorf("Expected '%s', got '%s'", expected, cmd)
	}

	// Coverage
	runner = &TestRunner{
		Name:    "pytest",
		Command: "pytest",
		Args:    []string{"-v"},
	}
	cmd = runner.BuildTestCommand("", false, true)
	expected = "pytest -v --cov"
	if cmd != expected {
		t.Errorf("Expected '%s', got '%s'", expected, cmd)
	}
}

func TestBuildTestCommand_Go(t *testing.T) {
	runner := &TestRunner{
		Name:    "go",
		Command: "go",
		Args:    []string{"test", "-v", "./..."},
	}

	// Basic
	cmd := runner.BuildTestCommand("", false, false)
	expected := "go test -v ./..."
	if cmd != expected {
		t.Errorf("Expected '%s', got '%s'", expected, cmd)
	}

	// With pattern
	runner = &TestRunner{
		Name:    "go",
		Command: "go",
		Args:    []string{"test", "-v", "./..."},
	}
	cmd = runner.BuildTestCommand("TestAuth", false, false)
	expected = "go test -v ./... -run TestAuth"
	if cmd != expected {
		t.Errorf("Expected '%s', got '%s'", expected, cmd)
	}

	// Coverage
	runner = &TestRunner{
		Name:    "go",
		Command: "go",
		Args:    []string{"test", "-v", "./..."},
	}
	cmd = runner.BuildTestCommand("", false, true)
	expected = "go test -v ./... -cover"
	if cmd != expected {
		t.Errorf("Expected '%s', got '%s'", expected, cmd)
	}
}

func TestGetRunnerByName(t *testing.T) {
	tests := []struct {
		name         string
		expectedName string
		expectedCmd  string
	}{
		{"vitest", "vitest", "npx"},
		{"jest", "jest", "npx"},
		{"pytest", "pytest", "pytest"},
		{"go", "go", "go"},
		{"cargo", "cargo", "cargo"},
		{"npm", "npm", "npm"},
		{"unknown", "npm", "npm"}, // Unknown defaults to npm
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			runner := GetRunnerByName(tc.name)
			if runner.Name != tc.expectedName {
				t.Errorf("Expected name '%s', got '%s'", tc.expectedName, runner.Name)
			}
			if runner.Command != tc.expectedCmd {
				t.Errorf("Expected command '%s', got '%s'", tc.expectedCmd, runner.Command)
			}
		})
	}
}

func TestTestRunner_Priority(t *testing.T) {
	// Test that vitest has higher priority than jest when both are present
	tmpDir, err := os.MkdirTemp("", "test-priority-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create package.json with both vitest and jest
	pkg := map[string]interface{}{
		"devDependencies": map[string]string{
			"jest":   "^29.0.0",
			"vitest": "^1.0.0",
		},
	}
	data, _ := json.Marshal(pkg)
	if err := os.WriteFile(filepath.Join(tmpDir, "package.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	if runner.Name != "vitest" {
		t.Errorf("Expected vitest to have priority, got %s", runner.Name)
	}
}

func TestDetectTestRunner_ConfigOverPackageJSON(t *testing.T) {
	// Test that config file has priority over package.json
	tmpDir, err := os.MkdirTemp("", "test-config-priority-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create vitest config file
	if err := os.WriteFile(filepath.Join(tmpDir, "vitest.config.ts"), []byte(""), 0644); err != nil {
		t.Fatal(err)
	}

	// Create package.json with jest
	pkg := map[string]interface{}{
		"devDependencies": map[string]string{
			"jest": "^29.0.0",
		},
	}
	data, _ := json.Marshal(pkg)
	if err := os.WriteFile(filepath.Join(tmpDir, "package.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	if runner.Name != "vitest" {
		t.Errorf("Expected vitest config to take priority, got %s", runner.Name)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Edge Case Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestDetectTestRunner_MalformedPackageJSON(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-malformed-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create malformed package.json
	if err := os.WriteFile(filepath.Join(tmpDir, "package.json"), []byte("{invalid json}"), 0644); err != nil {
		t.Fatal(err)
	}

	// Should fall back to npm without crashing
	runner := DetectTestRunner(tmpDir)
	if runner.Name != "npm" {
		t.Errorf("Expected npm fallback for malformed package.json, got %s", runner.Name)
	}
}

func TestDetectTestRunner_EmptyPackageJSON(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-empty-pkg-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create empty package.json
	if err := os.WriteFile(filepath.Join(tmpDir, "package.json"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	if runner.Name != "npm" {
		t.Errorf("Expected npm fallback for empty package.json, got %s", runner.Name)
	}
}

func TestDetectTestRunner_PackageJSON_Dependencies(t *testing.T) {
	// Test runner in dependencies instead of devDependencies
	tmpDir, err := os.MkdirTemp("", "test-deps-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	pkg := map[string]interface{}{
		"dependencies": map[string]string{
			"vitest": "^1.0.0",
		},
	}
	data, _ := json.Marshal(pkg)
	if err := os.WriteFile(filepath.Join(tmpDir, "package.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	if runner.Name != "vitest" {
		t.Errorf("Expected vitest from dependencies, got %s", runner.Name)
	}
}

func TestDetectTestRunner_AllVitestConfigExtensions(t *testing.T) {
	configs := []string{
		"vitest.config.ts",
		"vitest.config.js",
		"vitest.config.mts",
		"vitest.config.mjs",
	}

	for _, config := range configs {
		t.Run(config, func(t *testing.T) {
			tmpDir, err := os.MkdirTemp("", "test-vitest-*")
			if err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(tmpDir)

			if err := os.WriteFile(filepath.Join(tmpDir, config), []byte(""), 0644); err != nil {
				t.Fatal(err)
			}

			runner := DetectTestRunner(tmpDir)
			if runner.Name != "vitest" {
				t.Errorf("Expected vitest for %s, got %s", config, runner.Name)
			}
		})
	}
}

func TestDetectTestRunner_AllJestConfigExtensions(t *testing.T) {
	configs := []string{
		"jest.config.ts",
		"jest.config.js",
		"jest.config.mjs",
		"jest.config.cjs",
		"jest.config.json",
	}

	for _, config := range configs {
		t.Run(config, func(t *testing.T) {
			tmpDir, err := os.MkdirTemp("", "test-jest-*")
			if err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(tmpDir)

			if err := os.WriteFile(filepath.Join(tmpDir, config), []byte(""), 0644); err != nil {
				t.Fatal(err)
			}

			runner := DetectTestRunner(tmpDir)
			if runner.Name != "jest" {
				t.Errorf("Expected jest for %s, got %s", config, runner.Name)
			}
		})
	}
}

func TestDetectTestRunner_PyprojectToml(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-pyproject-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create pyproject.toml
	if err := os.WriteFile(filepath.Join(tmpDir, "pyproject.toml"), []byte("[tool.pytest]"), 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	if runner.Name != "pytest" {
		t.Errorf("Expected pytest for pyproject.toml, got %s", runner.Name)
	}
}

func TestDetectTestRunner_SetupPy(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-setup-py-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create setup.py
	if err := os.WriteFile(filepath.Join(tmpDir, "setup.py"), []byte("from setuptools import setup"), 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	if runner.Name != "pytest" {
		t.Errorf("Expected pytest for setup.py, got %s", runner.Name)
	}
}

func TestDetectTestRunner_NpmTestScript(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-npm-script-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create package.json with custom test script
	pkg := map[string]interface{}{
		"scripts": map[string]string{
			"test": "mocha --recursive",
		},
	}
	data, _ := json.Marshal(pkg)
	if err := os.WriteFile(filepath.Join(tmpDir, "package.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	// Should detect npm test since there's a custom test script
	if runner.Name != "npm" {
		t.Errorf("Expected npm for custom test script, got %s", runner.Name)
	}
}

func TestDetectTestRunner_DefaultTestScript(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-default-script-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	// Create package.json with default npm test error
	pkg := map[string]interface{}{
		"scripts": map[string]string{
			"test": "echo \"Error: no test specified\" && exit 1",
		},
	}
	data, _ := json.Marshal(pkg)
	if err := os.WriteFile(filepath.Join(tmpDir, "package.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	// Should fall back to npm since no runner detected
	if runner.Name != "npm" {
		t.Errorf("Expected npm fallback for default test script, got %s", runner.Name)
	}
}

func TestDetectTestRunner_PackageJSON_Ava(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-ava-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	pkg := map[string]interface{}{
		"devDependencies": map[string]string{
			"ava": "^5.0.0",
		},
	}
	data, _ := json.Marshal(pkg)
	if err := os.WriteFile(filepath.Join(tmpDir, "package.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	if runner.Name != "ava" {
		t.Errorf("Expected ava runner, got %s", runner.Name)
	}
}

func TestDetectTestRunner_PackageJSON_Tap(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-tap-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	pkg := map[string]interface{}{
		"devDependencies": map[string]string{
			"tap": "^16.0.0",
		},
	}
	data, _ := json.Marshal(pkg)
	if err := os.WriteFile(filepath.Join(tmpDir, "package.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	runner := DetectTestRunner(tmpDir)
	if runner.Name != "tap" {
		t.Errorf("Expected tap runner, got %s", runner.Name)
	}
}

func TestDetectTestRunner_NonexistentDirectory(t *testing.T) {
	// Testing with a path that doesn't exist
	runner := DetectTestRunner("/nonexistent/path/that/does/not/exist")
	// Should fall back to npm
	if runner.Name != "npm" {
		t.Errorf("Expected npm fallback for nonexistent directory, got %s", runner.Name)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// BuildTestCommand Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

func TestBuildTestCommand_Mocha(t *testing.T) {
	runner := &TestRunner{
		Name:    "mocha",
		Command: "npx",
		Args:    []string{"mocha"},
	}

	// Basic
	cmd := runner.BuildTestCommand("", false, false)
	if cmd != "npx mocha" {
		t.Errorf("Expected 'npx mocha', got '%s'", cmd)
	}

	// Watch
	runner = &TestRunner{Name: "mocha", Command: "npx", Args: []string{"mocha"}}
	cmd = runner.BuildTestCommand("", true, false)
	if cmd != "npx mocha --watch" {
		t.Errorf("Expected 'npx mocha --watch', got '%s'", cmd)
	}

	// Pattern
	runner = &TestRunner{Name: "mocha", Command: "npx", Args: []string{"mocha"}}
	cmd = runner.BuildTestCommand("auth", false, false)
	if cmd != "npx mocha --grep auth" {
		t.Errorf("Expected 'npx mocha --grep auth', got '%s'", cmd)
	}
}

func TestBuildTestCommand_Cargo(t *testing.T) {
	runner := &TestRunner{
		Name:    "cargo",
		Command: "cargo",
		Args:    []string{"test"},
	}

	// Basic
	cmd := runner.BuildTestCommand("", false, false)
	if cmd != "cargo test" {
		t.Errorf("Expected 'cargo test', got '%s'", cmd)
	}

	// Pattern
	runner = &TestRunner{Name: "cargo", Command: "cargo", Args: []string{"test"}}
	cmd = runner.BuildTestCommand("test_auth", false, false)
	if cmd != "cargo test -- test_auth" {
		t.Errorf("Expected 'cargo test -- test_auth', got '%s'", cmd)
	}
}

func TestBuildTestCommand_Npm(t *testing.T) {
	runner := &TestRunner{
		Name:    "npm",
		Command: "npm",
		Args:    []string{"test"},
	}

	// Basic
	cmd := runner.BuildTestCommand("", false, false)
	if cmd != "npm test" {
		t.Errorf("Expected 'npm test', got '%s'", cmd)
	}

	// Pattern
	runner = &TestRunner{Name: "npm", Command: "npm", Args: []string{"test"}}
	cmd = runner.BuildTestCommand("auth", false, false)
	if cmd != "npm test -- auth" {
		t.Errorf("Expected 'npm test -- auth', got '%s'", cmd)
	}
}

func TestBuildTestCommand_Ava(t *testing.T) {
	runner := &TestRunner{
		Name:    "ava",
		Command: "npx",
		Args:    []string{"ava"},
	}

	// Basic
	cmd := runner.BuildTestCommand("", false, false)
	if cmd != "npx ava" {
		t.Errorf("Expected 'npx ava', got '%s'", cmd)
	}

	// Watch
	runner = &TestRunner{Name: "ava", Command: "npx", Args: []string{"ava"}}
	cmd = runner.BuildTestCommand("", true, false)
	if cmd != "npx ava --watch" {
		t.Errorf("Expected 'npx ava --watch', got '%s'", cmd)
	}

	// Pattern
	runner = &TestRunner{Name: "ava", Command: "npx", Args: []string{"ava"}}
	cmd = runner.BuildTestCommand("auth", false, false)
	if cmd != "npx ava --match auth" {
		t.Errorf("Expected 'npx ava --match auth', got '%s'", cmd)
	}
}

func TestBuildTestCommand_Tap(t *testing.T) {
	runner := &TestRunner{
		Name:    "tap",
		Command: "npx",
		Args:    []string{"tap"},
	}

	// Basic
	cmd := runner.BuildTestCommand("", false, false)
	if cmd != "npx tap" {
		t.Errorf("Expected 'npx tap', got '%s'", cmd)
	}

	// Coverage
	runner = &TestRunner{Name: "tap", Command: "npx", Args: []string{"tap"}}
	cmd = runner.BuildTestCommand("", false, true)
	if cmd != "npx tap --coverage" {
		t.Errorf("Expected 'npx tap --coverage', got '%s'", cmd)
	}

	// Pattern
	runner = &TestRunner{Name: "tap", Command: "npx", Args: []string{"tap"}}
	cmd = runner.BuildTestCommand("auth.test.js", false, false)
	if cmd != "npx tap auth.test.js" {
		t.Errorf("Expected 'npx tap auth.test.js', got '%s'", cmd)
	}
}

func TestBuildTestCommand_AllCombinations(t *testing.T) {
	// Test various combinations of flags
	tests := []struct {
		runner   string
		pattern  string
		watch    bool
		coverage bool
	}{
		{"vitest", "", false, false},
		{"vitest", "auth", false, false},
		{"vitest", "", true, false},
		{"vitest", "", false, true},
		{"vitest", "auth", true, true},
		{"jest", "", false, false},
		{"jest", "login", true, false},
		{"jest", "", false, true},
		{"pytest", "", false, false},
		{"pytest", "test_login", false, true},
		{"go", "", false, false},
		{"go", "TestAuth", false, true},
	}

	for _, tc := range tests {
		t.Run(tc.runner+"_"+tc.pattern, func(t *testing.T) {
			runner := GetRunnerByName(tc.runner)
			cmd := runner.BuildTestCommand(tc.pattern, tc.watch, tc.coverage)
			// Just verify it doesn't panic and returns something
			if cmd == "" {
				t.Errorf("BuildTestCommand returned empty string")
			}
		})
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// GetRunnerByName Extended Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestGetRunnerByName_AllRunners(t *testing.T) {
	runners := []string{"vitest", "jest", "mocha", "pytest", "go", "cargo", "npm", "ava", "tap"}

	for _, name := range runners {
		t.Run(name, func(t *testing.T) {
			runner := GetRunnerByName(name)
			if runner == nil {
				t.Fatalf("GetRunnerByName(%s) returned nil", name)
			}
			if runner.Name != name {
				// npm is the fallback for unknown, so skip name check for npm
				if name != "npm" || runner.Name != "npm" {
					t.Errorf("Expected name %s, got %s", name, runner.Name)
				}
			}
			if runner.Command == "" {
				t.Errorf("Runner %s has empty command", name)
			}
			if len(runner.Args) == 0 {
				t.Errorf("Runner %s has no args", name)
			}
		})
	}
}

func TestGetRunnerByName_CaseSensitivity(t *testing.T) {
	// Test that runner names are case-sensitive
	runner := GetRunnerByName("VITEST")
	if runner.Name != "npm" {
		t.Errorf("Expected npm fallback for uppercase VITEST, got %s", runner.Name)
	}

	runner = GetRunnerByName("Vitest")
	if runner.Name != "npm" {
		t.Errorf("Expected npm fallback for mixed case Vitest, got %s", runner.Name)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// TestRunner Structure Tests
// ═══════════════════════════════════════════════════════════════════════════════

func TestTestRunner_Immutability(t *testing.T) {
	// Test that BuildTestCommand doesn't modify the original runner
	runner := &TestRunner{
		Name:    "vitest",
		Command: "npx",
		Args:    []string{"vitest", "run"},
	}

	originalLen := len(runner.Args)

	// Call BuildTestCommand multiple times with different options
	runner.BuildTestCommand("pattern1", false, false)
	runner.BuildTestCommand("pattern2", true, true)
	runner.BuildTestCommand("", false, true)

	// Original should be unchanged
	if len(runner.Args) != originalLen {
		t.Errorf("BuildTestCommand modified original Args: expected len %d, got %d", originalLen, len(runner.Args))
	}
}

func TestTestRunner_EmptyArgs(t *testing.T) {
	runner := &TestRunner{
		Name:    "custom",
		Command: "custom-runner",
		Args:    []string{},
	}

	cmd := runner.BuildTestCommand("", false, false)
	if cmd != "custom-runner " {
		t.Errorf("Expected 'custom-runner ', got '%s'", cmd)
	}
}
