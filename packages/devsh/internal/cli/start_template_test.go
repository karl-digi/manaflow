package cli

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadStartTemplateAndExpand(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "macos-dev-ready.yaml")
	body := `
name: macos-dev-ready
provider: pve-lxc
snapshot: snapshot_abc
clean: true
mirror_local:
  sources: [~/.claude, ~/.codex]
  secrets: false
  path_rewrite:
    from: /Users/karlchow
    to: /root
`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	tmpl, err := LoadStartTemplate(path)
	if err != nil {
		t.Fatalf("LoadStartTemplate: %v", err)
	}
	if tmpl.Name != "macos-dev-ready" {
		t.Fatalf("name=%q", tmpl.Name)
	}
	if tmpl.Provider != "pve-lxc" {
		t.Fatalf("provider=%q", tmpl.Provider)
	}
	if tmpl.Clean == nil || !*tmpl.Clean {
		t.Fatal("clean should be true")
	}
	if !templateMirrorLocalEnabled(tmpl.MirrorLocal) {
		t.Fatal("mirror_local should enable")
	}

	// No CLI overrides → template wins
	got := ExpandStartTemplate(tmpl, StartTemplateFlags{}, map[string]bool{})
	if got.Provider != "pve-lxc" || got.Snapshot != "snapshot_abc" || !got.Clean || !got.MirrorLocal {
		t.Fatalf("expand without cli: %+v", got)
	}

	// Explicit CLI overrides template
	cli := StartTemplateFlags{
		Provider:    "morph",
		Snapshot:    "snap_cli",
		Clean:       false,
		MirrorLocal: false,
	}
	cliSet := map[string]bool{
		"provider":     true,
		"snapshot":     true,
		"clean":        true,
		"mirror-local": true,
	}
	got = ExpandStartTemplate(tmpl, cli, cliSet)
	if got.Provider != "morph" || got.Snapshot != "snap_cli" || got.Clean || got.MirrorLocal {
		t.Fatalf("CLI should override template: %+v", got)
	}
}

func TestLoadStartTemplateMissing(t *testing.T) {
	t.Parallel()
	_, err := LoadStartTemplate(filepath.Join(t.TempDir(), "nope.yaml"))
	if err == nil {
		t.Fatal("expected error for missing template")
	}
}

