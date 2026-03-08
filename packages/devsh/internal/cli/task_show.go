// internal/cli/task_show.go
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

var taskShowCmd = &cobra.Command{
	Use:   "show <task-id>",
	Short: "Show detailed task information",
	Long: `Show detailed task info including runs, exit codes, PR state, and crown status.

Examples:
  devsh task show ns7cv729xdcpgvz1...
  devsh task show <task-id> --json`,
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

		status := "active"
		if task.IsArchived {
			status = "archived"
		} else if task.IsCompleted {
			status = "completed"
		}

		fmt.Println("Task")
		fmt.Println("====")
		fmt.Printf("  ID:        %s\n", task.ID)
		fmt.Printf("  Status:    %s\n", status)
		fmt.Printf("  Pinned:    %t\n", task.Pinned)
		if task.Repository != "" {
			fmt.Printf("  Repo:      %s\n", task.Repository)
		}
		if task.BaseBranch != "" {
			fmt.Printf("  Branch:    %s\n", task.BaseBranch)
		}
		if task.PRTitle != "" {
			fmt.Printf("  PR Title:  %s\n", task.PRTitle)
		}
		if task.MergeStatus != "" {
			fmt.Printf("  PR State:  %s\n", task.MergeStatus)
		}
		if task.CrownStatus != "" {
			fmt.Printf("  Crown:     %s\n", task.CrownStatus)
			if task.CrownError != "" {
				fmt.Printf("  Crown Err: %s\n", task.CrownError)
			}
		}
		if len(task.Images) > 0 {
			fmt.Printf("  Images:    %d\n", len(task.Images))
			// Show up to 3 image filenames for quick inspection.
			var names []string
			for _, img := range task.Images {
				if img.FileName != "" {
					names = append(names, img.FileName)
				}
				if len(names) >= 3 {
					break
				}
			}
			if len(names) > 0 {
				fmt.Printf("  Files:     %s\n", strings.Join(names, ", "))
			}
		}
		if task.CreatedAt > 0 {
			fmt.Printf("  Created:   %s\n", time.Unix(task.CreatedAt/1000, 0).Format(time.RFC3339))
		}
		if task.UpdatedAt > 0 {
			fmt.Printf("  Updated:   %s\n", time.Unix(task.UpdatedAt/1000, 0).Format(time.RFC3339))
		}

		if len(task.TaskRuns) > 0 {
			fmt.Println()
			fmt.Println("Runs")
			fmt.Println("----")
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
		}

		return nil
	},
}

func init() {
	taskCmd.AddCommand(taskShowCmd)
}

