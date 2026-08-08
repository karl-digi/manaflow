// internal/cli/orca_serve.go
//
// Pure command builders for Orca Server (orca-serve) composition on pve-lxc.
// These functions return shell command lists / scripts that later tasks exec
// in the box; they perform no I/O themselves.
//
// Design (approved 2026-08-07, projects/cmux/work/2026-08-07-orca-serve-start-mode):
//   - Claude/Codex config lands under /home/orca via --mirror-local
//     TargetHome=/home/orca (same allowlist/redaction as root mirror).
//   - gh uses the LXC workspace default under /root; orca delegates via a
//     G1 credential helper (sudo -n gh auth git-credential) plus an optional
//     G2 wrapper. Never instruct `gh auth login` as orca.
//   - B1 bridge: system user orca (nologin), sudoers NOPASSWD, home symlinks,
//     npm prefix ~/.local, git safe.directory. Never Environment=HOME=/root
//     (Chromium SIGTRAP).
package cli

import (
	"context"
	"fmt"
	"strings"

	"github.com/karlorz/devsh/internal/mirrorlocal"
)

// ExecRunner executes a shell command in the box. *pvelxc.Client implements it;
// tests inject fakes.
type ExecRunner interface {
	ExecCommand(ctx context.Context, instanceID string, command string) (stdout, stderr string, exitCode int, err error)
}

// OrcaServeOpts selects the post-start composition steps for --orca-serve.
type OrcaServeOpts struct {
	// MigrateFromRoot copies the mirrorlocal allowlist from /root to
	// /home/orca on long-lived boxes already mirrored to root (never auth.json).
	MigrateFromRoot bool
	// WorkspaceGH wires orca git/gh to the workspace root default (G1/G2).
	WorkspaceGH bool
}

// runOrcaServePostStart composes the Orca Server agent home after a pve-lxc
// start: B1 ensure → optional migrate-from-root → workspace gh → agent matrix.
// Each step soft-fails: the error names the first failing step, but later
// steps still run so the box remains usable.
func runOrcaServePostStart(ctx context.Context, exec ExecRunner, instanceID string, opts OrcaServeOpts) error {
	var failures []string

	// 1) B1 bridge: orca user, sudoers, symlinks, npm prefix, safe.directory.
	if err := execEach(ctx, exec, instanceID, "B1", BuildOrcaB1EnsureCommands()); err != nil {
		failures = append(failures, err.Error())
	}

	// 1b) Re-chown mirrored config now that the orca user exists: mirror-local
	// may have extracted before B1 useradd, making the earlier chown a no-op.
	if err := execOne(ctx, exec, instanceID, "re-chown", BuildOrcaRechownCommand()); err != nil {
		failures = append(failures, err.Error())
	}

	// 2) Optional migrate-from-root: allowlist copy /root → /home/orca.
	if opts.MigrateFromRoot {
		if err := execEach(ctx, exec, instanceID, "migrate-from-root", BuildMigrateAgentHomeFromRootCommands()); err != nil {
			failures = append(failures, err.Error())
		}
	}

	// 3) Workspace gh for orca (G1 credential helper + G2 wrapper).
	if opts.WorkspaceGH {
		if err := execEach(ctx, exec, instanceID, "workspace-gh", BuildWorkspaceGHForOrcaCommands()); err != nil {
			failures = append(failures, err.Error())
		}
	}

	// 4) Agent detection matrix (always last).
	if err := execOne(ctx, exec, instanceID, "agent-matrix", BuildAgentMatrixCommand()); err != nil {
		failures = append(failures, err.Error())
	}

	if len(failures) > 0 {
		return fmt.Errorf("orca-serve post-start soft-failed: %s", strings.Join(failures, "; "))
	}
	return nil
}

// execEach runs every command in cmds, stopping the step at the first failure.
func execEach(ctx context.Context, exec ExecRunner, instanceID, step string, cmds []string) error {
	for _, c := range cmds {
		if err := execOne(ctx, exec, instanceID, step, c); err != nil {
			return err
		}
	}
	return nil
}

