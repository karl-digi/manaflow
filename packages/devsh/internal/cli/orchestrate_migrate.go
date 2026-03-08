// internal/cli/orchestrate_migrate.go
package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/vm"
	"github.com/spf13/cobra"
)

var orchestrateMigratePlanFile string
var orchestrateMigrateAgentsFile string
var orchestrateMigrateAgent string
var orchestrateMigrateRepo string
var orchestrateMigrateBranch string

var orchestrateMigrateCmd = &cobra.Command{
	Use:   "migrate",
	Short: "Migrate orchestration state to sandbox",
	Long: `Upload local orchestration state (PLAN.json) to a sandbox
and spawn the head agent to continue execution.

This enables hybrid execution where a local head agent can create
an orchestration plan, then hand off to a sandbox for long-running
execution while the local machine disconnects.

Examples:
  devsh orchestrate migrate --plan-file ./PLAN.json
  devsh orchestrate migrate --plan-file ./PLAN.json --agents-file ./AGENTS.json
  devsh orchestrate migrate --plan-file ./PLAN.json --agent claude/opus-4.5`,
	RunE: runOrchestrateMigrate,
}

func runOrchestrateMigrate(cmd *cobra.Command, args []string) error {
	if orchestrateMigratePlanFile == "" {
		return fmt.Errorf("--plan-file flag is required")
	}

	// Read PLAN.json
	planBytes, err := os.ReadFile(orchestrateMigratePlanFile)
	if err != nil {
		return fmt.Errorf("failed to read plan file: %w", err)
	}

	// Validate it's valid JSON
	var planCheck map[string]interface{}
	if err := json.Unmarshal(planBytes, &planCheck); err != nil {
		return fmt.Errorf("plan file is not valid JSON: %w", err)
	}

	// Read AGENTS.json if provided
	var agentsJson string
	if orchestrateMigrateAgentsFile != "" {
		agentsBytes, err := os.ReadFile(orchestrateMigrateAgentsFile)
		if err != nil {
			return fmt.Errorf("failed to read agents file: %w", err)
		}
		agentsJson = string(agentsBytes)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
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

	result, err := client.OrchestrationMigrate(ctx, vm.OrchestrationMigrateOptions{
		PlanJson:   string(planBytes),
		AgentsJson: agentsJson,
		Agent:      orchestrateMigrateAgent,
		Repo:       orchestrateMigrateRepo,
		Branch:     orchestrateMigrateBranch,
	})
	if err != nil {
		return fmt.Errorf("failed to migrate orchestration: %w", err)
	}

	if flagJSON {
		data, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	fmt.Println("Orchestration Migrated")
	fmt.Println("======================")
	fmt.Printf("  Orchestration ID:      %s\n", result.OrchestrationID)
	fmt.Printf("  Orchestration Task ID: %s\n", result.OrchestrationTaskID)
	fmt.Printf("  Task ID:               %s\n", result.TaskID)
	fmt.Printf("  Task Run ID:           %s\n", result.TaskRunID)
	fmt.Printf("  Agent:                 %s\n", result.AgentName)
	fmt.Printf("  Status:                %s\n", result.Status)
	if result.VSCodeURL != "" {
		fmt.Printf("  VSCode:                %s\n", result.VSCodeURL)
	}

	return nil
}

func init() {
	orchestrateMigrateCmd.Flags().StringVar(&orchestrateMigratePlanFile, "plan-file", "", "Path to PLAN.json file (required)")
	orchestrateMigrateCmd.Flags().StringVar(&orchestrateMigrateAgentsFile, "agents-file", "", "Path to AGENTS.json file (optional)")
	orchestrateMigrateCmd.Flags().StringVar(&orchestrateMigrateAgent, "agent", "", "Override head agent (defaults to plan.headAgent)")
	orchestrateMigrateCmd.Flags().StringVar(&orchestrateMigrateRepo, "repo", "", "Repository (owner/repo format)")
	orchestrateMigrateCmd.Flags().StringVar(&orchestrateMigrateBranch, "branch", "", "Base branch")
	orchestrateCmd.AddCommand(orchestrateMigrateCmd)
}
