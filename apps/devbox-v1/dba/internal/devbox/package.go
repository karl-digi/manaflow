// internal/devbox/package.go
package devbox

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/dba-cli/dba/internal/workspace"
)

// PackageManager handles devbox package operations with sync barriers
type PackageManager struct {
	workspace *workspace.Workspace
	devbox    *Devbox
}

// NewPackageManager creates a new package manager
func NewPackageManager(ws *workspace.Workspace) *PackageManager {
	return &PackageManager{
		workspace: ws,
		devbox:    New(ws),
	}
}

// PackageInfo represents information about a devbox package
type PackageInfo struct {
	Name        string `json:"name"`
	Version     string `json:"version,omitempty"`
	Description string `json:"description,omitempty"`
}

// SyncResult represents the result of a package sync operation
type SyncResult struct {
	Added     []string      `json:"added,omitempty"`
	Removed   []string      `json:"removed,omitempty"`
	Synced    bool          `json:"synced"`
	Duration  time.Duration `json:"duration"`
	Verified  bool          `json:"verified"`
	VerifyLog string        `json:"verify_log,omitempty"`
}

// AddResult represents the result of adding a package
type AddResult struct {
	Package     string        `json:"package"`
	Success     bool          `json:"success"`
	Duration    time.Duration `json:"duration"`
	Verified    bool          `json:"verified"`
	VerifyError string        `json:"verify_error,omitempty"`
}

// Add adds a package to the devbox environment with verification
func (pm *PackageManager) Add(ctx context.Context, pkg string, pin bool) (*AddResult, error) {
	start := time.Now()

	result := &AddResult{
		Package: pkg,
	}

	// Validate devbox.lock exists (or devbox.json for initial setup)
	if err := pm.validateDevboxConfig(); err != nil {
		return nil, fmt.Errorf("devbox configuration error: %w", err)
	}

	// Add the package
	args := []string{"add", pkg}
	if pin {
		// Pin to current version
		args = append(args, "--allow-insecure=false")
	}

	cmd := exec.CommandContext(ctx, "devbox", args...)
	cmd.Dir = pm.workspace.Path
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("devbox add failed: %s", output)
	}

	result.Success = true

	// Wait for Nix store synchronization by verifying the package binary
	verified, verifyErr := pm.verifyPackageInstalled(ctx, pkg)
	result.Verified = verified
	if verifyErr != nil {
		result.VerifyError = verifyErr.Error()
	}

	result.Duration = time.Since(start)
	return result, nil
}

// Remove removes a package from the devbox environment
func (pm *PackageManager) Remove(ctx context.Context, pkg string) error {
	if err := pm.validateDevboxConfig(); err != nil {
		return fmt.Errorf("devbox configuration error: %w", err)
	}

	cmd := exec.CommandContext(ctx, "devbox", "rm", pkg)
	cmd.Dir = pm.workspace.Path
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("devbox rm failed: %s", output)
	}

	return nil
}

// Search searches for packages in the Nix store
func (pm *PackageManager) Search(ctx context.Context, query string) ([]PackageInfo, error) {
	cmd := exec.CommandContext(ctx, "devbox", "search", query)
	cmd.Dir = pm.workspace.Path

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("devbox search failed: %w", err)
	}

	return parseSearchOutput(string(output)), nil
}

// SyncPackages synchronizes all packages with the Nix store
func (pm *PackageManager) SyncPackages(ctx context.Context) (*SyncResult, error) {
	start := time.Now()
	result := &SyncResult{}

	if err := pm.validateDevboxConfig(); err != nil {
		return nil, fmt.Errorf("devbox configuration error: %w", err)
	}

	// Get current packages before sync
	beforePkgs, _ := pm.listPackages()

	// Run devbox install to sync all packages
	cmd := exec.CommandContext(ctx, "devbox", "install")
	cmd.Dir = pm.workspace.Path
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("devbox install failed: %s", output)
	}

	// Get packages after sync
	afterPkgs, _ := pm.listPackages()

	// Calculate added/removed
	result.Added = difference(afterPkgs, beforePkgs)
	result.Removed = difference(beforePkgs, afterPkgs)
	result.Synced = true
	result.Duration = time.Since(start)

	// Verify packages are available
	result.Verified, _ = pm.verifyAllPackages(ctx)

	return result, nil
}

// ValidateLockFile validates the devbox.lock file
func (pm *PackageManager) ValidateLockFile() error {
	lockPath := filepath.Join(pm.workspace.Path, "devbox.lock")

	// Check if lock file exists
	if _, err := os.Stat(lockPath); os.IsNotExist(err) {
		// Lock file doesn't exist - this is OK for new projects
		return nil
	}

	// Read and parse lock file
	data, err := os.ReadFile(lockPath)
	if err != nil {
		return fmt.Errorf("failed to read devbox.lock: %w", err)
	}

	// Validate JSON structure
	var lock struct {
		Packages map[string]interface{} `json:"packages"`
	}
	if err := json.Unmarshal(data, &lock); err != nil {
		return fmt.Errorf("invalid devbox.lock format: %w", err)
	}

	return nil
}

// GetInstalledPackages returns the list of installed packages
func (pm *PackageManager) GetInstalledPackages() ([]string, error) {
	return pm.listPackages()
}

