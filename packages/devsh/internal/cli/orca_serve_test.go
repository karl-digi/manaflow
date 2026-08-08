package cli

import (
	"strings"
	"testing"
)

func TestBuildWorkspaceGHForOrcaCommands(t *testing.T) {
	cmds := BuildWorkspaceGHForOrcaCommands()
	joined := strings.Join(cmds, "\n")
	// Must configure orca git credential helper via sudo -n gh
	if !strings.Contains(joined, "sudo -n") || !strings.Contains(joined, "gh auth git-credential") {
		t.Fatalf("expected G1 helper: %s", joined)
	}
	if strings.Contains(joined, "gh auth login") {
		t.Fatal("must not instruct gh auth login as orca")
	}
	// G1 must cover both github.com and gist.github.com
	if !strings.Contains(joined, "credential.https://github.com.helper") {
		t.Fatalf("expected github.com helper: %s", joined)
	}
	if !strings.Contains(joined, "credential.https://gist.github.com.helper") {
		t.Fatalf("expected gist.github.com helper: %s", joined)
	}
	// Commands run as orca must use sudo -u orca env HOME=/home/orca bash -lc
	// (su does not reliably set HOME; HOME=/root is forbidden for orca).
	if !strings.Contains(joined, "sudo -u orca env HOME=/home/orca bash -lc") {
		t.Fatalf("expected sudo -u orca env HOME=/home/orca bash -lc: %s", joined)
	}
	if strings.Contains(joined, "su -s /bin/bash orca") {
		t.Fatal("must not use su -s /bin/bash orca (HOME not reliably set)")
	}
}

func TestBuildMigrateAgentHomeFromRootCommandsSkipsAuth(t *testing.T) {
	cmds := BuildMigrateAgentHomeFromRootCommands()
	joined := strings.Join(cmds, "\n")
	// Tar-based copy must exclude secret basenames at copy time (nested
	// auth.json inside allowlist dirs must never land in /home/orca).
	if !strings.Contains(joined, "--exclude=auth.json") {
		t.Fatalf("expected --exclude=auth.json in tar copy: %s", joined)
	}
	if !strings.Contains(joined, "--exclude=credentials.json") {
		t.Fatalf("expected --exclude=credentials.json in tar copy: %s", joined)
	}
	if !strings.Contains(joined, "tar -C /root -cf -") || !strings.Contains(joined, "tar -C /home/orca -xf -") {
		t.Fatalf("expected tar-based copy /root -> /home/orca: %s", joined)
	}
	if strings.Contains(joined, "cp -a") {
		t.Fatal("must not use cp -a (copies nested secrets inside allowlist dirs)")
	}
	if !strings.Contains(joined, ".claude") || !strings.Contains(joined, ".codex") {
		t.Fatal("must migrate allowlist trees")
	}
	// Allowlist must match mirrorlocal DefaultIncludePaths entries.
	for _, want := range []string{
		".claude/settings.json",
		".claude/skills",
		".codex/config.toml",
		".codex/automations",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("allowlist missing %q:\n%s", want, joined)
		}
	}
	// Ownership must land on orca.
	if !strings.Contains(joined, "chown -R orca:orca") {
		t.Fatalf("expected chown to orca: %s", joined)
	}
}

