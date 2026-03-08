// Package credentials provides credential checking for AI providers.
package credentials

import (
	"os/exec"
	"strings"
)

// OpenCodeModel represents a model from opencode CLI
type OpenCodeModel struct {
	ID       string // e.g., "anthropic/claude-sonnet-4-5"
	Provider string // e.g., "anthropic"
	Model    string // e.g., "claude-sonnet-4-5"
}

// GetOpenCodeModels calls `opencode models` and parses output.
// Returns nil if opencode is not installed or the command fails.
func GetOpenCodeModels() ([]OpenCodeModel, error) {
	// Check if opencode is installed
	path, err := exec.LookPath("opencode")
	if err != nil {
		return nil, nil // Not installed, skip silently
	}

	// Run: opencode models
	cmd := exec.Command(path, "models")
	output, err := cmd.Output()
	if err != nil {
		return nil, nil // Failed, skip silently
	}

	// Parse output: "provider/model" format, one per line
	var models []OpenCodeModel
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "/", 2)
		if len(parts) == 2 {
			models = append(models, OpenCodeModel{
				ID:       line,
				Provider: parts[0],
				Model:    parts[1],
			})
		}
	}
	return models, nil
}

// GetOpenCodeProviders returns a set of connected provider names from opencode.
func GetOpenCodeProviders() map[string]bool {
	models, _ := GetOpenCodeModels()
	providers := make(map[string]bool)
	for _, m := range models {
		providers[m.Provider] = true
	}
	return providers
}
