package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// StartTemplate is a local YAML recipe expanded into start flags.
// Path: ~/.cmux/templates/<name>.yaml (or absolute path).
type StartTemplate struct {
	Name     string `yaml:"name"`
	Provider string `yaml:"provider"`
	Snapshot string `yaml:"snapshot"`
	Clean    *bool  `yaml:"clean"`
	// MirrorLocal can be bool true or a map with options.
	MirrorLocal any `yaml:"mirror_local"`
	NoAuth      *bool `yaml:"no_auth"`
	// TargetHome is the cloud home for --mirror-local path rewrite/extract
	// (default /root; /home/orca for Orca Server).
	TargetHome string `yaml:"target_home"`
	// OrcaServe composes Orca Server post-start behavior (B1, workspace gh,
	// optional migrate-from-root). Enable implies target_home /home/orca and
	// mirror_local unless explicitly overridden.
	OrcaServe *OrcaServeTemplate `yaml:"orca_serve"`
}

// OrcaServeTemplate is the orca_serve: block of a start template.
type OrcaServeTemplate struct {
	Enable          bool `yaml:"enable"`
	WorkspaceGH     bool `yaml:"workspace_gh"`
	MigrateFromRoot bool `yaml:"migrate_from_root"`
}

// StartTemplateFlags is the resolved flag state after template + CLI merge.
type StartTemplateFlags struct {
	Provider                 string
	Snapshot                 string
	Clean                    bool
	MirrorLocal              bool
	NoAuth                   bool
	TargetHome               string
	OrcaServe                bool
	MigrateAgentHomeFromRoot bool
}

// LoadStartTemplate loads a template by name (under ~/.cmux/templates/) or absolute path.
func LoadStartTemplate(nameOrPath string) (*StartTemplate, error) {
	path, err := ResolveTemplatePath(nameOrPath)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read template %s: %w", path, err)
	}
	var tmpl StartTemplate
	if err := yaml.Unmarshal(data, &tmpl); err != nil {
		return nil, fmt.Errorf("parse template %s: %w", path, err)
	}
	return &tmpl, nil
}

// ResolveTemplatePath maps a template name or path to an absolute file path.
func ResolveTemplatePath(nameOrPath string) (string, error) {
	nameOrPath = strings.TrimSpace(nameOrPath)
	if nameOrPath == "" {
		return "", fmt.Errorf("template name is empty")
	}
	// Absolute or explicit relative path with separator / extension.
	if strings.HasPrefix(nameOrPath, "/") ||
		strings.HasPrefix(nameOrPath, "./") ||
		strings.HasPrefix(nameOrPath, "../") ||
		strings.HasSuffix(nameOrPath, ".yaml") ||
		strings.HasSuffix(nameOrPath, ".yml") {
		abs, err := filepath.Abs(nameOrPath)
		if err != nil {
			return "", err
		}
		if _, err := os.Stat(abs); err != nil {
			return "", fmt.Errorf("template file not found: %s", abs)
		}
		return abs, nil
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home for templates: %w", err)
	}
	base := filepath.Join(home, ".cmux", "templates")
	candidates := []string{
		filepath.Join(base, nameOrPath+".yaml"),
		filepath.Join(base, nameOrPath+".yml"),
		filepath.Join(base, nameOrPath),
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c, nil
		}
	}
	return "", fmt.Errorf("template %q not found under %s (tried .yaml/.yml)", nameOrPath, base)
}

// ExpandStartTemplate applies template defaults then lets explicit CLI flags win.
// cliSet maps flag name → whether the user explicitly set it on the command line.
func ExpandStartTemplate(tmpl *StartTemplate, cli StartTemplateFlags, cliSet map[string]bool) StartTemplateFlags {
	out := cli
	if tmpl == nil {
		return out
	}

	if !cliSet["provider"] && tmpl.Provider != "" {
		out.Provider = tmpl.Provider
	}
	if !cliSet["snapshot"] && tmpl.Snapshot != "" {
		out.Snapshot = tmpl.Snapshot
	}
	if !cliSet["clean"] && tmpl.Clean != nil {
		out.Clean = *tmpl.Clean
	}
	if !cliSet["no-auth"] && tmpl.NoAuth != nil {
		out.NoAuth = *tmpl.NoAuth
	}
	if !cliSet["target-home"] && tmpl.TargetHome != "" {
		out.TargetHome = tmpl.TargetHome
	}
	if !cliSet["orca-serve"] && tmpl.OrcaServe != nil && tmpl.OrcaServe.Enable {
		out.OrcaServe = true
	}
	// orca_serve.enable implies /home/orca unless target-home was set explicitly.
	if out.OrcaServe && !cliSet["target-home"] && out.TargetHome == "" {
		out.TargetHome = "/home/orca"
	}
	// migrate_from_root only applies when orca_serve is enabled; explicit CLI wins.
	if !cliSet["migrate-agent-home-from-root"] && out.OrcaServe && tmpl.OrcaServe != nil {
		out.MigrateAgentHomeFromRoot = tmpl.OrcaServe.MigrateFromRoot
	}
	if !cliSet["mirror-local"] {
		if tmpl.MirrorLocal != nil {
			out.MirrorLocal = templateMirrorLocalEnabled(tmpl.MirrorLocal)
		} else if out.OrcaServe {
			// orca_serve.enable implies mirror-local unless explicitly false.
			out.MirrorLocal = true
		} else {
			out.MirrorLocal = false
		}
	}
	return out
}

func templateMirrorLocalEnabled(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case map[string]any:
		// Presence of a map means mirror-local is enabled; secrets: false is default.
		return true
	case map[any]any:
		return true
	case string:
		return strings.EqualFold(t, "true") || t == "1"
	default:
		return false
	}
}
