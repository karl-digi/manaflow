// internal/cli/orchestrate_cancel.go
package cli

import (
	"context"
	"fmt"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/vm"
	"github.com/spf13/cobra"
)

var orchestrateCancelCmd = &cobra.Command{
	Use:   "cancel <orch-task-id>",
	Short: "Cancel an orchestration task",
	Long: `Cancel an orchestration task and cascade the cancellation to any linked task run.

The orchestration task will be marked as cancelled, and if there is a linked
task run, it will be marked as failed with exit code 130 (SIGINT).

Examples:
  devsh orchestrate cancel k97xcv2...`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		orchTaskID := args[0]

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

		if err := client.OrchestrationCancel(ctx, orchTaskID); err != nil {
			return fmt.Errorf("failed to cancel orchestration task: %w", err)
		}

		fmt.Printf("Orchestration task %s cancelled.\n", orchTaskID)
		return nil
	},
}

func init() {
	orchestrateCmd.AddCommand(orchestrateCancelCmd)
}