func TestBuildOrcaB1EnsureCommands(t *testing.T) {
	cmds := BuildOrcaB1EnsureCommands()
	joined := strings.Join(cmds, "\n")
	// System user with nologin shell.
	if !strings.Contains(joined, "useradd --system --create-home --shell /usr/sbin/nologin orca") {
		t.Fatalf("expected nologin system user: %s", joined)
	}
	// Home base dir must be orca-owned: mirror-local may create /home/orca as
	// root before useradd, and useradd leaves existing homes untouched.
	if !strings.Contains(joined, "chown orca:orca /home/orca") {
		t.Fatalf("expected chown of /home/orca base dir: %s", joined)
	}
	// Passwordless sudoers.
	if !strings.Contains(joined, "NOPASSWD") || !strings.Contains(joined, "/etc/sudoers.d/orca") {
		t.Fatalf("expected sudoers NOPASSWD: %s", joined)
	}
	// Traversal perms on /root + workspace + wiki.
	if !strings.Contains(joined, "chmod 755 /root") {
		t.Fatalf("expected chmod 755 /root: %s", joined)
	}
	if !strings.Contains(joined, "/root/workspace") || !strings.Contains(joined, "/root/wiki") {
		t.Fatalf("expected workspace/wiki chmod: %s", joined)
	}
	// Home symlinks.
	for _, link := range []string{"/home/orca/workspace", "/home/orca/wiki", "/home/orca/root-home"} {
		if !strings.Contains(joined, link) {
			t.Fatalf("expected symlink %s: %s", link, joined)
		}
	}
	// npm prefix to ~/.local.
	if !strings.Contains(joined, "npm config set prefix") || !strings.Contains(joined, ".local") {
		t.Fatalf("expected npm prefix ~/.local: %s", joined)
	}
	// B1 must link bun-installed CLIs from /root/.bun/bin into orca PATH
	// (bun installs to /root/.bun/bin which is not on orca's PATH by default).
	if !strings.Contains(joined, "/root/.bun/bin") {
		t.Fatal("B1 must link bun-installed CLIs from /root/.bun/bin into orca PATH")
	}
	// git safe.directory for root-owned trees.
	if !strings.Contains(joined, "safe.directory") {
		t.Fatalf("expected git safe.directory: %s", joined)
	}
	// Commands run as orca must use sudo -u orca env HOME=/home/orca bash -lc
	// (su does not reliably set HOME; HOME=/root is forbidden for orca).
	if !strings.Contains(joined, "sudo -u orca env HOME=/home/orca bash -lc") {
		t.Fatalf("expected sudo -u orca env HOME=/home/orca bash -lc: %s", joined)
	}
	if strings.Contains(joined, "su -s /bin/bash orca") {
		t.Fatal("must not use su -s /bin/bash orca (HOME not reliably set)")
	}
	// Never HOME=/root (Chromium SIGTRAP).
	if strings.Contains(joined, "HOME=/root") {
		t.Fatal("must never set HOME=/root for orca")
	}
}

func TestBuildOrcaRechownCommand(t *testing.T) {
	cmd := BuildOrcaRechownCommand()
	// Re-chown after B1 useradd: mirror-local may have extracted before the
	// user existed, making the earlier chown a silent no-op.
	if !strings.Contains(cmd, "chown -R orca:orca /home/orca/.claude /home/orca/.codex") {
		t.Fatalf("expected re-chown of mirrored config: %s", cmd)
	}
	// Must soft-fail so the box stays usable when nothing was mirrored.
	if !strings.Contains(cmd, "|| true") {
		t.Fatalf("expected best-effort re-chown: %s", cmd)
	}
}

func TestBuildAgentMatrixCommand(t *testing.T) {
	cmd := BuildAgentMatrixCommand()
	if cmd == "" {
		t.Fatal("expected non-empty matrix command")
	}
	// Single shell script: must be executable as one bash -lc string.
	if !strings.Contains(cmd, "#!/bin/sh") && !strings.Contains(cmd, "#!/bin/bash") {
		t.Fatalf("expected shebang script: %s", cmd)
	}
	// Matrix must report binaries, mirrored config, and gh status.
	for _, want := range []string{"claude", "codex", ".claude", ".codex", "gh"} {
		if !strings.Contains(cmd, want) {
			t.Fatalf("matrix missing %q: %s", want, cmd)
		}
	}
	// Must not instruct gh auth login as orca.
	if strings.Contains(cmd, "gh auth login") {
		t.Fatal("matrix must not instruct gh auth login as orca")
	}
}
