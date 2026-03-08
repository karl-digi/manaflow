package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/plan"
	"github.com/karlorz/devsh/internal/vm"
	"github.com/spf13/cobra"
)

var (
	projectImportProjectID      string
	projectImportInstallationID int
	projectImportDryRun         bool
)

var projectImportCmd = &cobra.Command{
	Use:   "import <file>",
	Short: "Import a markdown plan into a GitHub Project as draft issues",
	Long: `Parse a markdown plan and create draft issues in a GitHub Project board.

The parser splits by H2 sections ("##"). Each section becomes one draft item.
If no H2 sections are found, the full file is imported as a single draft.

Examples:
  devsh project import ./plan.md --project-id PVT_xxx --installation-id 12345
  devsh project import ./plan.md --project-id PVT_xxx --installation-id 12345 --dry-run`,
	Args: cobra.ExactArgs(1),
	RunE: runProjectImport,
}

func runProjectImport(cmd *cobra.Command, args []string) error {
	if projectImportProjectID == "" {
		return fmt.Errorf("--project-id flag is required")
	}
	if !projectImportDryRun && projectImportInstallationID <= 0 {
		return fmt.Errorf("--installation-id flag is required")
	}

	filePath := args[0]
	content, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("failed to read plan file: %w", err)
	}

	parsedItems := plan.ParsePlanMarkdown(string(content))
	if len(parsedItems) == 0 {
		return fmt.Errorf("no plan items found in %s", filePath)
	}

	if projectImportDryRun {
		if flagJSON {
			output := map[string]interface{}{
				"file":           filePath,
				"projectId":      projectImportProjectID,
				"installationId": projectImportInstallationID,
				"itemCount":      len(parsedItems),
				"items":          parsedItems,
			}
			data, _ := json.MarshalIndent(output, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Printf("Dry run: parsed %d item(s)\n", len(parsedItems))
		for idx, item := range parsedItems {
			fmt.Printf("  %d. %s\n", idx+1, item.Title)
		}
		return nil
	}

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

	draftItems := make([]vm.ProjectDraftItem, 0, len(parsedItems))
	for _, item := range parsedItems {
		draftItems = append(draftItems, vm.ProjectDraftItem{
			Title: item.Title,
			Body:  item.Body,
		})
	}

	result, err := client.BatchCreateDrafts(ctx, vm.BatchCreateDraftsOptions{
		ProjectID:      projectImportProjectID,
		InstallationID: projectImportInstallationID,
		Items:          draftItems,
	})
	if err != nil {
		return fmt.Errorf("failed to import plan: %w", err)
	}

	if flagJSON {
		data, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	successCount := 0
	failedCount := 0
	for _, item := range result.Results {
		if item.ItemID != nil && *item.ItemID != "" {
			successCount++
		} else {
			failedCount++
		}
	}

	fmt.Printf("Imported %d item(s), %d failed\n", successCount, failedCount)
	for _, item := range result.Results {
		if item.ItemID != nil && *item.ItemID != "" {
			fmt.Printf("  ok  %s -> %s\n", item.Title, *item.ItemID)
			continue
		}
		if item.Error != "" {
			fmt.Printf("  err %s (%s)\n", item.Title, item.Error)
		} else {
			fmt.Printf("  err %s\n", item.Title)
		}
	}

	return nil
}

func init() {
	projectImportCmd.Flags().StringVar(&projectImportProjectID, "project-id", "", "GitHub Project node ID (required)")
	projectImportCmd.Flags().IntVar(&projectImportInstallationID, "installation-id", 0, "GitHub App installation ID (required)")
	projectImportCmd.Flags().BoolVar(&projectImportDryRun, "dry-run", false, "Parse and preview items without importing")
	projectCmd.AddCommand(projectImportCmd)
}
