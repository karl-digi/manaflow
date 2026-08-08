// internal/cli/start_mirror_target_home_test.go
package cli

import (
	"strings"
	"testing"
)

func TestResolveMirrorTargetHome(t *testing.T) {
	t.Parallel()
	if got := resolveMirrorTargetHome(""); got != "/root" {
		t.Fatalf("default: got %q", got)
	}
	if got := resolveMirrorTargetHome("/home/orca"); got != "/home/orca" {
		t.Fatalf("orca: got %q", got)
	}
	if got := resolveMirrorTargetHome("home/orca"); got != "/root" {
		t.Fatalf("relative should fall back or error consistently; got %q", got)
	}
}

func TestMirrorExtractCommand(t *testing.T) {
	t.Parallel()
	cmd := buildMirrorExtractCommand("/tmp/devsh-mirror-agent-config.tar", "/home/orca")
	if !containsAll(cmd, "mkdir -p '/home/orca'", "tar -xf", "-C '/home/orca'", "chown -R orca:orca /home/orca/.claude /home/orca/.codex") {
		t.Fatalf("extract cmd missing pieces: %s", cmd)
	}
	cmdRoot := buildMirrorExtractCommand("/tmp/x.tar", "/root")
	if containsAll(cmdRoot, "chown -R orca") {
		t.Fatal("root extract must not chown to orca")
	}
}

// containsAll reports whether s contains every one of the given substrings.
func containsAll(s string, subs ...string) bool {
	for _, sub := range subs {
		if !strings.Contains(s, sub) {
			return false
		}
	}
	return true
}
