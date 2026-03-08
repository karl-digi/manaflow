// internal/cli/task_status.go
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

var taskStatusCmd = &cobra.Command{
	Use:   "status <task-id>",
	Short: "Get task status and details",
	Long: `Get the status and details of a specific task, including all its runs.

Examples:
  devsh task status ns7cv729xdcpgvz1...
  devsh task status <task-id> --json`,
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

		task, err := client.GetTask(ctx, taskID)
		if err != nil {
			return fmt.Errorf("failed to get task: %w", err)
		}

		if flagJSON {
			data, _ := json.MarshalIndent(task, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Println("Task Details")
		fmt.Println("============")
		fmt.Printf("  ID:         %s\n", task.ID)
		fmt.Printf("  Prompt:     %s\n", task.Prompt)
		if task.Repository != "" {
			fmt.Printf("  Repository: %s\n", task.Repository)
		}
		if task.BaseBranch != "" {
			fmt.Printf("  Branch:     %s\n", task.BaseBranch)
		}
		fmt.Printf("  Completed:  %t\n", task.IsCompleted)
		fmt.Printf("  Archived:   %t\n", task.IsArchived)
		if task.CreatedAt > 0 {
			fmt.Printf("  Created:    %s\n", time.Unix(task.CreatedAt/1000, 0).Format(time.RFC3339))
		}

		if len(task.TaskRuns) > 0 {
			fmt.Println()
			fmt.Println("Task Runs")
			fmt.Println("---------")
			for i, run := range task.TaskRuns {
				fmt.Printf("  Run %d:\n", i+1)
				fmt.Printf("    ID:     %s\n", run.ID)
				fmt.Printf("    Agent:  %s\n", run.Agent)
				fmt.Printf("    Status: %s\n", run.Status)
				if run.VSCodeURL != "" {
					fmt.Printf("    VSCode: %s\n", run.VSCodeURL)
				}
				if run.PullRequestURL != "" {
					fmt.Printf("    PR:     %s\n", run.PullRequestURL)
				}
			}
		}

		return nil
	},
}

func init() {
	taskCmd.AddCommand(taskStatusCmd)
}
