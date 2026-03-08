// internal/cli/task_list.go
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

var taskListArchived bool

var taskListCmd = &cobra.Command{
	Use:   "list",
	Short: "List tasks",
	Long: `List all tasks for your team. Shows the same tasks as the web app dashboard.

Examples:
  devsh task list               # List active tasks
  devsh task list --archived    # List archived tasks
  devsh task list --json        # Output as JSON`,
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

		result, err := client.ListTasks(ctx, taskListArchived)
		if err != nil {
			return fmt.Errorf("failed to list tasks: %w", err)
		}

		if flagJSON {
			data, _ := json.MarshalIndent(result, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		if len(result.Tasks) == 0 {
			if taskListArchived {
				fmt.Println("No archived tasks found.")
			} else {
				fmt.Println("No active tasks found. Create one with 'devsh task create'")
			}
			return nil
		}

		fmt.Printf("%-30s %-12s %-15s %-8s %-50s %s\n", "TASK ID", "STATUS", "AGENT", "PR", "PR URL", "PROMPT")
		fmt.Println("------------------------------", "------------", "---------------", "--------", "--------------------------------------------------", "--------------------")

		for _, task := range result.Tasks {
			prompt := task.Prompt
			if len(prompt) > 30 {
				prompt = prompt[:27] + "..."
			}

			agent := task.Agent
			if agent == "" {
				agent = "-"
			}
			if len(agent) > 15 {
				agent = agent[:12] + "..."
			}

			status := task.Status
			if task.IsArchived {
				status = "archived"
			} else if status == "failed" {
				// Keep "failed" status - don't override with "completed"
			} else if task.IsCompleted {
				status = "completed"
			}
			// Append exit code to status if available
			if task.ExitCode != nil {
				status = fmt.Sprintf("%s (exit %d)", status, *task.ExitCode)
			}

			// PR status from mergeStatus field
			prStatus := "-"
			switch task.MergeStatus {
			case "pr_draft":
				prStatus = "draft"
			case "pr_open":
				prStatus = "open"
			case "pr_approved":
				prStatus = "approved"
			case "pr_changes_requested":
				prStatus = "changes"
			case "pr_merged":
				prStatus = "merged"
			case "pr_closed":
				prStatus = "closed"
			}

			// PR URL (truncate if too long)
			prURL := "-"
			if task.PullRequestURL != "" {
				prURL = task.PullRequestURL
				if len(prURL) > 50 {
					prURL = prURL[:47] + "..."
				}
			}

			fmt.Printf("%-30s %-12s %-15s %-8s %-50s %s\n", task.ID, status, agent, prStatus, prURL, prompt)
		}

		return nil
	},
}

func init() {
	taskListCmd.Flags().BoolVar(&taskListArchived, "archived", false, "List archived tasks instead of active tasks")
	taskCmd.AddCommand(taskListCmd)
}
