// internal/cli/task_retry.go
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

var (
	taskRetryAgent       string
	taskRetryMaxRetries  int
	taskRetryDryRun      bool
	taskRetryChecksLimit int
)

var taskRetryCmd = &cobra.Command{
	Use:   "retry <task-id>",
	Short: "Retry a task when PR checks fail (quality gate)",
	Long: `Retry an existing task by spawning a new agent run on the same PR branch,
injecting error context from the previous run (crown feedback + failing checks).

This is designed for head-agent automation: when an agent produces a PR but CI/checks fail,
you can re-dispatch an agent with the failure context and have it push fixes to the same PR branch.

Examples:
  devsh task retry ns7cv729xdcpgvz1...
  devsh task retry ns7cv729xdcpgvz1... --agent claude/haiku-4.5
  devsh task retry ns7cv729xdcpgvz1... --max-retries 2 --dry-run
  devsh task retry ns7cv729xdcpgvz1... --json`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		taskID := args[0]

		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
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

		// Load task for base prompt + repo info
		task, err := client.GetTask(ctx, taskID)
		if err != nil {
			return fmt.Errorf("failed to get task: %w", err)
		}

		// Fetch quality gate status + retry context
		qg, err := client.GetTaskQualityGate(ctx, taskID, taskRetryMaxRetries, taskRetryChecksLimit)
		if err != nil {
			return fmt.Errorf("failed to get task quality gate status: %w", err)
		}

		// Resolve agent (explicit flag wins)
		agentName := strings.TrimSpace(taskRetryAgent)
		if agentName == "" {
			if qg.TaskRunID != nil {
				for _, run := range task.TaskRuns {
					if run.ID == *qg.TaskRunID {
						// Check both Agent and AgentName (API returns agentName)
						if strings.TrimSpace(run.Agent) != "" {
							agentName = strings.TrimSpace(run.Agent)
							break
						}
						if strings.TrimSpace(run.AgentName) != "" {
							agentName = strings.TrimSpace(run.AgentName)
							break
						}
					}
				}
			}
		}
		if agentName == "" {
			for _, run := range task.TaskRuns {
				// Check both Agent and AgentName (API returns agentName)
				if strings.TrimSpace(run.Agent) != "" {
					agentName = strings.TrimSpace(run.Agent)
					break
				}
				if strings.TrimSpace(run.AgentName) != "" {
					agentName = strings.TrimSpace(run.AgentName)
					break
				}
			}
		}
		if agentName == "" {
			agentName = "claude/opus-4.5"
		}

		eligible := qg.Retry.ShouldRetry
		reason := ""
		if !eligible {
			switch {
			case qg.Retry.HasInFlightRun:
				reason = "A task run is still pending/running"
			case qg.QualityGate.HasAnyRunning:
				reason = "Checks are still running"
			case !qg.QualityGate.HasAnyFailure:
				reason = "No failing checks detected"
			case qg.Retry.Attempted >= qg.Retry.MaxRetries:
				reason = "Max retries reached"
			case qg.Retry.RetryBranch == nil || strings.TrimSpace(*qg.Retry.RetryBranch) == "":
				reason = "Missing retry branch (no PR head ref)"
			default:
				reason = "Not eligible"
			}
		}

		// Dry-run or not eligible: print status only (no dispatch)
		if taskRetryDryRun || !eligible {
			if flagJSON {
				output := map[string]interface{}{
					"taskId":            taskID,
					"eligible":          eligible,
					"reason":            reason,
					"resolvedAgentName": agentName,
					"retryBranch":       derefString(qg.Retry.RetryBranch, ""),
					"qualityGate":       qg,
				}
				data, _ := json.MarshalIndent(output, "", "  ")
				fmt.Println(string(data))
				return nil
			}

			if eligible && taskRetryDryRun {
				fmt.Println("Retry eligible (dry-run).")
				fmt.Printf("  Task: %s\n", taskID)
				fmt.Printf("  Agent: %s\n", agentName)
				fmt.Printf("  Retry branch: %s\n", derefString(qg.Retry.RetryBranch, "(none)"))
				fmt.Println()
				fmt.Println(qg.Retry.Context)
				return nil
			}

			fmt.Println("No retry needed (or not eligible).")
			fmt.Printf("  Quality Gate: %s\n", qg.QualityGate.Status)
			if qg.PullRequest != nil {
				fmt.Printf("  PR: %s#%d\n", qg.PullRequest.RepoFullName, qg.PullRequest.Number)
			}
			fmt.Printf("  Retries: %d/%d\n", qg.Retry.Attempted, qg.Retry.MaxRetries)
			if reason != "" {
				fmt.Printf("  Reason: %s\n", reason)
			}
			return nil
		}

		projectFullName := strings.TrimSpace(task.Repository)
		if projectFullName == "" {
			return fmt.Errorf("task %s has no repository set; cannot retry via /api/start-task", taskID)
		}

		baseBranch := strings.TrimSpace(task.BaseBranch)
		if baseBranch == "" {
			baseBranch = "main"
		}

		repoURL := fmt.Sprintf("https://github.com/%s", projectFullName)

		attempt := qg.Retry.Attempted + 1
		retryPrompt := strings.TrimSpace(task.Prompt)
		retryPrompt += fmt.Sprintf("\n\n<!-- cmux-head-agent-retry attempt=%d previous_run=%s -->\n\n%s\n", attempt, derefString(qg.TaskRunID, "unknown"), qg.Retry.Context)

		agentResult, err := client.StartTaskAgents(ctx, vm.StartTaskAgentsOptions{
			TaskID:          taskID,
			TaskDescription: retryPrompt,
			ProjectFullName: projectFullName,
			RepoURL:         repoURL,
			Branch:          baseBranch,
			BranchNames:     []string{derefString(qg.Retry.RetryBranch, "")},
			SelectedAgents:  []string{agentName},
			IsCloudMode:     true,
		})
		if err != nil {
			return fmt.Errorf("failed to start retry agent: %w", err)
		}

		if flagJSON {
			output := map[string]interface{}{
				"taskId":            taskID,
				"eligible":          true,
				"dispatched":        true,
				"resolvedAgentName": agentName,
				"retryBranch":       derefString(qg.Retry.RetryBranch, ""),
				"qualityGate":       qg,
				"startTaskResult":   agentResult,
			}
			data, _ := json.MarshalIndent(output, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Println("Retry dispatched")
		fmt.Printf("  Task ID: %s\n", agentResult.TaskID)
		for _, r := range agentResult.Results {
			if r.Success {
				fmt.Printf("  Started: %s\n", r.AgentName)
				fmt.Printf("    TaskRun: %s\n", r.TaskRunID)
				if r.VSCodeURL != "" {
					fmt.Printf("    VSCode:  %s\n", r.VSCodeURL)
				}
			} else {
				fmt.Printf("  Failed: %s - %s\n", r.AgentName, r.Error)
			}
		}

		return nil
	},
}

func derefString(ptr *string, fallback string) string {
	if ptr == nil || strings.TrimSpace(*ptr) == "" {
		return fallback
	}
	return strings.TrimSpace(*ptr)
}

func init() {
	taskRetryCmd.Flags().StringVar(&taskRetryAgent, "agent", "", "Agent to run for retry (defaults to previous run's agent)")
	taskRetryCmd.Flags().IntVar(&taskRetryMaxRetries, "max-retries", 2, "Max retry attempts per task (counts previous retries)")
	taskRetryCmd.Flags().BoolVar(&taskRetryDryRun, "dry-run", false, "Print retry context without dispatching")
	taskRetryCmd.Flags().IntVar(&taskRetryChecksLimit, "checks-limit", 50, "Max checks to fetch for quality gate context (default 50)")
	taskCmd.AddCommand(taskRetryCmd)
}
