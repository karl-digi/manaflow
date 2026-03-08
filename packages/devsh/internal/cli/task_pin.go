// internal/cli/task_pin.go
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

var taskPinCmd = &cobra.Command{
	Use:   "pin <task-id>",
	Short: "Pin or unpin a task",
	Long: `Toggle a task's pinned state.

Examples:
  devsh task pin ns7cv729xdcpgvz1...`,
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

		pinned, err := client.ToggleTaskPin(ctx, taskID)
		if err != nil {
			return fmt.Errorf("failed to toggle pin: %w", err)
		}

		if flagJSON {
			data, _ := json.MarshalIndent(map[string]interface{}{
				"taskId":  taskID,
				"pinned":  pinned,
			}, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		if pinned {
			fmt.Printf("Task %s pinned\n", taskID)
		} else {
			fmt.Printf("Task %s unpinned\n", taskID)
		}

		return nil
	},
}

func init() {
	taskCmd.AddCommand(taskPinCmd)
}

