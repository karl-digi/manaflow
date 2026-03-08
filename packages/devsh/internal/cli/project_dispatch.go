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

var (
	projectDispatchProjectID string
)

var projectDispatchCmd = &cobra.Command{
	Use:   "dispatch --project-id <id>",
	Short: "Dispatch a project plan (create orchestration tasks)",
	Long: `Dispatch a project plan by creating orchestration tasks for each plan task.

This connects plan tasks to orchestration tasks via orchestrationTaskId, enabling
automatic status sync as agents complete work.

Examples:
  devsh project dispatch --project-id s179v13t7hc0zga60pbv419ck982bt8r
  devsh project dispatch --project-id s179v13t7hc0zga60pbv419ck982bt8r --json`,
	RunE: runProjectDispatch,
}

func runProjectDispatch(cmd *cobra.Command, args []string) error {
	if projectDispatchProjectID == "" {
		return fmt.Errorf("--project-id flag is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
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

	result, err := client.DispatchProject(ctx, vm.DispatchProjectOptions{
		ProjectID: projectDispatchProjectID,
	})
	if err != nil {
		return fmt.Errorf("failed to dispatch project: %w", err)
	}

	if flagJSON {
		data, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	fmt.Printf("Dispatched %d task(s) from project plan.\n", result.Dispatched)
	fmt.Println("Tasks are now linked to orchestration and will auto-sync status on completion.")
	return nil
}

func init() {
	projectDispatchCmd.Flags().StringVar(&projectDispatchProjectID, "project-id", "", "Convex project document ID (required)")
	projectCmd.AddCommand(projectDispatchCmd)
}
