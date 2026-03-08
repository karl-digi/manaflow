// internal/cli/orchestrate_debug.go
package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/vm"
	"github.com/spf13/cobra"
)

var (
	debugShowEvents bool
	debugShowDeps   bool
	debugShowHealth bool
)

var orchestrateDebugCmd = &cobra.Command{
	Use:   "debug [orch-task-id]",
	Short: "Debug orchestration task or show system health",
	Long: `Debug a specific orchestration task or show overall system health.

Without a task ID, shows provider health and circuit breaker states.
With a task ID, shows detailed task info including dependency graph.

Flags:
  --events    Stream EVENTS.jsonl from sandbox (requires task ID with sandbox)
  --deps      Show dependency graph for the task
  --health    Show provider circuit breaker states and health metrics

Examples:
  devsh orchestrate debug                    # Show overall health
  devsh orchestrate debug --health           # Same as above
  devsh orchestrate debug <task-id>          # Show task details
  devsh orchestrate debug <task-id> --deps   # Show dependency graph
  devsh orchestrate debug <task-id> --events # Stream events from sandbox`,
	Args: cobra.MaximumNArgs(1),
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

		// If no task ID provided, show health overview
		if len(args) == 0 || debugShowHealth {
			return showHealthOverview(ctx, client)
		}

		orchTaskID := args[0]

		// Show task dependency graph
		if debugShowDeps {
			return showDependencyGraph(ctx, client, orchTaskID)
		}

		// Stream events from sandbox
		if debugShowEvents {
			return streamEvents(ctx, client, orchTaskID)
		}

		// Default: show detailed task info
		return showTaskDetails(ctx, client, orchTaskID)
	},
}