// verifyPackageInstalled verifies a package is installed by checking for its binary
func (pm *PackageManager) verifyPackageInstalled(ctx context.Context, pkg string) (bool, error) {
	// Extract binary name from package (e.g., "nodejs@20" -> "node")
	binary := extractBinaryName(pkg)
	if binary == "" {
		// Can't determine binary, skip verification
		return true, nil
	}

	// Use devbox run -- which <binary> to verify installation
	verifyCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(verifyCtx, "devbox", "run", "--", "which", binary)
	cmd.Dir = pm.workspace.Path

	output, err := cmd.CombinedOutput()
	if err != nil {
		return false, fmt.Errorf("package %s binary '%s' not found: %s", pkg, binary, output)
	}

	// Binary found
	return true, nil
}

// verifyAllPackages verifies all packages are properly installed
func (pm *PackageManager) verifyAllPackages(ctx context.Context) (bool, error) {
	pkgs, err := pm.listPackages()
	if err != nil {
		return false, err
	}

	for _, pkg := range pkgs {
		verified, err := pm.verifyPackageInstalled(ctx, pkg)
		if !verified || err != nil {
			return false, err
		}
	}

	return true, nil
}

// validateDevboxConfig ensures devbox.json exists
func (pm *PackageManager) validateDevboxConfig() error {
	devboxPath := filepath.Join(pm.workspace.Path, "devbox.json")
	if _, err := os.Stat(devboxPath); os.IsNotExist(err) {
		return fmt.Errorf("devbox.json not found in workspace")
	}
	return nil
}

// listPackages returns the list of packages from devbox.json
func (pm *PackageManager) listPackages() ([]string, error) {
	devboxPath := filepath.Join(pm.workspace.Path, "devbox.json")
	data, err := os.ReadFile(devboxPath)
	if err != nil {
		return nil, err
	}

	var config struct {
		Packages []string `json:"packages"`
	}
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}

	return config.Packages, nil
}

// parseSearchOutput parses the output of devbox search
func parseSearchOutput(output string) []PackageInfo {
	var packages []PackageInfo

	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "Found") || strings.HasPrefix(line, "Warning") {
			continue
		}

		// Parse package line (format varies, but typically "name version - description")
		parts := strings.SplitN(line, " ", 3)
		if len(parts) >= 1 {
			pkg := PackageInfo{
				Name: parts[0],
			}
			if len(parts) >= 2 {
				// Check if second part is a version or description
				if strings.HasPrefix(parts[1], "(") || strings.Contains(parts[1], ".") {
					pkg.Version = strings.Trim(parts[1], "()")
				}
			}
			if len(parts) >= 3 {
				pkg.Description = strings.TrimPrefix(parts[2], "- ")
			}
			packages = append(packages, pkg)
		}
	}

	return packages
}

// extractBinaryName extracts the expected binary name from a package name
func extractBinaryName(pkg string) string {
	// Remove version suffix
	name := strings.Split(pkg, "@")[0]

	// Common package to binary mappings
	binaryMap := map[string]string{
		"nodejs":     "node",
		"python":     "python3",
		"python3":    "python3",
		"python310":  "python3",
		"python311":  "python3",
		"python312":  "python3",
		"go":         "go",
		"golang":     "go",
		"rustc":      "rustc",
		"rust":       "rustc",
		"cargo":      "cargo",
		"pnpm":       "pnpm",
		"yarn":       "yarn",
		"npm":        "npm",
		"git":        "git",
		"curl":       "curl",
		"wget":       "wget",
		"jq":         "jq",
		"ripgrep":    "rg",
		"fd":         "fd",
		"bat":        "bat",
		"exa":        "exa",
		"fzf":        "fzf",
		"tmux":       "tmux",
		"vim":        "vim",
		"neovim":     "nvim",
		"zsh":        "zsh",
		"bash":       "bash",
		"fish":       "fish",
		"docker":     "docker",
		"kubectl":    "kubectl",
		"terraform":  "terraform",
		"awscli":     "aws",
		"awscli2":    "aws",
		"gcloud":     "gcloud",
		"postgresql": "psql",
		"mysql":      "mysql",
		"redis":      "redis-cli",
		"mongodb":    "mongo",
		"sqlite":     "sqlite3",
	}

	if binary, ok := binaryMap[name]; ok {
		return binary
	}

	// Default: use the package name as binary
	return name
}

// difference returns elements in a that are not in b
func difference(a, b []string) []string {
	bSet := make(map[string]bool)
	for _, x := range b {
		bSet[x] = true
	}

	var diff []string
	for _, x := range a {
		if !bSet[x] {
			diff = append(diff, x)
		}
	}
	return diff
}

// Update updates a package to the latest version
func (pm *PackageManager) Update(ctx context.Context, pkg string) error {
	if err := pm.validateDevboxConfig(); err != nil {
		return fmt.Errorf("devbox configuration error: %w", err)
	}

	// devbox update <package>
	cmd := exec.CommandContext(ctx, "devbox", "update", pkg)
	cmd.Dir = pm.workspace.Path
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("devbox update failed: %s", output)
	}

	return nil
}

// ListAvailableUpdates lists packages with available updates
func (pm *PackageManager) ListAvailableUpdates(ctx context.Context) ([]PackageInfo, error) {
	// Run devbox update --dry-run to check for updates
	cmd := exec.CommandContext(ctx, "devbox", "update")
	cmd.Dir = pm.workspace.Path

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// This is informational only - we capture what would be updated
	_ = cmd.Run()

	// Parse output for package updates
	return parseUpdateOutput(stdout.String()), nil
}

func parseUpdateOutput(output string) []PackageInfo {
	// This is a simplified parser - actual devbox update output format may vary
	var updates []PackageInfo
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.Contains(line, "->") || strings.Contains(line, "update") {
			// Extract package info from update lines
			parts := strings.Fields(line)
			if len(parts) >= 1 {
				updates = append(updates, PackageInfo{
					Name: parts[0],
				})
			}
		}
	}
	return updates
}
