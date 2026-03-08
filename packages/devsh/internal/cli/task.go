// internal/cli/task.go
package cli

import (
	"github.com/spf13/cobra"
)

var taskCmd = &cobra.Command{
	Use:   "task",
	Short: "Manage tasks",
	Long: `Manage tasks (same as web app dashboard).

Tasks represent prompts sent to AI agents. Each task can have
multiple runs with different agents working on it.

Examples:
  devsh task list                      # List all active tasks
  devsh task list --archived           # List archived tasks
  devsh task create --repo owner/repo --agent claude-code "Add tests"
  devsh task status <task-id>          # Get task details
  devsh task show <task-id>            # Show task details (enhanced)
  devsh task runs <task-id>            # List runs with exit codes
  devsh task pin <task-id>             # Pin/unpin a task
  devsh task archive <task-id>         # Archive a task
  devsh task stop <task-id>            # Stop/archive a task`,
}

func init() {
	rootCmd.AddCommand(taskCmd)
}
