// internal/cli/task_resume.go
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

var taskResumeCmd = &cobra.Command{
	Use:   "resume <task-run-id>",
	Short: "Resume a Codex session from a task run",
	Long: `Resume a Codex session from a task run.

This command retrieves the stored Codex thread-id from the task run and
provides instructions for resuming the session. If the task run has a
stored thread-id, you can resume directly in the sandbox.

Examples:
  # Get resume info for a task run
  devsh task resume <task-run-id>

  # Attach to the sandbox and resume interactively
  devsh task attach <task-run-id>
  # Then in the terminal: codex resume <thread-id>`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		taskRunID := args[0]

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

		if flagJSON {
			output := map[string]interface{}{
				"taskRunId":     taskRun.ID,
				"agentName":     taskRun.AgentName,
				"status":        taskRun.Status,
				"sandboxId":     taskRun.SandboxID,
				"codexThreadId": taskRun.CodexThreadID,
			}
			if taskRun.AutopilotConfig != nil {
				output["autopilotConfig"] = taskRun.AutopilotConfig
			}
			if taskRun.AutopilotStatus != "" {
				output["autopilotStatus"] = taskRun.AutopilotStatus
			}
			data, _ := json.MarshalIndent(output, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Printf("Task Run: %s\n", taskRun.ID)
		fmt.Printf("  Agent: %s\n", taskRun.AgentName)
		fmt.Printf("  Status: %s\n", taskRun.Status)

		if taskRun.SandboxID != "" {
			fmt.Printf("  Sandbox: %s\n", taskRun.SandboxID)
		}

		if taskRun.AutopilotStatus != "" {
			fmt.Printf("  Autopilot Status: %s\n", taskRun.AutopilotStatus)
		}

		fmt.Println()

		if taskRun.CodexThreadID != "" {
			fmt.Println("Codex Session Found!")
			fmt.Printf("  Thread ID: %s\n", taskRun.CodexThreadID)
			fmt.Println()
			fmt.Println("To resume the session:")
			fmt.Println()
			fmt.Println("Option 1: Attach to the running sandbox terminal")
			fmt.Printf("  devsh task attach %s\n", taskRun.ID)
			fmt.Println()
			fmt.Println("Option 2: Execute resume command in sandbox")
			if taskRun.SandboxID != "" {
				fmt.Printf("  devsh exec %s 'codex resume %s'\n", taskRun.SandboxID, taskRun.CodexThreadID)
			}
			fmt.Println()
			fmt.Println("Option 3: Use the resume script in the sandbox")
			if taskRun.SandboxID != "" {
				fmt.Printf("  devsh exec %s '/root/lifecycle/codex-resume.sh'\n", taskRun.SandboxID)
			}
		} else {
			fmt.Println("No Codex thread ID stored for this task run.")
			fmt.Println()
			if taskRun.Status == "running" {
				fmt.Println("The task may still be running. You can attach to it:")
				fmt.Printf("  devsh task attach %s\n", taskRun.ID)
			} else {
				fmt.Println("To start a new task:")
				fmt.Println("  devsh task create --repo <owner/repo> --agent codex/gpt-5.3-codex \"Your prompt\"")
			}
		}

		return nil
	},
}

func init() {
	taskCmd.AddCommand(taskResumeCmd)
}
