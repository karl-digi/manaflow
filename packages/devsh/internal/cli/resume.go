// internal/cli/resume.go
package cli

import (
	"context"
	"fmt"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/provider"
	"github.com/karlorz/devsh/internal/pvelxc"
	"github.com/karlorz/devsh/internal/state"
	"github.com/karlorz/devsh/internal/vm"
	"github.com/spf13/cobra"
)

var resumeCmd = &cobra.Command{
	Use:   "resume <id>",
	Short: "Resume a paused VM",
	Long: `Resume a paused VM by its ID.

Examples:
  devsh resume cmux_abc123`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		instanceID := args[0]

		fmt.Printf("Resuming VM %s...\n", instanceID)
		selected, err := resolveProviderForInstance(instanceID)
		if err != nil {
			return err
		}

		timeout := 2 * time.Minute
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

			if err := client.ResumeInstance(ctx, instanceID); err != nil {
				return fmt.Errorf("failed to resume VM: %w", err)
			}

			instance, err := client.GetInstance(ctx, instanceID)
			if err != nil {
				return fmt.Errorf("failed to get instance: %w", err)
			}

			_ = state.SetLastInstance(instance.ID, "")

			fmt.Println("\n✓ VM resumed!")
			fmt.Printf("  ID:       %s\n", instance.ID)
			if instance.VSCodeURL != "" {
				fmt.Printf("  VS Code:  %s\n", instance.VSCodeURL)
			}
			if instance.VNCURL != "" {
				fmt.Printf("  VNC:      %s\n", instance.VNCURL)
			}
			if instance.XTermURL != "" {
				fmt.Printf("  XTerm:    %s\n", instance.XTermURL)
			}
			return nil
		case provider.Morph:
			// Get team slug
			teamSlug, err := auth.GetTeamSlug()
			if err != nil {
				return fmt.Errorf("failed to get team: %w", err)
			}

			client, err := vm.NewClient()
			if err != nil {
				return fmt.Errorf("failed to create client: %w", err)
			}
			client.SetTeamSlug(teamSlug)

			if err := client.ResumeInstance(ctx, instanceID); err != nil {
				return fmt.Errorf("failed to resume VM: %w", err)
			}

			// Wait for ready
			fmt.Println("Waiting for VM to be ready...")
			instance, err := client.WaitForReady(ctx, instanceID, 2*time.Minute)
			if err != nil {
				return fmt.Errorf("VM failed to resume: %w", err)
			}

			// Save as last used
			state.SetLastInstance(instanceID, teamSlug)

			// Generate auth token for authenticated URLs
			token, err := getAuthToken(ctx, client, instance.ID)
			if err != nil {
				// Fall back to raw URLs if token generation fails
				fmt.Printf("Warning: could not generate auth token: %v\n", err)
				fmt.Println("\n✓ VM resumed!")
				fmt.Printf("  ID:       %s\n", instance.ID)
				fmt.Printf("  VS Code:  %s\n", instance.VSCodeURL)
				fmt.Printf("  VNC:      %s\n", instance.VNCURL)
				return nil
			}

			// Build authenticated URLs
			codeAuthURL, err := buildAuthURL(instance.WorkerURL, "/code/?folder=/home/cmux/workspace", token)
			if err != nil {
				return fmt.Errorf("failed to build VS Code URL: %w", err)
			}
			vncAuthURL, err := buildAuthURL(instance.WorkerURL, "/vnc/vnc.html?path=vnc/websockify&resize=scale&quality=9&compression=0", token)
			if err != nil {
				return fmt.Errorf("failed to build VNC URL: %w", err)
			}

			fmt.Println("\n✓ VM resumed!")
			fmt.Printf("  ID:       %s\n", instance.ID)
			fmt.Printf("  VS Code:  %s\n", codeAuthURL)
			fmt.Printf("  VNC:      %s\n", vncAuthURL)
			return nil
		default:
			return fmt.Errorf("unsupported provider: %s", selected)
		}
	},
}

func init() {
	rootCmd.AddCommand(resumeCmd)
}
