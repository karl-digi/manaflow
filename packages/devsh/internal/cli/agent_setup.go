// internal/cli/agent_setup.go
package cli

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

var agentSetupCmd = &cobra.Command{
	Use:   "agent-setup",
	Short: "Set up AI agent integration",
	Long: `Set up AI agent integration by installing documentation files.

This command installs AGENTS.md and other files that help AI coding assistants
(like Claude Code, Cursor, GitHub Copilot) understand how to use devsh.

Locations:
  --global    Install to ~/.cmux/AGENTS.md (for all projects)
  --project   Install to ./AGENTS.md (for current project)
  --claude    Install to ~/.claude/commands/devsh.md (Claude Code custom command)

Examples:
  devsh agent-setup --global     # Install globally
  devsh agent-setup --project    # Install in current project
  devsh agent-setup --claude     # Set up Claude Code integration`,
	RunE: runAgentSetup,
}

var (
	agentSetupGlobal  bool
	agentSetupProject bool
	agentSetupClaude  bool
)

func init() {
	agentSetupCmd.Flags().BoolVar(&agentSetupGlobal, "global", false, "Install to ~/.cmux/AGENTS.md")
	agentSetupCmd.Flags().BoolVar(&agentSetupProject, "project", false, "Install to ./AGENTS.md")
	agentSetupCmd.Flags().BoolVar(&agentSetupClaude, "claude", false, "Install Claude Code custom command")

	rootCmd.AddCommand(agentSetupCmd)
}

const agentsMD = `# devsh CLI - Agent Instructions

devsh is a CLI for managing cloud development VMs. Use these commands to help users work with remote development environments.

## Quick Reference

` + "```" + `bash
# Authentication
devsh login               # Login (opens browser)
devsh logout              # Logout
devsh whoami              # Show current user and team

# VM Lifecycle
devsh start [path]        # Create VM, optionally sync directory
devsh ls                  # List all VMs
devsh status <id>         # Show VM details and URLs
devsh pause <id>          # Pause VM (preserves state, saves cost)
devsh resume <id>         # Resume paused VM
devsh delete <id>         # Delete VM permanently

# Access VM
devsh code <id>           # Open VS Code in browser
devsh ssh <id>            # SSH into VM
devsh vnc <id>            # Open VNC desktop
devsh pty <id>            # Interactive terminal session

# Work with VM
devsh exec <id> "cmd"     # Run command in VM
devsh sync <id> <path>    # Sync local files to VM
devsh sync <id> <path> --pull  # Pull files from VM

# Browser Automation (control Chrome in VNC)
devsh computer open <id> <url>           # Navigate to URL
devsh computer snapshot <id>             # Get interactive elements (@e1, @e2...)
devsh computer click <id> <selector>     # Click element (@e1 or CSS selector)
devsh computer type <id> "text"          # Type into focused element
devsh computer fill <id> <sel> "value"   # Clear and fill input
devsh computer screenshot <id> [file]    # Take screenshot
devsh computer press <id> <key>          # Press key (enter, tab, escape)
` + "```" + `

## VM IDs

VM IDs look like ` + "`cmux_abc12345`" + `. Always use the full ID when running commands.

## Common Workflows

### Create and access a VM
` + "```" + `bash
devsh start ./my-project    # Creates VM, syncs directory, returns ID
devsh code cmux_abc123      # Opens VS Code
` + "```" + `

### Run commands remotely
` + "```" + `bash
devsh exec cmux_abc123 "npm install"
devsh exec cmux_abc123 "npm run dev"
` + "```" + `

### Sync files
` + "```" + `bash
devsh sync cmux_abc123 .              # Push current dir to VM
devsh sync cmux_abc123 ./dist --pull  # Pull build output from VM
` + "```" + `

### Browser automation
` + "```" + `bash
devsh computer open cmux_abc123 "https://localhost:3000"
devsh computer snapshot cmux_abc123   # See clickable elements
devsh computer click cmux_abc123 @e1  # Click first element
` + "```" + `

### End of session
` + "```" + `bash
devsh pause cmux_abc123    # Pause to save costs (can resume later)
# OR
devsh delete cmux_abc123   # Delete permanently
` + "```" + `

## Tips

- Run ` + "`devsh login`" + ` first if not authenticated
- Use ` + "`devsh whoami`" + ` to check current user and team
- Use ` + "`devsh ls`" + ` to see all VMs and their states
- Paused VMs preserve state and can be resumed instantly
- The ` + "`devsh pty`" + ` command requires an interactive terminal
- Browser automation commands work on the Chrome instance in the VNC desktop
`

