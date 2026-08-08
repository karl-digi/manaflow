// internal/cli/start_orca_serve_test.go
package cli

import (
	"context"
	"strings"
	"testing"
)

func TestOrcaServeDefaultTargetHome(t *testing.T) {
	t.Parallel()
	// pure function: effectiveTargetHome(orcaServe, flagTarget)
	if got := effectiveTargetHome(true, ""); got != "/home/orca" {
		t.Fatalf("orca-serve default: got %q, want /home/orca", got)
	}
	if got := effectiveTargetHome(false, ""); got != "/root" {
		t.Fatalf("non-orca default: got %q, want /root", got)
	}
	if got := effectiveTargetHome(true, "/custom"); got != "/custom" {
		t.Fatalf("explicit target-home wins: got %q, want /custom", got)
	}
	if got := effectiveTargetHome(false, "/home/orca"); got != "/home/orca" {
		t.Fatalf("explicit target-home without orca-serve: got %q, want /home/orca", got)
	}
}

// fakeOrcaExec records exec commands and returns canned responses.
type fakeOrcaExec struct {
	cmds []string
	// per-call responses (cycled if exhausted uses last)
	responses []struct {
		stdout, stderr string
		code           int
		err            error
	}
	i int
}

func (f *fakeOrcaExec) ExecCommand(ctx context.Context, instanceID, command string) (string, string, int, error) {
	f.cmds = append(f.cmds, command)
	if len(f.responses) == 0 {
		return "", "", 0, nil
	}
	idx := f.i
	if idx >= len(f.responses) {
		idx = len(f.responses) - 1
	}
	f.i++
	r := f.responses[idx]
	return r.stdout, r.stderr, r.code, r.err
}

// indexOf returns the first index of a command containing needle, or -1.
func indexOf(cmds []string, needle string) int {
	for i, c := range cmds {
		if strings.Contains(c, needle) {
			return i
		}
	}
	return -1
}

func TestRunOrcaServePostStartOrder(t *testing.T) {
	t.Parallel()
	exec := &fakeOrcaExec{}
	err := runOrcaServePostStart(context.Background(), exec, "inst-1", OrcaServeOpts{
		MigrateFromRoot: true,
		WorkspaceGH:     true,
	})
	if err != nil {
		t.Fatalf("runOrcaServePostStart: %v", err)
	}
	// Order must be B1 → re-chown → migrate → workspace_gh → matrix.
	b1 := indexOf(exec.cmds, "useradd")
	rechown := indexOf(exec.cmds, "chown -R orca:orca /home/orca/.claude /home/orca/.codex")
	migrate := indexOf(exec.cmds, "tar -C /root -cf -")
	gh := indexOf(exec.cmds, "gh auth git-credential")
	matrix := indexOf(exec.cmds, "orca agent matrix")
	if b1 < 0 || rechown < 0 || migrate < 0 || gh < 0 || matrix < 0 {
		t.Fatalf("missing step markers (b1=%d rechown=%d migrate=%d gh=%d matrix=%d):\n%s", b1, rechown, migrate, gh, matrix, strings.Join(exec.cmds, "\n---\n"))
	}
	if !(b1 < rechown && rechown < migrate && migrate < gh && gh < matrix) {
		t.Fatalf("order must be B1(%d) → re-chown(%d) → migrate(%d) → workspace_gh(%d) → matrix(%d)", b1, rechown, migrate, gh, matrix)
	}
}

func TestRunOrcaServePostStartSkipsMigrate(t *testing.T) {
	t.Parallel()
	exec := &fakeOrcaExec{}
	err := runOrcaServePostStart(context.Background(), exec, "inst-1", OrcaServeOpts{
		MigrateFromRoot: false,
		WorkspaceGH:     true,
	})
	if err != nil {
		t.Fatalf("runOrcaServePostStart: %v", err)
	}
	if indexOf(exec.cmds, "tar -C /root -cf -") != -1 {
		t.Fatalf("migrate must be skipped when MigrateFromRoot=false:\n%s", strings.Join(exec.cmds, "\n---\n"))
	}
	// Re-chown (I2) must still run after B1 even without migrate.
	if indexOf(exec.cmds, "chown -R orca:orca /home/orca/.claude /home/orca/.codex") == -1 {
		t.Fatal("re-chown must run after B1 even when migrate is skipped")
	}
	if indexOf(exec.cmds, "orca agent matrix") == -1 {
		t.Fatal("matrix must still run without migrate")
	}
}

func TestRunOrcaServePostStartSoftFails(t *testing.T) {
	t.Parallel()
	// B1 fails with exit 1 → whole step soft-fails with a Warning, remaining steps still run.
	exec := &fakeOrcaExec{
		responses: []struct {
			stdout, stderr string
			code           int
			err            error
		}{
			{stdout: "", stderr: "useradd: permission denied", code: 1, err: nil},
		},
	}
	err := runOrcaServePostStart(context.Background(), exec, "inst-1", OrcaServeOpts{
		MigrateFromRoot: true,
		WorkspaceGH:     true,
	})
	if err == nil {
		t.Fatal("expected soft-fail error when B1 exits non-zero")
	}
	if !strings.Contains(err.Error(), "B1") {
		t.Fatalf("error should name the failing step: %v", err)
	}
	// Later steps must still have been attempted: re-chown, migrate, gh, and matrix all ran.
	if indexOf(exec.cmds, "chown -R orca:orca /home/orca/.claude /home/orca/.codex") == -1 {
		t.Fatal("re-chown must still run after B1 soft-fail")
	}
	if indexOf(exec.cmds, "tar -C /root -cf -") == -1 {
		t.Fatal("migrate must still run after B1 soft-fail")
	}
	if indexOf(exec.cmds, "gh auth git-credential") == -1 {
		t.Fatal("workspace gh must still run after B1 soft-fail")
	}
	if indexOf(exec.cmds, "orca agent matrix") == -1 {
		t.Fatal("matrix must still run after B1 soft-fail")
	}
}

func TestRunOrcaServePostStartExecError(t *testing.T) {
	t.Parallel()
	exec := &fakeOrcaExec{
		responses: []struct {
			stdout, stderr string
			code           int
			err            error
		}{
			{stdout: "", stderr: "", code: 0, err: context.DeadlineExceeded},
		},
	}
	err := runOrcaServePostStart(context.Background(), exec, "inst-1", OrcaServeOpts{
		MigrateFromRoot: false,
		WorkspaceGH:     true,
	})
	if err == nil {
		t.Fatal("expected soft-fail error when exec transport fails")
	}
	if !strings.Contains(err.Error(), "B1") {
		t.Fatalf("error should name the failing step: %v", err)
	}
	if indexOf(exec.cmds, "orca agent matrix") == -1 {
		t.Fatal("matrix must still run after exec soft-fail")
	}
}
