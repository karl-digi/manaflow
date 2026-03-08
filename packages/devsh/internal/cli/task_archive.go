// internal/cli/task_archive.go
package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/vm"
	"github.com/spf13/cobra"
)

var taskArchiveCmd = &cobra.Command{
	Use:   "archive <task-id>",
	Short: "Archive a task",
	Long: `Archive a task and all of its runs (same as the web app "Archive" action).

Examples:
  devsh task archive ns7cv729xdcpgvz1...`,
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

		if err := client.ArchiveTask(ctx, taskID); err != nil {
			return fmt.Errorf("failed to archive task: %w", err)
		}

		if flagJSON {
			data, _ := json.MarshalIndent(map[string]interface{}{
				"taskId":    taskID,
				"archived":  true,
			}, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Printf("Task %s archived\n", taskID)
		return nil
	},
}

var taskUnarchiveCmd = &cobra.Command{
	Use:   "unarchive <task-id>",
	Short: "Unarchive a task",
	Long: `Unarchive a task and all of its runs.

Examples:
  devsh task unarchive ns7cv729xdcpgvz1...`,
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

		if err := client.UnarchiveTask(ctx, taskID); err != nil {
			return fmt.Errorf("failed to unarchive task: %w", err)
		}

		if flagJSON {
			data, _ := json.MarshalIndent(map[string]interface{}{
				"taskId":    taskID,
				"archived":  false,
			}, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Printf("Task %s unarchived\n", taskID)
		return nil
	},
}

func init() {
	taskCmd.AddCommand(taskArchiveCmd)
	taskCmd.AddCommand(taskUnarchiveCmd)
}