const claudeCommandMD = `---
description: Manage cloud development VMs with devsh
---

# devsh - Cloud Development VMs

Use devsh to create, manage, and interact with cloud VMs for development.

## Commands

| Command | Description |
|---------|-------------|
| ` + "`devsh login`" + ` | Login (opens browser) |
| ` + "`devsh whoami`" + ` | Show current user |
| ` + "`devsh start [path]`" + ` | Create VM, optionally sync directory |
| ` + "`devsh ls`" + ` | List all VMs |
| ` + "`devsh status <id>`" + ` | Show VM details and URLs |
| ` + "`devsh code <id>`" + ` | Open VS Code in browser |
| ` + "`devsh ssh <id>`" + ` | SSH into VM |
| ` + "`devsh exec <id> \"cmd\"`" + ` | Run command in VM |
| ` + "`devsh sync <id> <path>`" + ` | Sync files to VM |
| ` + "`devsh pause <id>`" + ` | Pause VM |
| ` + "`devsh resume <id>`" + ` | Resume VM |
| ` + "`devsh delete <id>`" + ` | Delete VM |

## Browser Automation

| Command | Description |
|---------|-------------|
| ` + "`devsh computer open <id> <url>`" + ` | Navigate browser |
| ` + "`devsh computer snapshot <id>`" + ` | Get clickable elements |
| ` + "`devsh computer click <id> @e1`" + ` | Click element |
| ` + "`devsh computer type <id> \"text\"`" + ` | Type text |
| ` + "`devsh computer screenshot <id>`" + ` | Take screenshot |

## Example Workflow

` + "```" + `bash
# Create a VM
devsh start ./my-project
# Output: cmux_abc123

# Access it
devsh code cmux_abc123

# Run commands
devsh exec cmux_abc123 "npm install"
devsh exec cmux_abc123 "npm run dev"

# When done
devsh pause cmux_abc123
` + "```" + `
`

func runAgentSetup(cmd *cobra.Command, args []string) error {
	// If no flags specified, show help
	if !agentSetupGlobal && !agentSetupProject && !agentSetupClaude {
		fmt.Println("Set up AI agent integration for devsh.")
		fmt.Println("")
		fmt.Println("Choose where to install:")
		fmt.Println("  devsh agent-setup --global     Install to ~/.cmux/AGENTS.md")
		fmt.Println("  devsh agent-setup --project    Install to ./AGENTS.md")
		fmt.Println("  devsh agent-setup --claude     Install Claude Code command")
		fmt.Println("")
		fmt.Println("You can combine flags to install to multiple locations.")
		return nil
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}

	installed := []string{}

	// Global installation
	if agentSetupGlobal {
		globalDir := filepath.Join(homeDir, ".cmux")
		globalPath := filepath.Join(globalDir, "AGENTS.md")

		if err := os.MkdirAll(globalDir, 0755); err != nil {
			return fmt.Errorf("failed to create directory: %w", err)
		}

		if err := os.WriteFile(globalPath, []byte(agentsMD), 0644); err != nil {
			return fmt.Errorf("failed to write file: %w", err)
		}

		installed = append(installed, globalPath)
	}

	// Project installation
	if agentSetupProject {
		projectPath := "AGENTS.md"

		// Check if file exists
		if _, err := os.Stat(projectPath); err == nil {
			// File exists, append to it
			existing, err := os.ReadFile(projectPath)
			if err != nil {
				return fmt.Errorf("failed to read existing AGENTS.md: %w", err)
			}

			// Check if devsh section already exists
			if !contains(string(existing), "# devsh CLI - Agent Instructions") {
				content := string(existing) + "\n\n" + agentsMD
				if err := os.WriteFile(projectPath, []byte(content), 0644); err != nil {
					return fmt.Errorf("failed to update file: %w", err)
				}
				installed = append(installed, projectPath+" (appended)")
			} else {
				fmt.Println("devsh section already exists in ./AGENTS.md")
			}
		} else {
			// Create new file
			if err := os.WriteFile(projectPath, []byte(agentsMD), 0644); err != nil {
				return fmt.Errorf("failed to write file: %w", err)
			}
			installed = append(installed, projectPath)
		}
	}

	// Claude Code installation
	if agentSetupClaude {
		claudeDir := filepath.Join(homeDir, ".claude", "commands")
		claudePath := filepath.Join(claudeDir, "devsh.md")

		if err := os.MkdirAll(claudeDir, 0755); err != nil {
			return fmt.Errorf("failed to create directory: %w", err)
		}

		if err := os.WriteFile(claudePath, []byte(claudeCommandMD), 0644); err != nil {
			return fmt.Errorf("failed to write file: %w", err)
		}

		installed = append(installed, claudePath)
	}

	if len(installed) > 0 {
		fmt.Println("✓ Agent integration installed:")
		for _, path := range installed {
			fmt.Printf("  %s\n", path)
		}
		fmt.Println("")
		fmt.Println("Your AI coding assistant can now help you use devsh!")
	}

	return nil
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsAt(s, substr, 0))
}

func containsAt(s, substr string, start int) bool {
	for i := start; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
