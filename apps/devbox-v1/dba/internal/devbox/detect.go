// internal/devbox/detect.go
package devbox

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// TestRunner represents a detected test runner
type TestRunner struct {
	Name    string   // Runner name (vitest, jest, pytest, go, cargo, npm)
	Command string   // Main command (npx, go, pytest, cargo, npm)
	Args    []string // Default arguments
}

// DetectTestRunner detects the test runner for a project
func DetectTestRunner(projectPath string) *TestRunner {
	// Check for vitest config first (highest priority for JS projects)
	vitestConfigs := []string{
		"vitest.config.ts",
		"vitest.config.js",
		"vitest.config.mts",
		"vitest.config.mjs",
	}
	for _, config := range vitestConfigs {
		if _, err := os.Stat(filepath.Join(projectPath, config)); err == nil {
			return &TestRunner{
				Name:    "vitest",
				Command: "npx",
				Args:    []string{"vitest", "run"},
			}
		}
	}

	// Check for jest config
	jestConfigs := []string{
		"jest.config.ts",
		"jest.config.js",
		"jest.config.mjs",
		"jest.config.cjs",
		"jest.config.json",
	}
	for _, config := range jestConfigs {
		if _, err := os.Stat(filepath.Join(projectPath, config)); err == nil {
			return &TestRunner{
				Name:    "jest",
				Command: "npx",
				Args:    []string{"jest"},
			}
		}
	}

	// Check package.json for Node.js projects
	pkgPath := filepath.Join(projectPath, "package.json")
	if _, err := os.Stat(pkgPath); err == nil {
		runner := detectNodeTestRunner(pkgPath)
		if runner != nil {
			return runner
		}
	}

	// Check for Go
	if _, err := os.Stat(filepath.Join(projectPath, "go.mod")); err == nil {
		return &TestRunner{
			Name:    "go",
			Command: "go",
			Args:    []string{"test", "-v", "./..."},
		}
	}

	// Check for Python (pytest)
	if _, err := os.Stat(filepath.Join(projectPath, "pyproject.toml")); err == nil {
		// Check if pytest is configured in pyproject.toml
		return &TestRunner{
			Name:    "pytest",
			Command: "pytest",
			Args:    []string{"-v"},
		}
	}
	if _, err := os.Stat(filepath.Join(projectPath, "pytest.ini")); err == nil {
		return &TestRunner{
			Name:    "pytest",
			Command: "pytest",
			Args:    []string{"-v"},
		}
	}
	if _, err := os.Stat(filepath.Join(projectPath, "setup.py")); err == nil {
		return &TestRunner{
			Name:    "pytest",
			Command: "pytest",
			Args:    []string{"-v"},
		}
	}

	// Check for Rust
	if _, err := os.Stat(filepath.Join(projectPath, "Cargo.toml")); err == nil {
		return &TestRunner{
			Name:    "cargo",
			Command: "cargo",
			Args:    []string{"test"},
		}
	}

	// Default to npm test if package.json exists
	if _, err := os.Stat(pkgPath); err == nil {
		return &TestRunner{
			Name:    "npm",
			Command: "npm",
			Args:    []string{"test"},
		}
	}

	// Fallback to npm test
	return &TestRunner{
		Name:    "npm",
		Command: "npm",
		Args:    []string{"test"},
	}
}

// detectNodeTestRunner detects test runner from package.json
func detectNodeTestRunner(pkgPath string) *TestRunner {
	data, err := os.ReadFile(pkgPath)
	if err != nil {
		return nil
	}

	var pkg struct {
		Scripts struct {
			Test string `json:"test"`
		} `json:"scripts"`
		DevDependencies map[string]string `json:"devDependencies"`
		Dependencies    map[string]string `json:"dependencies"`
	}

	if err := json.Unmarshal(data, &pkg); err != nil {
		return nil
	}

	// Check for specific test runners in dependencies
	allDeps := make(map[string]bool)
	for k := range pkg.DevDependencies {
		allDeps[k] = true
	}
	for k := range pkg.Dependencies {
		allDeps[k] = true
	}

	// Priority: vitest > jest > mocha > ava > tap
	if allDeps["vitest"] {
		return &TestRunner{
			Name:    "vitest",
			Command: "npx",
			Args:    []string{"vitest", "run"},
		}
	}

	if allDeps["jest"] {
		return &TestRunner{
			Name:    "jest",
			Command: "npx",
			Args:    []string{"jest"},
		}
	}

	if allDeps["mocha"] {
		return &TestRunner{
			Name:    "mocha",
			Command: "npx",
			Args:    []string{"mocha"},
		}
	}

	if allDeps["ava"] {
		return &TestRunner{
			Name:    "ava",
			Command: "npx",
			Args:    []string{"ava"},
		}
	}

	if allDeps["tap"] {
		return &TestRunner{
			Name:    "tap",
			Command: "npx",
			Args:    []string{"tap"},
		}
	}

	// Check if test script exists and is not the default
	if pkg.Scripts.Test != "" && pkg.Scripts.Test != "echo \"Error: no test specified\" && exit 1" {
		return &TestRunner{
			Name:    "npm",
			Command: "npm",
			Args:    []string{"test"},
		}
	}

	return nil
}

