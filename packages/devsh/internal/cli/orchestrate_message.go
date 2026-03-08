// internal/cli/orchestrate_message.go
package cli

import (
	"context"
	"fmt"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/vm"
	"github.com/spf13/cobra"
)

var (
	orchestrateMessageType string
)

var orchestrateMessageCmd = &cobra.Command{
	Use:   "message <task-run-id> <message>",
	Short: "Send a message to a running agent via mailbox",
	Long: `Send a message to a running agent in a sandbox via the mailbox MCP.

The message is written to the agent's MAILBOX.json file.

Message types:
  handoff   - Transfer work to another agent
  request   - Request the agent to do something specific
  status    - Broadcast progress updates

Examples:
  devsh orchestrate message <task-run-id> "Fix the login bug" --type request
  devsh orchestrate message <task-run-id> "Ready for next step" --type handoff
  devsh orchestrate message <task-run-id> "Completed database setup" --type status`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		taskRunID := args[0]
		message := args[1]

		if orchestrateMessageType == "" {
			return fmt.Errorf("--type flag is required (handoff, request, or status)")
		}

		// Validate message type
		validTypes := map[string]bool{
			"handoff": true,
			"request": true,
			"status":  true,
		}
		if !validTypes[orchestrateMessageType] {
			return fmt.Errorf("invalid message type: %s (must be handoff, request, or status)", orchestrateMessageType)
		}

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

		err = client.SendOrchestrateMessage(ctx, taskRunID, message, orchestrateMessageType, teamSlug)
		if err != nil {
			return fmt.Errorf("failed to send message: %w", err)
		}

		fmt.Printf("Message sent to task run %s\n", taskRunID)
		return nil
	},
}

func init() {
	orchestrateMessageCmd.Flags().StringVar(
		&orchestrateMessageType,
		"type",
		"",
		"Message type: handoff, request, or status (required)",
	)
	orchestrateCmd.AddCommand(orchestrateMessageCmd)
}
