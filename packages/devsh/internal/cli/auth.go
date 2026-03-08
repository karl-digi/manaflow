// internal/cli/auth.go
package cli

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/karlorz/devsh/internal/auth"
)

var authCmd = &cobra.Command{
	Use:   "auth",
	Short: "Manage authentication",
	Long:  `Login, logout, and check authentication status.`,
}

var authLoginCmd = &cobra.Command{
	Use:   "login",
	Short: "Login via browser",
	Long: `Authenticate with devsh via your browser.

This opens your default browser to complete the authentication flow.
Once authenticated, your credentials are stored securely and shared
with the devsh CLI.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := auth.Login(); err != nil {
			return err
		}

		if flagJSON {
			output := map[string]interface{}{
				"success": true,
				"message": "Authentication successful",
			}
			data, _ := json.MarshalIndent(output, "", "  ")
			fmt.Println(string(data))
		}

		return nil
	},
}

var authLogoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Logout and clear credentials",
	Long:  `Remove stored authentication credentials.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := auth.Logout(); err != nil {
			return err
		}

		if flagJSON {
			output := map[string]interface{}{
				"success": true,
				"message": "Logged out successfully",
			}
			data, _ := json.MarshalIndent(output, "", "  ")
			fmt.Println(string(data))
		}

		return nil
	},
}

var authStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show authentication status",
	Long:  `Check if you are logged in and show user information.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		// Ensure .env is loaded in dev mode before checking login status
		_ = auth.GetConfig()

		if !auth.IsLoggedIn() {
			if flagJSON {
				output := map[string]interface{}{
					"logged_in": false,
				}
				data, _ := json.MarshalIndent(output, "", "  ")
				fmt.Println(string(data))
			} else {
				fmt.Println("Not logged in. Run 'devsh auth login' to authenticate.")
			}
			return nil
		}

		// Try to get user profile (includes team info)
		profile, err := auth.GetUserProfile()
		if err != nil {
			if flagJSON {
				output := map[string]interface{}{
					"logged_in": true,
					"error":     err.Error(),
				}
				data, _ := json.MarshalIndent(output, "", "  ")
				fmt.Println(string(data))
			} else {
				fmt.Printf("Logged in (unable to fetch user info: %v)\n", err)
			}
			return nil
		}

		// Check for team override from DEVSH_TEAM env var (legacy: DEVBOX_TEAM)
		teamOverride := os.Getenv("DEVSH_TEAM")
		if teamOverride == "" {
			teamOverride = os.Getenv("DEVBOX_TEAM")
		}

		if flagJSON {
			teamOutput := map[string]interface{}{
				"id":           profile.TeamID,
				"slug":         profile.TeamSlug,
				"display_name": profile.TeamDisplayName,
			}
			if teamOverride != "" {
				teamOutput["override"] = teamOverride
			}
			output := map[string]interface{}{
				"logged_in": true,
				"user": map[string]interface{}{
					"id":    profile.UserID,
					"email": profile.Email,
					"name":  profile.Name,
				},
				"team": teamOutput,
			}
			data, _ := json.MarshalIndent(output, "", "  ")
			fmt.Println(string(data))
		} else {
			fmt.Println("✓ Logged in")
			if profile.Email != "" {
				fmt.Printf("  Email: %s\n", profile.Email)
			}
			if profile.Name != "" {
				fmt.Printf("  Name: %s\n", profile.Name)
			}
			// Show team override if set, otherwise show profile team
			if teamOverride != "" {
				fmt.Printf("  Team: %s (override)\n", teamOverride)
			} else if profile.TeamDisplayName != "" {
				fmt.Printf("  Team: %s\n", profile.TeamDisplayName)
			} else if profile.TeamSlug != "" {
				fmt.Printf("  Team: %s\n", profile.TeamSlug)
			}
		}

		return nil
	},
}

var authWhoamiCmd = &cobra.Command{
	Use:   "whoami",
	Short: "Show current user",
	Long:  `Display the currently authenticated user.`,
	RunE:  authStatusCmd.RunE, // Alias for status
}

var authConfigCmd = &cobra.Command{
	Use:   "config",
	Short: "Show auth configuration",
	Long:  `Display the current auth configuration (URLs, project ID, etc.)`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg := auth.GetConfig()

		if flagJSON {
			output := map[string]interface{}{
				"project_id":      cfg.ProjectID,
				"publishable_key": cfg.PublishableKey,
				"cmux_url":        cfg.CmuxURL,
				"convex_site_url": cfg.ConvexSiteURL,
				"server_url":      cfg.ServerURL,
				"stack_auth_url":  cfg.StackAuthURL,
				"is_dev":          cfg.IsDev,
				"build_mode":      auth.GetBuildMode(),
			}
			data, _ := json.MarshalIndent(output, "", "  ")
			fmt.Println(string(data))
		} else {
			fmt.Printf("Build mode:       %s\n", auth.GetBuildMode())
			fmt.Printf("Is dev:           %v\n", cfg.IsDev)
			fmt.Printf("Project ID:       %s\n", cfg.ProjectID)
			fmt.Printf("Publishable key:  %s\n", cfg.PublishableKey)
			fmt.Printf("cmux URL:         %s\n", cfg.CmuxURL)
			fmt.Printf("Convex site URL:  %s\n", cfg.ConvexSiteURL)
			fmt.Printf("Server URL:       %s\n", cfg.ServerURL)
			fmt.Printf("Stack Auth URL:   %s\n", cfg.StackAuthURL)

			// Show env var status
			fmt.Println()
			if token := os.Getenv("DEVSH_REFRESH_TOKEN"); token != "" {
				fmt.Printf("DEVSH_REFRESH_TOKEN: set (%d chars)\n", len(token))
			} else {
				fmt.Println("DEVSH_REFRESH_TOKEN: not set")
			}
		}

		return nil
	},
}

// Root-level shorthand commands (aliases for auth subcommands)
var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Login via browser (shorthand for 'devsh auth login')",
	Long: `Authenticate with devsh via your browser.

This opens your default browser to complete the authentication flow.
Once authenticated, your credentials are stored securely and shared
with the devsh CLI.

This is a shorthand for 'devsh auth login'.`,
	RunE: authLoginCmd.RunE,
}

var logoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Logout and clear credentials (shorthand for 'devsh auth logout')",
	Long: `Remove stored authentication credentials.

This is a shorthand for 'devsh auth logout'.`,
	RunE: authLogoutCmd.RunE,
}

var whoamiCmd = &cobra.Command{
	Use:   "whoami",
	Short: "Show current user (shorthand for 'devsh auth whoami')",
	Long: `Display the currently authenticated user.

This is a shorthand for 'devsh auth whoami'.`,
	RunE: authStatusCmd.RunE,
}

func init() {
	authCmd.AddCommand(authLoginCmd)
	authCmd.AddCommand(authLogoutCmd)
	authCmd.AddCommand(authStatusCmd)
	authCmd.AddCommand(authWhoamiCmd)
	authCmd.AddCommand(authConfigCmd)
}
