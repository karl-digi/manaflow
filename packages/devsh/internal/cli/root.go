// internal/cli/root.go
package cli

import (
	"os"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/spf13/cobra"
)

var (
	// Global flags
	flagJSON    bool
	flagVerbose bool

	// Provider selection (optional)
	flagProvider string

	// Config override flags
	flagAPIURL        string
	flagConvexSiteURL string
)

var rootCmd = &cobra.Command{
	Use:   "devsh",
	Short: "devsh - Cloud VMs for development",
	Long: `devsh manages cloud VMs for development.

Quick start:
  devsh login                      # Authenticate (or: devsh auth login)
  devsh start ./my-project         # Create VM, sync directory → returns ID
  devsh new                        # Same as 'devsh start'
  devsh code <id>                  # Open VS Code
  devsh ssh <id>                   # SSH into VM
  devsh sync <id> ./my-project     # Sync files to VM
  devsh pause <id>                 # Pause VM (preserves state)
  devsh resume <id>                # Resume paused VM
  devsh delete <id>                # Delete VM
  devsh ls                         # List all VMs`,
	// Silence usage and errors - we handle our own error output
	SilenceUsage:  true,
	SilenceErrors: true,
	// Apply config overrides before any command runs
	PersistentPreRun: func(cmd *cobra.Command, args []string) {
		// Set config overrides from CLI flags (empty strings are ignored)
		auth.SetConfigOverrides("", "", flagAPIURL, flagConvexSiteURL)
	},
}

func init() {
	// Global flags available to all commands
	rootCmd.PersistentFlags().BoolVar(&flagJSON, "json", false, "Output as JSON")
	rootCmd.PersistentFlags().BoolVarP(&flagVerbose, "verbose", "v", false, "Verbose output")
	rootCmd.PersistentFlags().StringVarP(&flagProvider, "provider", "p", "", "Sandbox provider: morph, pve-lxc (auto-detected from PVE_API_URL/PVE_API_TOKEN env vars)")

	// Config override flags (override env vars and build-time values)
	rootCmd.PersistentFlags().StringVar(&flagAPIURL, "api-url", "", "Override API URL (default: https://cmux-www.karldigi.dev)")
	rootCmd.PersistentFlags().StringVar(&flagConvexSiteURL, "convex-url", "", "Override Convex site URL")

	// Version command
	rootCmd.AddCommand(versionCmd)

	// Auth commands
	rootCmd.AddCommand(authCmd)

	// Team commands
	rootCmd.AddCommand(teamCmd)

	// Root-level shorthand commands for auth (convenience aliases)
	rootCmd.AddCommand(loginCmd)
	rootCmd.AddCommand(logoutCmd)
	rootCmd.AddCommand(whoamiCmd)
}

// Execute runs the root command
func Execute() error {
	// Enable Cobra's built-in --version flag (prints short version).
	// Keep the `devsh version` command for detailed build info.
	rootCmd.Version = GetVersion()
	rootCmd.SetVersionTemplate("devsh version {{.Version}}\n")
	return rootCmd.Execute()
}

// Helper to check if output is a terminal
func isTerminal(f *os.File) bool {
	fi, err := f.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}