// execOne runs a single command and reports a step-scoped error on transport
// failure or non-zero exit.
func execOne(ctx context.Context, exec ExecRunner, instanceID, step, command string) error {
	stdout, stderr, code, err := exec.ExecCommand(ctx, instanceID, command)
	if err != nil {
		return fmt.Errorf("%s exec: %w", step, err)
	}
	if code != 0 {
		detail := strings.TrimSpace(stderr + "\n" + stdout)
		if detail == "" {
			detail = "no output"
		}
		return fmt.Errorf("%s failed (exit %d): %s", step, code, detail)
	}
	return nil
}

// BuildWorkspaceGHForOrcaCommands returns commands wiring orca git/gh to the
// workspace root default (/root/.config/gh) without a second gh auth login.
//
// G1: orca's global git config uses root's gh via a sudo -n credential helper
// for github.com and gist.github.com. G2: optional ~/.local/bin/gh wrapper so
// `gh` on orca's PATH behaves like root's gh.
func BuildWorkspaceGHForOrcaCommands() []string {
	return []string{
		`sudo -u orca env HOME=/home/orca bash -lc 'git config --global credential.https://github.com.helper "!sudo -n /usr/bin/gh auth git-credential"'`,
		`sudo -u orca env HOME=/home/orca bash -lc 'git config --global credential.https://gist.github.com.helper "!sudo -n /usr/bin/gh auth git-credential"'`,
		// Optional G2 wrapper: orca `gh` delegates to root's workspace gh.
		`install -d /home/orca/.local/bin`,
		`printf '%s\n' '#!/bin/sh' 'exec sudo -n /usr/bin/gh "$@"' > /home/orca/.local/bin/gh`,
		`chmod 755 /home/orca/.local/bin/gh`,
		`chown orca:orca /home/orca/.local/bin/gh`,
	}
}

// BuildMigrateAgentHomeFromRootCommands returns a script copying the agent
// config allowlist from /root to /home/orca on long-lived boxes already
// mirrored to root. The allowlist is mirrorlocal.DefaultIncludePaths; secrets
// (auth.json etc.) are excluded at copy time — never copied, even nested
// inside allowlist dirs. Ownership lands on orca:orca.
func BuildMigrateAgentHomeFromRootCommands() []string {
	var b strings.Builder
	b.WriteString("set -e\n")
	b.WriteString("# Migrate agent config allowlist from /root to /home/orca (mirrorlocal DefaultIncludePaths).\n")
	b.WriteString("# Secret basenames (auth.json, credentials) and sqlite/db files are excluded at copy\n")
	b.WriteString("# time — never copied, even nested inside allowlist dirs.\n")
	b.WriteString("mkdir -p /home/orca\n")
	b.WriteString("for p in \\\n")
	for _, p := range mirrorlocal.DefaultIncludePaths {
		b.WriteString("  " + p + " \\\n")
	}
	b.WriteString("; do\n")
	b.WriteString("  if [ -e \"/root/$p\" ]; then\n")
	b.WriteString("    mkdir -p \"/home/orca/$(dirname \"$p\")\"\n")
	b.WriteString("    tar -C /root -cf - \\\n")
	b.WriteString("      --exclude=auth.json --exclude=.credentials.json --exclude=credentials.json \\\n")
	b.WriteString("      --exclude='*.sqlite' --exclude='*.sqlite3' --exclude='*.db' \\\n")
	b.WriteString("      --exclude='*.lock' --exclude='*.wal' --exclude='*.shm' \\\n")
	b.WriteString("      \"$p\" | tar -C /home/orca -xf -\n")
	b.WriteString("  fi\n")
	b.WriteString("done\n")
	b.WriteString("chown -R orca:orca /home/orca/.claude /home/orca/.codex 2>/dev/null || true\n")
	return []string{b.String()}
}

