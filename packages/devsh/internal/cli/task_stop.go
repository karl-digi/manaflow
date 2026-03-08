// internal/cli/task_stop.go
package cli

import (
	"context"
	"fmt"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/vm"
	"github.com/spf13/cobra"
)

var taskStopCmd = &cobra.Command{
	Use:   "stop <task-id>",
	Short: "Stop/archive a task",
	Long: `Stop and archive a task. This archives the task and all its runs,
similar to clicking "Archive" in the web app.

Examples:
  devsh task stop ns7cv729xdcpgvz1...`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		taskID := args[0]

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		teamSlug, err := auth.GetTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client, err := vm.NewClient()
		if err != nil {
			return fmt.Errorf("failed to create client: %w", err)
		}
		client.SetTeamSlug(teamSlug)

		if err := client.StopTask(ctx, taskID); err != nil {
			return fmt.Errorf("failed to stop task: %w", err)
		}

		fmt.Printf("Task %s stopped and archived\n", taskID)
		return nil
	},
}

func init() {
	taskCmd.AddCommand(taskStopCmd)
}
