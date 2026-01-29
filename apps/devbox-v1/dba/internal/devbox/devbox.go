// internal/devbox/devbox.go
package devbox

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/dba-cli/dba/internal/workspace"
)

// Devbox wraps devbox commands for a workspace
type Devbox struct {
	workspace *workspace.Workspace
}

// New creates a new Devbox wrapper
func New(ws *workspace.Workspace) *Devbox {
	return &Devbox{workspace: ws}
}

// RunResult contains the result of running a command
type RunResult struct {
	ExitCode   int    `json:"exit_code"`
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	DurationMs int64  `json:"duration_ms"`
	SyncWaitMs int64  `json:"sync_wait_ms,omitempty"`
	Synced     bool   `json:"synced,omitempty"`
}

// RunOptions are options for running a command
type RunOptions struct {
	Cwd   string            // Working directory relative to project
	Env   map[string]string // Additional environment variables
	Shell bool              // Run through shell (always true for devbox run)
}

// Install runs devbox install
func (d *Devbox) Install(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, "devbox", "install")
	cmd.Dir = d.workspace.Path
	cmd.Env = d.buildEnv()
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// Run runs a command in the devbox environment
func (d *Devbox) Run(ctx context.Context, command string, opts RunOptions) (*RunResult, error) {
	// Build environment
	env := d.buildEnv()
	for k, v := range opts.Env {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}

	// Build command
	// Use "devbox run -- sh -c 'command'" for complex commands
	args := []string{"run", "--", "sh", "-c", command}

	cmd := exec.CommandContext(ctx, "devbox", args...)
	cmd.Dir = d.workspace.Path
	if opts.Cwd != "" {
		cmd.Dir = filepath.Join(d.workspace.ProjectPath, opts.Cwd)
	}
	cmd.Env = env

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	start := time.Now()
	err := cmd.Run()
	duration := time.Since(start)

	result := &RunResult{
		Stdout:     stdout.String(),
		Stderr:     stderr.String(),
		DurationMs: duration.Milliseconds(),
	}

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
		} else {
			return nil, fmt.Errorf("command execution failed: %w", err)
		}
	}

	return result, nil
}

// RunInteractive runs an interactive command (for shell)
func (d *Devbox) RunInteractive(ctx context.Context, args ...string) error {
	cmdArgs := append([]string{"run", "--"}, args...)
	cmd := exec.CommandContext(ctx, "devbox", cmdArgs...)
	cmd.Dir = d.workspace.Path
	cmd.Env = d.buildEnv()
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	return cmd.Run()
}

// Shell enters an interactive devbox shell
func (d *Devbox) Shell(ctx context.Context, pure bool) error {
	args := []string{"shell"}
	if pure {
		args = append(args, "--pure")
	}

	cmd := exec.CommandContext(ctx, "devbox", args...)
	cmd.Dir = d.workspace.Path
	cmd.Env = d.buildEnv()
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	return cmd.Run()
}

// buildEnv creates the environment for running devbox commands
func (d *Devbox) buildEnv() []string {
	env := os.Environ()

	// Add workspace ports
	for name, port := range d.workspace.Ports {
		env = append(env, fmt.Sprintf("%s=%d", name, port))
	}

	// Add workspace info
	env = append(env, fmt.Sprintf("DBA_WORKSPACE_ID=%s", d.workspace.ID))
	env = append(env, fmt.Sprintf("DBA_WORKSPACE_PATH=%s", d.workspace.Path))

	return env
}

// EnsureDevbox checks if devbox is installed, and provides installation instructions if not
func EnsureDevbox() error {
	if _, err := exec.LookPath("devbox"); err == nil {
		return nil // Already installed
	}

	return fmt.Errorf("devbox is not installed. Install it with: curl -fsSL https://get.jetify.com/devbox | bash")
}
