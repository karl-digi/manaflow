// internal/cli/task_autopilot.go
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
	taskAutopilotMinutes       int
	taskAutopilotTurnMinutes   int
	taskAutopilotWrapUpMinutes int
	taskAutopilotResume        bool
)

var taskAutopilotCmd = &cobra.Command{
	Use:   "autopilot <task-run-id> [prompt]",
	Short: "Start or manage an autopilot session for a task run",
	Long: `Start or manage an autopilot session for a task run.

Autopilot mode runs the agent in a loop with heartbeat-based timeout extension,
allowing for long-running sessions that can span hours.

Without --resume, starts a new autopilot session with the given prompt.
With --resume, attempts to resume an existing autopilot session.

Examples:
  # Start a 2-hour autopilot session
  devsh task autopilot <task-run-id> "Implement feature X" --minutes 120

  # Resume an existing autopilot session
  devsh task autopilot <task-run-id> --resume

  # Check autopilot status
  devsh task autopilot <task-run-id> --status`,
	Args: cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		taskRunID := args[0]

		// Use short timeout for initial API calls
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

		// Get task run info
		taskRun, err := client.GetTaskRunWithPty(ctx, taskRunID)
		if err != nil {
			return fmt.Errorf("failed to get task run: %w", err)
		}

		if taskRun.Status != "running" {
			return fmt.Errorf("task run is not running (status: %s)", taskRun.Status)
		}

		// Resume mode - show current autopilot status and resume options
		if taskAutopilotResume {
			return handleAutopilotResume(ctx, client, taskRun)
		}

		// Start mode - need a prompt
		if len(args) < 2 {
			return fmt.Errorf("prompt is required when starting autopilot (or use --resume)")
		}
		prompt := args[1]

		// Use longer timeout for autopilot start (script triggers async execution)
		startCtx, startCancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer startCancel()

		return handleAutopilotStart(startCtx, client, taskRun, prompt)
	},
}

func handleAutopilotResume(ctx context.Context, client *vm.Client, taskRun *vm.TaskRun) error {
	fmt.Printf("Autopilot Resume for Task Run: %s\n", taskRun.ID)
	fmt.Printf("  Agent: %s\n", taskRun.AgentName)
	fmt.Printf("  Status: %s\n", taskRun.Status)

	if taskRun.AutopilotConfig != nil {
		fmt.Println("\nAutopilot Configuration:")
		fmt.Printf("  Enabled: %v\n", taskRun.AutopilotConfig.Enabled)
		fmt.Printf("  Total Minutes: %d\n", taskRun.AutopilotConfig.TotalMinutes)
		fmt.Printf("  Turn Minutes: %d\n", taskRun.AutopilotConfig.TurnMinutes)
		fmt.Printf("  Wrap-up Minutes: %d\n", taskRun.AutopilotConfig.WrapUpMinutes)
		if taskRun.AutopilotConfig.StartedAt > 0 {
			startTime := time.Unix(taskRun.AutopilotConfig.StartedAt/1000, 0)
			fmt.Printf("  Started At: %s\n", startTime.Format(time.RFC3339))
		}
		if taskRun.AutopilotConfig.LastHeartbeat > 0 {
			heartbeatTime := time.Unix(taskRun.AutopilotConfig.LastHeartbeat/1000, 0)
			fmt.Printf("  Last Heartbeat: %s\n", heartbeatTime.Format(time.RFC3339))
		}
	} else {
		fmt.Println("\n[No autopilot configuration found]")
	}

	if taskRun.AutopilotStatus != "" {
		fmt.Printf("\nAutopilot Status: %s\n", taskRun.AutopilotStatus)
	}

	if taskRun.CodexThreadID != "" {
		fmt.Printf("\nCodex Thread ID: %s\n", taskRun.CodexThreadID)
		fmt.Println("\nTo resume the Codex session in the sandbox:")
		fmt.Printf("  codex resume %s\n", taskRun.CodexThreadID)
	}

	// Get sandbox info
	if taskRun.SandboxID != "" {
		fmt.Printf("\nSandbox: %s\n", taskRun.SandboxID)
		fmt.Println("\nTo attach to the running terminal:")
		fmt.Printf("  devsh task attach %s\n", taskRun.ID)
	}

	return nil
}