func showHealthOverview(ctx context.Context, client *vm.Client) error {
	metrics, err := client.OrchestrationMetrics(ctx)
	if err != nil {
		return fmt.Errorf("failed to get metrics: %w", err)
	}

	if flagJSON {
		data, _ := json.MarshalIndent(metrics, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	fmt.Println("Orchestration Health Overview")
	fmt.Println("==============================")
	fmt.Printf("Active Orchestrations: %d\n", metrics.ActiveOrchestrations)
	fmt.Println()

	// Tasks by status
	fmt.Println("Tasks by Status:")
	statuses := []string{"pending", "assigned", "running", "completed", "failed", "cancelled"}
	for _, status := range statuses {
		count := metrics.TasksByStatus[status]
		bar := strings.Repeat("|", min(count, 50))
		fmt.Printf("  %-10s %3d %s\n", status, count, bar)
	}
	fmt.Println()

	// Provider health
	fmt.Println("Provider Health:")
	fmt.Println("-----------------")

	// Sort providers for consistent output
	providers := make([]string, 0, len(metrics.ProviderHealth))
	for p := range metrics.ProviderHealth {
		providers = append(providers, p)
	}
	sort.Strings(providers)

	for _, provider := range providers {
		info := metrics.ProviderHealth[provider]
		statusIcon := getStatusIcon(info.Status)
		circuitIcon := getCircuitIcon(info.CircuitState)

		fmt.Printf("  %s %-12s %s Circuit: %-10s\n", statusIcon, provider, circuitIcon, info.CircuitState)
		fmt.Printf("      Latency P50: %6.0fms  P99: %6.0fms\n", info.LatencyP50, info.LatencyP99)
		fmt.Printf("      Success Rate: %5.1f%%  Failures: %d\n", info.SuccessRate*100, info.FailureCount)
	}

	return nil
}

func showDependencyGraph(ctx context.Context, client *vm.Client, orchTaskID string) error {
	// Get the task status first
	result, err := client.OrchestrationStatus(ctx, orchTaskID)
	if err != nil {
		return fmt.Errorf("failed to get task: %w", err)
	}

	task := result.Task

	if flagJSON {
		data, _ := json.MarshalIndent(map[string]interface{}{
			"taskId":       task.ID,
			"status":       task.Status,
			"dependencies": task.Dependencies,
		}, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	fmt.Println("Dependency Graph")
	fmt.Println("================")
	fmt.Printf("Task: %s\n", task.ID)
	fmt.Printf("Status: %s\n", task.Status)
	fmt.Println()

	if len(task.Dependencies) == 0 {
		fmt.Println("No dependencies")
	} else {
		fmt.Printf("Blocked by %d task(s):\n", len(task.Dependencies))
		for _, depID := range task.Dependencies {
			// Try to get status of each dependency
			depResult, err := client.OrchestrationStatus(ctx, depID)
			if err != nil {
				fmt.Printf("  [?] %s (status unknown)\n", depID)
			} else {
				icon := getStatusIcon(depResult.Task.Status)
				fmt.Printf("  %s %s (%s)\n", icon, depID, depResult.Task.Status)
			}
		}
	}

	// Also show what this task might be blocking
	listResult, err := client.OrchestrationList(ctx, "")
	if err == nil {
		blocking := []string{}
		for _, t := range listResult.Tasks {
			for _, dep := range t.Dependencies {
				if dep == orchTaskID {
					blocking = append(blocking, t.ID)
					break
				}
			}
		}
		if len(blocking) > 0 {
			fmt.Println()
			fmt.Printf("Blocking %d task(s):\n", len(blocking))
			for _, blockID := range blocking {
				fmt.Printf("  -> %s\n", blockID)
			}
		}
	}

	return nil
}

func streamEvents(ctx context.Context, client *vm.Client, orchTaskID string) error {
	// Get task to find sandbox/instance info
	result, err := client.OrchestrationStatus(ctx, orchTaskID)
	if err != nil {
		return fmt.Errorf("failed to get task: %w", err)
	}

	if result.TaskRun == nil {
		return fmt.Errorf("task has no linked task run - cannot stream events")
	}

	fmt.Fprintf(os.Stderr, "Streaming events from task run: %s\n", result.TaskRun.ID)
	fmt.Fprintf(os.Stderr, "Note: Event streaming requires sandbox access\n")
	fmt.Fprintf(os.Stderr, "Events path: /root/lifecycle/memory/orchestration/EVENTS.jsonl\n")
	fmt.Fprintf(os.Stderr, "\n--- Events would appear here if sandbox is accessible ---\n")

	// TODO: Implement actual event streaming via sandbox exec or workerUrl websocket
	// For now, show instructions for manual access
	if result.TaskRun.VSCodeURL != "" {
		fmt.Fprintf(os.Stderr, "\nOpen VSCode to view events:\n  %s\n", result.TaskRun.VSCodeURL)
	}

	return nil
}

func showTaskDetails(ctx context.Context, client *vm.Client, orchTaskID string) error {
	result, err := client.OrchestrationStatus(ctx, orchTaskID)
	if err != nil {
		return fmt.Errorf("failed to get task: %w", err)
	}

	if flagJSON {
		data, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	task := result.Task

	fmt.Println("Orchestration Task Debug")
	fmt.Println("========================")
	fmt.Printf("ID:       %s\n", task.ID)
	fmt.Printf("Status:   %s %s\n", getStatusIcon(task.Status), task.Status)
	fmt.Printf("Priority: %d\n", task.Priority)
	fmt.Println()

	fmt.Println("Prompt:")
	fmt.Println("-------")
	// Wrap long prompts
	if len(task.Prompt) > 200 {
		fmt.Printf("%s...\n", task.Prompt[:200])
	} else {
		fmt.Println(task.Prompt)
	}
	fmt.Println()

	if task.AssignedAgentName != nil {
		fmt.Printf("Agent:    %s\n", *task.AssignedAgentName)
	}

	fmt.Println()
	fmt.Println("Timeline:")
	fmt.Println("---------")
	fmt.Printf("  Created: %s\n", time.Unix(task.CreatedAt/1000, 0).Format(time.RFC3339))
	if task.StartedAt != nil {
		fmt.Printf("  Started: %s\n", time.Unix(*task.StartedAt/1000, 0).Format(time.RFC3339))
	}
	if task.CompletedAt != nil {
		fmt.Printf("  Ended:   %s\n", time.Unix(*task.CompletedAt/1000, 0).Format(time.RFC3339))
	}

	if task.ErrorMessage != nil {
		fmt.Println()
		fmt.Println("Error:")
		fmt.Println("------")
		fmt.Printf("%s\n", *task.ErrorMessage)
	}

	if task.Result != nil {
		fmt.Println()
		fmt.Println("Result:")
		fmt.Println("-------")
		fmt.Printf("%s\n", *task.Result)
	}

	if result.TaskRun != nil {
		fmt.Println()
		fmt.Println("Task Run:")
		fmt.Println("---------")
		fmt.Printf("  ID:     %s\n", result.TaskRun.ID)
		fmt.Printf("  Agent:  %s\n", result.TaskRun.Agent)
		fmt.Printf("  Status: %s\n", result.TaskRun.Status)
		if result.TaskRun.VSCodeURL != "" {
			fmt.Printf("  VSCode: %s\n", result.TaskRun.VSCodeURL)
		}
	}

	return nil
}

func getStatusIcon(status string) string {
	switch status {
	case "completed", "healthy":
		return "[OK]"
	case "running", "assigned":
		return "[..]"
	case "pending":
		return "[--]"
	case "failed", "unhealthy":
		return "[XX]"
	case "cancelled":
		return "[~~]"
	case "degraded":
		return "[!!]"
	default:
		return "[??]"
	}
}

func getCircuitIcon(state string) string {
	switch state {
	case "closed":
		return "[OK]"
	case "open":
		return "[XX]"
	case "half-open":
		return "[!!]"
	default:
		return "[??]"
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func init() {
	orchestrateDebugCmd.Flags().BoolVar(&debugShowEvents, "events", false, "Stream EVENTS.jsonl from sandbox")
	orchestrateDebugCmd.Flags().BoolVar(&debugShowDeps, "deps", false, "Show dependency graph")
	orchestrateDebugCmd.Flags().BoolVar(&debugShowHealth, "health", false, "Show provider health metrics")
	orchestrateCmd.AddCommand(orchestrateDebugCmd)
}
