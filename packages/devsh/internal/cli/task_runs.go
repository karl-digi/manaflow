// internal/cli/task_runs.go
package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/vm"
	"github.com/spf13/cobra"
)

var taskRunsCmd = &cobra.Command{
	Use:   "runs <task-id>",
	Short: "List all runs for a task",
	Long: `List all runs for a task with status, exit codes, and PR URLs.

Examples:
  devsh task runs ns7cv729xdcpgvz1...
  devsh task runs <task-id> --json`,
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
			data, _ := json.MarshalIndent(task.TaskRuns, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		if len(task.TaskRuns) == 0 {
			fmt.Println("No runs found for this task.")
			return nil
		}

		fmt.Printf("%-28s %-15s %-14s %-10s %s\n", "RUN ID", "AGENT", "STATUS", "EXIT", "PR URL")
		fmt.Println(strings.Repeat("-", 28), strings.Repeat("-", 15), strings.Repeat("-", 14), strings.Repeat("-", 10), strings.Repeat("-", 12))

		for _, run := range task.TaskRuns {
			exitCode := "-"
			if run.ExitCode != nil {
				exitCode = fmt.Sprintf("%d", *run.ExitCode)
			}
			prURL := run.PullRequestURL
			if prURL == "" {
				prURL = "-"
			}
			fmt.Printf("%-28s %-15s %-14s %-10s %s\n", run.ID, run.Agent, run.Status, exitCode, prURL)
		}

		return nil
	},
}

func init() {
	taskCmd.AddCommand(taskRunsCmd)
}