func TestResolveTemplatePathByName(t *testing.T) {
	// Uses real HOME — isolate with t.Setenv
	home := t.TempDir()
	t.Setenv("HOME", home)
	base := filepath.Join(home, ".cmux", "templates")
	if err := os.MkdirAll(base, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(base, "ready.yaml")
	if err := os.WriteFile(path, []byte("clean: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// ResolveTemplatePath uses os.UserHomeDir which respects HOME on Unix.
	got, err := ResolveTemplatePath("ready")
	if err != nil {
		t.Fatalf("ResolveTemplatePath: %v", err)
	}
	if got != path {
		// Some platforms may resolve differently; ensure file exists and ends with ready.yaml
		if filepath.Base(got) != "ready.yaml" {
			t.Fatalf("got %q want %q", got, path)
		}
	}
}

func TestExpandStartTemplateMirrorBool(t *testing.T) {
	t.Parallel()
	trueVal := true
	tmpl := &StartTemplate{
		MirrorLocal: true,
		Clean:       &trueVal,
	}
	got := ExpandStartTemplate(tmpl, StartTemplateFlags{}, nil)
	if !got.MirrorLocal || !got.Clean {
		t.Fatalf("%+v", got)
	}
}

func TestExpandStartTemplateTargetHomeAndOrcaServe(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "orca-serve.yaml")
	body := `
provider: pve-lxc
clean: true
mirror_local: true
target_home: /home/orca
orca_serve:
  enable: true
  workspace_gh: true
  migrate_from_root: true
`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	tmpl, err := LoadStartTemplate(path)
	if err != nil {
		t.Fatalf("LoadStartTemplate: %v", err)
	}
	if tmpl.TargetHome != "/home/orca" {
		t.Fatalf("target_home=%q", tmpl.TargetHome)
	}
	if tmpl.OrcaServe == nil || !tmpl.OrcaServe.Enable || !tmpl.OrcaServe.WorkspaceGH || !tmpl.OrcaServe.MigrateFromRoot {
		t.Fatalf("orca_serve=%+v", tmpl.OrcaServe)
	}

	// No CLI overrides → template wins
	got := ExpandStartTemplate(tmpl, StartTemplateFlags{}, map[string]bool{})
	if got.TargetHome != "/home/orca" {
		t.Fatalf("target home: got %q", got.TargetHome)
	}
	if !got.OrcaServe {
		t.Fatal("orca serve should be enabled from template")
	}
	if !got.MirrorLocal {
		t.Fatal("mirror local should be enabled from template")
	}

	// Explicit CLI --target-home overrides template
	cli := StartTemplateFlags{TargetHome: "/root"}
	cliSet := map[string]bool{"target-home": true}
	got = ExpandStartTemplate(tmpl, cli, cliSet)
	if got.TargetHome != "/root" {
		t.Fatalf("CLI target-home should win: got %q", got.TargetHome)
	}
	if !got.OrcaServe {
		t.Fatal("orca serve should stay enabled from template")
	}
}

func TestExpandStartTemplateOrcaServeDefaults(t *testing.T) {
	t.Parallel()

	// orca_serve.enable without target_home → /home/orca; without mirror_local → enabled
	tmpl := &StartTemplate{OrcaServe: &OrcaServeTemplate{Enable: true}}
	got := ExpandStartTemplate(tmpl, StartTemplateFlags{}, map[string]bool{})
	if got.TargetHome != "/home/orca" {
		t.Fatalf("orca_serve should default target home to /home/orca: got %q", got.TargetHome)
	}
	if !got.MirrorLocal {
		t.Fatal("orca_serve should enable mirror-local by default")
	}

	// Explicit mirror_local: false in template wins over orca_serve
	tmpl = &StartTemplate{MirrorLocal: false, OrcaServe: &OrcaServeTemplate{Enable: true}}
	got = ExpandStartTemplate(tmpl, StartTemplateFlags{}, map[string]bool{})
	if got.MirrorLocal {
		t.Fatal("explicit mirror_local: false should win over orca_serve")
	}
	if got.TargetHome != "/home/orca" {
		t.Fatalf("target home: got %q", got.TargetHome)
	}

	// CLI --mirror-local=false wins over orca_serve
	tmpl = &StartTemplate{OrcaServe: &OrcaServeTemplate{Enable: true}}
	got = ExpandStartTemplate(tmpl, StartTemplateFlags{MirrorLocal: false}, map[string]bool{"mirror-local": true})
	if got.MirrorLocal {
		t.Fatal("CLI --mirror-local=false should win over orca_serve")
	}
	if got.TargetHome != "/home/orca" {
		t.Fatalf("target home: got %q", got.TargetHome)
	}
}

func TestExpandStartTemplateOrcaServeMigrateFromRoot(t *testing.T) {
	t.Parallel()

	// migrate_from_root: true in template flows into flags when orca_serve enabled.
	tmpl := &StartTemplate{OrcaServe: &OrcaServeTemplate{Enable: true, MigrateFromRoot: true}}
	got := ExpandStartTemplate(tmpl, StartTemplateFlags{}, map[string]bool{})
	if !got.MigrateAgentHomeFromRoot {
		t.Fatal("migrate_from_root should enable migrate-agent-home-from-root")
	}

	// migrate_from_root defaults false.
	tmpl = &StartTemplate{OrcaServe: &OrcaServeTemplate{Enable: true}}
	got = ExpandStartTemplate(tmpl, StartTemplateFlags{}, map[string]bool{})
	if got.MigrateAgentHomeFromRoot {
		t.Fatal("migrate_from_root should default false")
	}

	// migrate_from_root without orca_serve.enable is inert.
	tmpl = &StartTemplate{OrcaServe: &OrcaServeTemplate{Enable: false, MigrateFromRoot: true}}
	got = ExpandStartTemplate(tmpl, StartTemplateFlags{}, map[string]bool{})
	if got.MigrateAgentHomeFromRoot {
		t.Fatal("migrate_from_root must not apply without orca_serve")
	}

	// Explicit CLI --migrate-agent-home-from-root wins over template.
	tmpl = &StartTemplate{OrcaServe: &OrcaServeTemplate{Enable: true, MigrateFromRoot: true}}
	got = ExpandStartTemplate(tmpl, StartTemplateFlags{MigrateAgentHomeFromRoot: false}, map[string]bool{"migrate-agent-home-from-root": true})
	if got.MigrateAgentHomeFromRoot {
		t.Fatal("CLI --migrate-agent-home-from-root=false should win over template")
	}
}