func handleAutopilotStart(ctx context.Context, client *vm.Client, taskRun *vm.TaskRun, prompt string) error {
	sandboxID := taskRun.SandboxID
	if sandboxID == "" {
		return fmt.Errorf("no sandbox ID found for this task run")
	}

	fmt.Printf("Starting autopilot for task run %s...\n", taskRun.ID)
	fmt.Printf("  Agent: %s\n", taskRun.AgentName)
	fmt.Printf("  Sandbox: %s\n", sandboxID)
	fmt.Printf("  Duration: %d minutes\n", taskAutopilotMinutes)
	fmt.Printf("  Turn: %d minutes\n", taskAutopilotTurnMinutes)
	fmt.Printf("  Wrap-up: %d minutes\n", taskAutopilotWrapUpMinutes)
	fmt.Println()

	// Get instance info
	instance, err := client.GetInstance(ctx, sandboxID)
	if err != nil {
		return fmt.Errorf("failed to get sandbox instance: %w", err)
	}

	if instance.WorkerURL == "" {
		return fmt.Errorf("sandbox worker URL not available")
	}

	// Shell-escape the prompt for safe inclusion in command
	escapedPrompt := strings.ReplaceAll(prompt, "'", "'\"'\"'")

	// Build the autopilot command to execute in the sandbox
	autopilotCmd := fmt.Sprintf(
		"CMUX_PROMPT='%s' CMUX_AUTOPILOT_MINUTES=%d CMUX_AUTOPILOT_TURN_MINUTES=%d CMUX_AUTOPILOT_WRAPUP_MINUTES=%d /root/lifecycle/codex-autopilot.sh",
		escapedPrompt,
		taskAutopilotMinutes,
		taskAutopilotTurnMinutes,
		taskAutopilotWrapUpMinutes,
	)

	fmt.Printf("Executing autopilot in sandbox...\n")
	fmt.Printf("  Command: %s\n", autopilotCmd)
	fmt.Println()

	// Execute the autopilot script in the sandbox
	stdout, stderr, exitCode, err := client.ExecCommand(ctx, sandboxID, autopilotCmd)
	if err != nil {
		return fmt.Errorf("failed to start autopilot: %w", err)
	}

	if flagJSON {
		output := map[string]interface{}{
			"taskRunId":   taskRun.ID,
			"sandboxId":   sandboxID,
			"status":      "started",
			"minutes":     taskAutopilotMinutes,
			"turnMinutes": taskAutopilotTurnMinutes,
			"wrapUp":      taskAutopilotWrapUpMinutes,
		}
		data, _ := json.MarshalIndent(output, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	fmt.Println("Autopilot started successfully!")
	fmt.Printf("  Exit Code: %d\n", exitCode)
	if stdout != "" {
		fmt.Printf("  Output: %s\n", stdout)
	}
	if stderr != "" {
		fmt.Printf("  Stderr: %s\n", stderr)
	}
	fmt.Println()
	fmt.Println("To monitor the session:")
	fmt.Printf("  devsh task attach %s\n", taskRun.ID)
	fmt.Println()
	fmt.Println("To stop autopilot:")
	fmt.Printf("  devsh exec %s 'touch /root/lifecycle/autopilot-stop'\n", sandboxID)

	return nil
}

func init() {
	taskAutopilotCmd.Flags().IntVar(&taskAutopilotMinutes, "minutes", 30, "Total autopilot duration in minutes")
	taskAutopilotCmd.Flags().IntVar(&taskAutopilotTurnMinutes, "turn-minutes", 5, "Minutes per turn")
	taskAutopilotCmd.Flags().IntVar(&taskAutopilotWrapUpMinutes, "wrap-up-minutes", 3, "Minutes before deadline to wrap up")
	taskAutopilotCmd.Flags().BoolVar(&taskAutopilotResume, "resume", false, "Resume an existing autopilot session")
	taskCmd.AddCommand(taskAutopilotCmd)
}