// BuildOrcaRechownCommand returns a best-effort re-chown of the mirrored agent
// config under /home/orca. mirror-local may extract before B1 useradd (the
// user does not exist yet, so its chown is a silent no-op); re-running after
// B1 ensures ownership lands on orca:orca. Soft-fails (2>/dev/null || true).
func BuildOrcaRechownCommand() string {
	return `chown -R orca:orca /home/orca/.claude /home/orca/.codex 2>/dev/null || true`
}

// BuildOrcaB1EnsureCommands returns idempotent B1 bridge commands: system user
// orca (nologin), passwordless sudoers, traversal perms on /root trees, home
// symlinks, npm prefix ~/.local, and git safe.directory for root-owned repos.
// Never sets HOME=/root for orca (Chromium SIGTRAP).
func BuildOrcaB1EnsureCommands() []string {
	return []string{
		`id orca >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin orca`,
		// Mirror-local may have created /home/orca (as root) before B1's
		// useradd; useradd leaves an existing home's ownership untouched, so
		// orca's later writes (~/.local, .npmrc, .gitconfig) would EACCES.
		`chown orca:orca /home/orca 2>/dev/null || true`,
		`echo "orca ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/orca`,
		`chmod 440 /etc/sudoers.d/orca`,
		`chmod 755 /root`,
		`[ -d /root/workspace ] && chmod 755 /root/workspace || true`,
		`[ -d /root/wiki ] && chmod 755 /root/wiki || true`,
		`ln -sfn /root /home/orca/root-home`,
		`ln -sfn /root/workspace /home/orca/workspace`,
		`ln -sfn /root/wiki /home/orca/wiki`,
		`chown -h orca:orca /home/orca/root-home /home/orca/workspace /home/orca/wiki`,
		`sudo -u orca env HOME=/home/orca bash -lc 'mkdir -p "$HOME/.local/bin" "$HOME/.local/lib/node_modules"; npm config set prefix "$HOME/.local"'`,
		// Link bun-installed agent CLIs (claude, codex, gemini, etc.) into orca PATH
		// bun installs to /root/.bun/bin/ which is not on orca's PATH by default
		`for cli in /root/.bun/bin/*; do name=$(basename "$cli"); [ "$name" = "bun" ] && continue; [ "$name" = "bunx" ] && continue; ln -sfn "$cli" /home/orca/.local/bin/"$name"; done`,
		`chown -h orca:orca /home/orca/.local/bin/* 2>/dev/null || true`,
		`sudo -u orca env HOME=/home/orca bash -lc 'git config --global --add safe.directory /root/workspace; git config --global --add safe.directory /root/wiki; git config --global --add safe.directory /root'`,
	}
}

// BuildAgentMatrixCommand returns a single shell script printing the orca
// detection matrix: CLIs on orca PATH, mirrored config under /home/orca, gh
// via the workspace root default, and agent auth-file presence. It never
// instructs `gh auth login` as orca.
func BuildAgentMatrixCommand() string {
	return `#!/bin/bash
# orca-serve agent detection matrix (run as root).
echo "== orca agent matrix =="
echo "-- binaries on orca PATH --"
for b in claude codex grok gh; do
  if p=$(sudo -u orca env HOME=/home/orca bash -lc "command -v $b" 2>/dev/null); then
    echo "ok   $b: $p"
  else
    echo "miss $b"
  fi
done
echo "-- mirrored config under /home/orca --"
for p in .claude .codex; do
  if [ -e "/home/orca/$p" ]; then
    echo "ok   /home/orca/$p"
  else
    echo "miss /home/orca/$p"
  fi
done
echo "-- gh via workspace root default --"
if [ -f /root/.config/gh/hosts.yml ]; then
  echo "ok   root gh hosts present; orca delegates via sudo -n gh"
  sudo -n /usr/bin/gh auth status 2>&1 | head -5 || true
else
  echo "warn root gh not configured"
fi
echo "-- agent auth files (absent unless device-auth done as orca) --"
for f in /home/orca/.claude/auth.json /home/orca/.codex/auth.json; do
  if [ -e "$f" ]; then
    echo "note $f present"
  else
    echo "ok   $f absent"
  fi
done
`
}
