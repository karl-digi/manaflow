// internal/cli/orchestrate_list.go
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

var orchestrateListStatus string

var orchestrateListCmd = &cobra.Command{
	Use:   "list",
	Short: "List orchestration tasks",
	Long: `List orchestration tasks for your team with optional status filtering.

Status values: pending, assigned, running, completed, failed, cancelled

Examples:
  devsh orchestrate list
  devsh orchestrate list --status running
  devsh orchestrate list --status pending --json`,
	Aliases: []string{"ls"},
	RunE: func(cmd *cobra.Command, args []string) error {
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

		result, err := client.OrchestrationList(ctx, orchestrateListStatus)
		if err != nil {
			return fmt.Errorf("failed to list orchestration tasks: %w", err)
		}

		if flagJSON {
			data, _ := json.MarshalIndent(result, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		if len(result.Tasks) == 0 {
			if orchestrateListStatus != "" {
				fmt.Printf("No orchestration tasks with status '%s' found.\n", orchestrateListStatus)
			} else {
				fmt.Println("No orchestration tasks found.")
			}
			return nil
		}

		fmt.Printf("%-30s %-12s %-15s %s\n", "ORCH ID", "STATUS", "AGENT", "PROMPT")
		fmt.Println("------------------------------", "------------", "---------------", "--------------------")

		for _, task := range result.Tasks {
			prompt := task.Prompt
			if len(prompt) > 40 {
				prompt = prompt[:37] + "..."
			}

			agent := "-"
			if task.AssignedAgentName != nil {
				agent = *task.AssignedAgentName
			}
			if len(agent) > 15 {
				agent = agent[:12] + "..."
			}

			fmt.Printf("%-30s %-12s %-15s %s\n", task.ID, task.Status, agent, prompt)
		}

		return nil
	},
}

func init() {
	orchestrateListCmd.Flags().StringVar(&orchestrateListStatus, "status", "", "Filter by status (pending, assigned, running, completed, failed, cancelled)")
	orchestrateCmd.AddCommand(orchestrateListCmd)
}
