// internal/devbox/run.go
package devbox

import (
	"context"
	"time"

	"github.com/dba-cli/dba/internal/config"
	"github.com/dba-cli/dba/internal/daemon"
	"github.com/dba-cli/dba/internal/workspace"
)

// Runner handles command execution with sync barriers
type Runner struct {
	workspace *workspace.Workspace
	devbox    *Devbox
	config    *config.Config
	noSync    bool
}

// NewRunner creates a new command runner
func NewRunner(ws *workspace.Workspace, cfg *config.Config, noSync bool) *Runner {
	return &Runner{
		workspace: ws,
		devbox:    New(ws),
		config:    cfg,
		noSync:    noSync,
	}
}

// Run runs a command with optional sync barrier
func (r *Runner) Run(ctx context.Context, command string, opts RunOptions) (*RunResult, error) {
	var syncWaitMs int64
	var synced bool

	// Wait for sync barrier unless disabled
	if !r.noSync {
		waitMs, err := r.waitForSync(ctx)
		if err != nil {
			// Log warning but continue - sync barrier failure shouldn't stop command
			// We silently ignore sync errors to not break command execution
		} else {
			syncWaitMs = waitMs
			synced = true
		}
	}

	result, err := r.devbox.Run(ctx, command, opts)
	if err != nil {
		return nil, err
	}

	result.SyncWaitMs = syncWaitMs
	result.Synced = synced
	return result, nil
}

// waitForSync waits for the sync barrier via the daemon
func (r *Runner) waitForSync(ctx context.Context) (int64, error) {
	// Auto-start daemon if needed for sync
	if err := daemon.EnsureRunning(r.config); err != nil {
		// If daemon can't start, skip sync barrier
		return 0, nil
	}
	client := daemon.NewClient(r.config)

	// Parse timeout from config
	timeout := 10 * time.Second
	if r.config.Sync.BarrierTimeout != "" {
		parsed, err := time.ParseDuration(r.config.Sync.BarrierTimeout)
		if err == nil {
			timeout = parsed
		}
	}

	// Wait for sync
	result, err := client.WaitForSync(r.workspace.ID, timeout)
	if err != nil {
		return 0, err
	}

	return result.WaitMs, nil
}

// RunWithOutput runs a command and streams output to stdout/stderr
func (r *Runner) RunWithOutput(ctx context.Context, command string, opts RunOptions) error {
	// Wait for sync barrier unless disabled
	if !r.noSync {
		_, _ = r.waitForSync(ctx)
	}

	return r.devbox.RunInteractive(ctx, "sh", "-c", command)
}

// GetDevbox returns the underlying Devbox wrapper
func (r *Runner) GetDevbox() *Devbox {
	return r.devbox
}