// BuildTestCommand builds the test command with optional pattern, watch, and coverage
func (r *TestRunner) BuildTestCommand(pattern string, watch bool, coverage bool) string {
	args := make([]string, len(r.Args))
	copy(args, r.Args)

	switch r.Name {
	case "vitest":
		if watch {
			// Remove "run" for watch mode in vitest
			for i, arg := range args {
				if arg == "run" {
					args = append(args[:i], args[i+1:]...)
					break
				}
			}
		}
		if coverage {
			args = append(args, "--coverage")
		}
		if pattern != "" {
			args = append(args, pattern)
		}

	case "jest":
		if watch {
			args = append(args, "--watch")
		}
		if coverage {
			args = append(args, "--coverage")
		}
		if pattern != "" {
			args = append(args, pattern)
		}

	case "mocha":
		if watch {
			args = append(args, "--watch")
		}
		if coverage {
			// Mocha needs nyc for coverage
			return "npx nyc mocha " + strings.Join(args[1:], " ")
		}
		if pattern != "" {
			args = append(args, "--grep", pattern)
		}

	case "pytest":
		if coverage {
			args = append(args, "--cov")
		}
		if pattern != "" {
			args = append(args, "-k", pattern)
		}
		// pytest doesn't have a built-in watch mode

	case "go":
		if coverage {
			args = append(args, "-cover")
		}
		if pattern != "" {
			args = append(args, "-run", pattern)
		}
		// go test doesn't have a built-in watch mode

	case "cargo":
		if pattern != "" {
			args = append(args, "--", pattern)
		}
		// cargo test doesn't have built-in coverage or watch

	case "npm":
		if pattern != "" {
			args = append(args, "--", pattern)
		}

	case "ava":
		if watch {
			args = append(args, "--watch")
		}
		if pattern != "" {
			args = append(args, "--match", pattern)
		}

	case "tap":
		if coverage {
			args = append(args, "--coverage")
		}
		if pattern != "" {
			args = append(args, pattern)
		}
	}

	return r.Command + " " + strings.Join(args, " ")
}

// GetRunnerByName returns a test runner by name with default configuration
func GetRunnerByName(name string) *TestRunner {
	runners := map[string]*TestRunner{
		"vitest": {
			Name:    "vitest",
			Command: "npx",
			Args:    []string{"vitest", "run"},
		},
		"jest": {
			Name:    "jest",
			Command: "npx",
			Args:    []string{"jest"},
		},
		"mocha": {
			Name:    "mocha",
			Command: "npx",
			Args:    []string{"mocha"},
		},
		"pytest": {
			Name:    "pytest",
			Command: "pytest",
			Args:    []string{"-v"},
		},
		"go": {
			Name:    "go",
			Command: "go",
			Args:    []string{"test", "-v", "./..."},
		},
		"cargo": {
			Name:    "cargo",
			Command: "cargo",
			Args:    []string{"test"},
		},
		"npm": {
			Name:    "npm",
			Command: "npm",
			Args:    []string{"test"},
		},
		"ava": {
			Name:    "ava",
			Command: "npx",
			Args:    []string{"ava"},
		},
		"tap": {
			Name:    "tap",
			Command: "npx",
			Args:    []string{"tap"},
		},
	}

	if runner, ok := runners[name]; ok {
		return runner
	}

	// Fallback to npm test
	return runners["npm"]
}
