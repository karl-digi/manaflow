// internal/cli/down.go
package cli

import (
	"context"
	"fmt"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/provider"
	"github.com/karlorz/devsh/internal/pvelxc"
	"github.com/karlorz/devsh/internal/vm"
	"github.com/spf13/cobra"
)

var deleteCmd = &cobra.Command{
	Use:   "delete <id>",
	Short: "Delete a VM",
	Long: `Delete a VM by its ID.

Use 'devsh pause <id>' to pause instead (preserves state for resume).

Examples:
  devsh delete cmux_abc123`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		instanceID := args[0]

		fmt.Printf("Deleting VM %s...\n", instanceID)
		selected, err := resolveProviderForInstance(instanceID)
		if err != nil {
			return err
		}

		timeout := 30 * time.Second
		if selected == provider.PveLxc {
			timeout = 5 * time.Minute
		}
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()

		switch selected {
		case provider.PveLxc:
			client, err := pvelxc.NewClientFromEnv()
			if err != nil {
				return fmt.Errorf("failed to create PVE LXC client: %w\nSet PVE_API_URL and PVE_API_TOKEN", err)
			}
			if err := client.StopInstance(ctx, instanceID); err != nil {
				return fmt.Errorf("failed to delete VM: %w", err)
			}
		case provider.Morph:
			teamSlug, err := auth.GetTeamSlug()
			if err != nil {
				return fmt.Errorf("failed to get team: %w", err)
			}

			client, err := vm.NewClient()
			if err != nil {
				return fmt.Errorf("failed to create client: %w", err)
			}
			client.SetTeamSlug(teamSlug)

			if err := client.StopInstance(ctx, instanceID); err != nil {
				return fmt.Errorf("failed to delete VM: %w", err)
			}
		default:
			return fmt.Errorf("unsupported provider: %s", selected)
		}

		fmt.Println("✓ VM deleted")
		return nil
	},
}

func init() {
	rootCmd.AddCommand(deleteCmd)
}
