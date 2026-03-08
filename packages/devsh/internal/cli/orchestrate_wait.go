// internal/cli/orchestrate_wait.go
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

var orchestrateWaitTimeout string

var orchestrateWaitCmd = &cobra.Command{
	Use:   "wait <orch-task-id>",
	Short: "Wait for orchestration task to complete",
	Long: `Wait for an orchestration task to reach a terminal state (completed, failed, or cancelled).

Polls the task status every 5 seconds until it completes or the timeout is reached.

Examples:
  devsh orchestrate wait k97xcv2...
  devsh orchestrate wait <orch-task-id> --timeout 10m
  devsh orchestrate wait <orch-task-id> --json`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		orchTaskID := args[0]

		timeout, err := time.ParseDuration(orchestrateWaitTimeout)
		if err != nil {
			return fmt.Errorf("invalid timeout duration: %w", err)
		}

		ctx, cancel := context.WithTimeout(context.Background(), timeout)
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

		fmt.Printf("Waiting for orchestration task %s...\n", orchTaskID)

		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		var lastStatus string
		for {
			select {
			case <-ctx.Done():
				return fmt.Errorf("timeout waiting for task to complete")
			case <-ticker.C:
				result, err := client.OrchestrationStatus(ctx, orchTaskID)
				if err != nil {
					fmt.Printf("  Error checking status: %v\n", err)
					continue
				}

				status := result.Task.Status
				if status != lastStatus {
					fmt.Printf("  Status: %s\n", status)
					lastStatus = status
				}

				// Check for terminal states
				switch status {
				case "completed", "failed", "cancelled":
					if flagJSON {
						data, _ := json.MarshalIndent(result, "", "  ")
						fmt.Println(string(data))
					} else {
						fmt.Printf("\nTask finished with status: %s\n", status)
						if result.Task.ErrorMessage != nil {
							fmt.Printf("Error: %s\n", *result.Task.ErrorMessage)
						}
						if result.Task.Result != nil {
							fmt.Printf("Result: %s\n", *result.Task.Result)
						}
					}
					if status == "failed" || status == "cancelled" {
						return fmt.Errorf("task %s", status)
					}
					return nil
				}
			}
		}
	},
}

func init() {
	orchestrateWaitCmd.Flags().StringVar(&orchestrateWaitTimeout, "timeout", "300s", "Maximum time to wait")
	orchestrateCmd.AddCommand(orchestrateWaitCmd)
}
