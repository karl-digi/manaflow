// internal/cli/start.go
package cli

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/e2b"
	"github.com/karlorz/devsh/internal/mirrorlocal"
	"github.com/karlorz/devsh/internal/provider"
	"github.com/karlorz/devsh/internal/pvelxc"
	"github.com/karlorz/devsh/internal/state"
	"github.com/karlorz/devsh/internal/vm"
	"github.com/spf13/cobra"
)

var startCmd = &cobra.Command{
	Use:     "start [path]",
	Aliases: []string{"new"},
	Short:   "Create a new VM",
	Long: `Create a new VM and optionally sync a local directory into it.

Each call creates a NEW VM. Use 'devsh resume <id>' to resume a paused VM.

Examples:
  devsh start                    # Create VM (no sync)
  devsh new                      # Same as 'devsh start'
  devsh start .                  # Create VM, sync current directory
  devsh start ./my-project       # Create VM, sync specific directory
  devsh start --snapshot=snap_x  # Create from specific snapshot
  devsh start -i                 # Create VM and open VS Code
  devsh start --no-auth          # Skip ownership recording and provider auth
  devsh start --clean            # Record ownership; skip provider auth injection
  devsh start --mirror-local     # Pack/redact local agent config into the box (pve-lxc)
  devsh start --template name    # Expand ~/.cmux/templates/<name>.yaml into flags`,
	Args: cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := applyStartTemplateFlags(cmd); err != nil {
			return err
		}

		mode, err := resolveStartMode(flagProvider)
		if err != nil {
			return err
		}

		clean, _ := cmd.Flags().GetBool("clean")
		mirrorLocal, _ := cmd.Flags().GetBool("mirror-local")
		orcaServe, _ := cmd.Flags().GetBool("orca-serve")
		targetHome, _ := cmd.Flags().GetString("target-home")
		migrateFromRoot, _ := cmd.Flags().GetBool("migrate-agent-home-from-root")
		if (clean || mirrorLocal || orcaServe || targetHome != "" || migrateFromRoot) && !mode.serverManaged && mode.provider != provider.PveLxc {
			return fmt.Errorf("--clean, --mirror-local, --orca-serve, --target-home and --migrate-agent-home-from-root are only supported for provider pve-lxc (got %s)", mode.provider)
		}
		if mode.serverManaged && (clean || mirrorLocal || orcaServe || targetHome != "" || migrateFromRoot) {
			return fmt.Errorf("--clean, --mirror-local, --orca-serve, --target-home and --migrate-agent-home-from-root require an explicit pve-lxc provider (server-managed start is unsupported for these flags)")
		}

		if mode.serverManaged {
			return runStartServerManaged(cmd, args)
		}

		switch mode.provider {
		case provider.PveLxc:
			return runStartPveLxc(cmd, args)
		case provider.Morph:
			return runStartMorph(cmd, args)
		case provider.E2B:
			return runStartE2B(cmd, args)
		default:
			return fmt.Errorf("unsupported provider: %s", mode.provider)
		}
	},
}

// applyStartTemplateFlags loads --template if set and merges into flag values.
// Explicit CLI flags always win over template defaults.
func applyStartTemplateFlags(cmd *cobra.Command) error {
	templateName, _ := cmd.Flags().GetString("template")
	if strings.TrimSpace(templateName) == "" {
		return nil
	}
	tmpl, err := LoadStartTemplate(templateName)
	if err != nil {
		return err
	}

	cli := StartTemplateFlags{}
	cli.Snapshot, _ = cmd.Flags().GetString("snapshot")
	cli.Clean, _ = cmd.Flags().GetBool("clean")
	cli.MirrorLocal, _ = cmd.Flags().GetBool("mirror-local")
	cli.NoAuth, _ = cmd.Flags().GetBool("no-auth")
	cli.TargetHome, _ = cmd.Flags().GetString("target-home")
	cli.OrcaServe, _ = cmd.Flags().GetBool("orca-serve")
	cli.MigrateAgentHomeFromRoot, _ = cmd.Flags().GetBool("migrate-agent-home-from-root")
	cli.Provider = flagProvider

	cliSet := map[string]bool{
		// Global --provider is not always marked Changed on the local flag set.
		"provider":                     cmd.Flags().Changed("provider") || strings.TrimSpace(flagProvider) != "",
		"snapshot":                     cmd.Flags().Changed("snapshot"),
		"clean":                        cmd.Flags().Changed("clean"),
		"mirror-local":                 cmd.Flags().Changed("mirror-local"),
		"no-auth":                      cmd.Flags().Changed("no-auth"),
		"target-home":                  cmd.Flags().Changed("target-home"),
		"orca-serve":                   cmd.Flags().Changed("orca-serve"),
		"migrate-agent-home-from-root": cmd.Flags().Changed("migrate-agent-home-from-root"),
	}

	merged := ExpandStartTemplate(tmpl, cli, cliSet)
	if merged.Snapshot != "" && !cliSet["snapshot"] {
		_ = cmd.Flags().Set("snapshot", merged.Snapshot)
	}
	if !cliSet["clean"] {
		_ = cmd.Flags().Set("clean", fmt.Sprintf("%t", merged.Clean))
	}
	if !cliSet["mirror-local"] {
		_ = cmd.Flags().Set("mirror-local", fmt.Sprintf("%t", merged.MirrorLocal))
	}
	if !cliSet["no-auth"] {
		_ = cmd.Flags().Set("no-auth", fmt.Sprintf("%t", merged.NoAuth))
	}
	if !cliSet["target-home"] && merged.TargetHome != "" {
		_ = cmd.Flags().Set("target-home", merged.TargetHome)
	}
	if !cliSet["orca-serve"] {
		_ = cmd.Flags().Set("orca-serve", fmt.Sprintf("%t", merged.OrcaServe))
	}
	if !cliSet["migrate-agent-home-from-root"] {
		_ = cmd.Flags().Set("migrate-agent-home-from-root", fmt.Sprintf("%t", merged.MigrateAgentHomeFromRoot))
	}
	if merged.Provider != "" && !cliSet["provider"] {
		flagProvider = merged.Provider
	}
	fmt.Printf("Applied template %q\n", templateName)
	return nil
}

func resolveSandboxTimezone() string {
	if timezone := strings.TrimSpace(os.Getenv("TZ")); timezone != "" {
		return timezone
	}
	if timezone := strings.TrimSpace(os.Getenv("DEFAULT_SANDBOX_TIMEZONE")); timezone != "" {
		return timezone
	}
	return pvelxc.DefaultSandboxTimezone
}

// setupProviderAuthIfNeeded calls SetupProviders on the www API when the
// resolved start auth mode allows it (not --no-auth / --clean / mirror-implied clean).
func setupProviderAuthIfNeeded(cmd *cobra.Command, ctx context.Context, client *vm.Client, instanceID string) {
	noAuth, _ := cmd.Flags().GetBool("no-auth")
	clean, _ := cmd.Flags().GetBool("clean")
	mirrorLocal, _ := cmd.Flags().GetBool("mirror-local")
	mode := ResolveStartAuthMode(noAuth, clean, mirrorLocal)
	if !mode.SetupProviders {
		return
	}

	fmt.Println("Setting up provider auth...")
	result, err := client.SetupProviders(ctx, instanceID)
	if err != nil {
		fmt.Printf("Warning: provider auth setup failed: %v\n", err)
		return
	}
	if len(result.Providers) > 0 {
		fmt.Printf("  Providers: %s\n", strings.Join(result.Providers, ", "))
	} else {
		fmt.Println("  No provider keys configured (add API keys in web UI)")
	}
}

func runStartServerManaged(cmd *cobra.Command, args []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	teamSlug, err := auth.GetTeamSlug()
	if err != nil {
		return fmt.Errorf("failed to get team: %w\nRun 'devsh auth login' to authenticate", err)
	}

	client, err := vm.NewClient()
	if err != nil {
		return fmt.Errorf("failed to create client: %w", err)
	}
	client.SetTeamSlug(teamSlug)

	snapshotID, _ := cmd.Flags().GetString("snapshot")
	_, syncPath, err := resolveOptionalStartPath(args)
	if err != nil {
		return err
	}

	fmt.Println("Starting sandbox...")
	result, err := client.StartWorkspace(ctx, vm.StartWorkspaceOptions{
		SnapshotID: snapshotID,
		TTLSeconds: 3600,
	})
	if err != nil {
		return fmt.Errorf("failed to start sandbox: %w", err)
	}

	fmt.Printf("Sandbox started: %s (%s)\n", result.InstanceID, result.Provider)

	if syncPath != "" {
		if result.Provider == provider.PveLxc {
			fmt.Printf("Warning: sync is not supported for pve-lxc yet (skipping sync of %s)\n", syncPath)
		} else {
			fmt.Printf("Syncing %s to sandbox...\n", syncPath)
			if err := client.SyncToVM(ctx, result.InstanceID, syncPath); err != nil {
				fmt.Printf("Warning: failed to sync files: %v\n", err)
			} else {
				fmt.Println("Files synced successfully")
			}
		}
	}

	state.SetLastInstance(result.InstanceID, teamSlug)

	fmt.Println("\nSandbox is ready!")
	fmt.Printf("  ID:       %s\n", result.InstanceID)
	if result.VSCodeURL != "" {
		fmt.Printf("  VS Code:  %s\n", result.VSCodeURL)
	}
	if result.VncURL != "" {
		fmt.Printf("  VNC:      %s\n", result.VncURL)
	}
	if result.XtermURL != "" {
		fmt.Printf("  XTerm:    %s\n", result.XtermURL)
	}

	interactive, _ := cmd.Flags().GetBool("interactive")
	if interactive && result.VSCodeURL != "" {
		fmt.Println("\nOpening VS Code in browser...")
		if err := openBrowser(result.VSCodeURL); err != nil {
			fmt.Printf("Warning: could not open browser: %v\n", err)
		}
	}

	return nil
}

func runStartMorph(cmd *cobra.Command, args []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// Get team slug
	teamSlug, err := auth.GetTeamSlug()
	if err != nil {
		return fmt.Errorf("failed to get team: %w\nRun 'devsh auth login' to authenticate", err)
	}

	// Create VM client
	client, err := vm.NewClient()
	if err != nil {
		return fmt.Errorf("failed to create client: %w", err)
	}
	client.SetTeamSlug(teamSlug)

	// Get snapshot ID
	snapshotID, _ := cmd.Flags().GetString("snapshot")

	// Determine name from path if provided
	name, syncPath, err := resolveOptionalStartPath(args)
	if err != nil {
		return err
	}

	fmt.Println("Creating VM...")
	instance, err := client.CreateInstance(ctx, vm.CreateOptions{
		SnapshotID: snapshotID,
		Name:       name,
	})
	if err != nil {
		return fmt.Errorf("failed to create VM: %w", err)
	}

	fmt.Printf("VM created: %s\n", instance.ID)

	// Wait for VM to be ready
	fmt.Println("Waiting for VM to be ready...")
	instance, err = client.WaitForReady(ctx, instance.ID, 2*time.Minute)
	if err != nil {
		return fmt.Errorf("VM failed to start: %w", err)
	}

	// Sync directory if specified
	if syncPath != "" {
		fmt.Printf("Syncing %s to VM...\n", syncPath)
		if err := client.SyncToVM(ctx, instance.ID, syncPath); err != nil {
			fmt.Printf("Warning: failed to sync files: %v\n", err)
		} else {
			fmt.Println("Files synced successfully")
		}
	}

	// Set up provider auth (Claude + Codex)
	setupProviderAuthIfNeeded(cmd, ctx, client, instance.ID)

	// Save as last used instance
	state.SetLastInstance(instance.ID, teamSlug)

	// Generate auth token for authenticated URLs
	token, err := getAuthToken(ctx, client, instance.ID)
	if err != nil {
		// Fall back to raw URLs if token generation fails
		fmt.Printf("Warning: could not generate auth token: %v\n", err)
		fmt.Println("\nVM is ready!")
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

	// Output results with authenticated URLs
	fmt.Println("\nVM is ready!")
	fmt.Printf("  ID:       %s\n", instance.ID)
	fmt.Printf("  VS Code:  %s\n", codeAuthURL)
	fmt.Printf("  VNC:      %s\n", vncAuthURL)

	// Open VS Code in browser if interactive mode
	interactive, _ := cmd.Flags().GetBool("interactive")
	if interactive {
		fmt.Println("\nOpening VS Code in browser...")
		if err := openBrowser(codeAuthURL); err != nil {
			fmt.Printf("Warning: could not open browser: %v\n", err)
		}
	}

	return nil
}

func runStartPveLxc(cmd *cobra.Command, args []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	// Get snapshot ID (canonical snapshot_*)
	snapshotID, _ := cmd.Flags().GetString("snapshot")

	// Optional: accept a path argument for consistency, but sync is not yet implemented for PVE LXC.
	_, syncPath, err := resolveOptionalStartPath(args)
	if err != nil {
		return err
	}

	client, err := pvelxc.NewClientFromEnv()
	if err != nil {
		return fmt.Errorf("failed to create PVE LXC client: %w\nSet PVE_API_URL and PVE_API_TOKEN", err)
	}

	fmt.Println("Creating container...")
	instance, err := client.StartInstance(ctx, pvelxc.StartOptions{
		SnapshotID: snapshotID,
	})
	if err != nil {
		return fmt.Errorf("failed to create container: %w", err)
	}

	fmt.Printf("Container created: %s\n", instance.ID)

	timezone := resolveSandboxTimezone()
	result, err := client.ApplyTimezone(ctx, instance.ID, timezone)
	if err != nil {
		fmt.Printf("Warning: failed to set container timezone to %s: %v\n", timezone, err)
	} else if result.ExitCode != 0 {
		combinedOutput := strings.TrimSpace(strings.Join([]string{result.Stderr, result.Stdout}, "\n"))
		if combinedOutput == "" {
			combinedOutput = "no output"
		}
		fmt.Printf("Warning: failed to set container timezone to %s: exit %d: %s\n", timezone, result.ExitCode, combinedOutput)
	}

	if syncPath != "" {
		fmt.Printf("Warning: sync is not supported for pve-lxc yet (skipping sync of %s)\n", syncPath)
	}

	// Ownership vs provider-auth: --clean records ownership only; --no-auth skips both.
	noAuth, _ := cmd.Flags().GetBool("no-auth")
	clean, _ := cmd.Flags().GetBool("clean")
	mirrorLocal, _ := cmd.Flags().GetBool("mirror-local")
	authMode := ResolveStartAuthMode(noAuth, clean, mirrorLocal)
	if authMode.Warning != "" {
		fmt.Printf("Note: %s\n", authMode.Warning)
	}

	if authMode.RecordOwnership || authMode.SetupProviders {
		// PVE LXC path needs a www client for ownership / setup-providers.
		teamSlug, teamErr := auth.GetTeamSlug()
		if teamErr != nil {
			fmt.Printf("Warning: www API skipped (not authenticated): %v\n", teamErr)
		} else {
			wwwClient, wwwErr := vm.NewClient()
			if wwwErr != nil {
				fmt.Printf("Warning: www API client skipped: %v\n", wwwErr)
			} else {
				wwwClient.SetTeamSlug(teamSlug)
				if authMode.RecordOwnership {
					if err := wwwClient.RecordSandboxCreate(ctx, vm.RecordSandboxCreateRequest{
						InstanceID:       instance.ID,
						Provider:         provider.PveLxc,
						VMID:             instance.VMID,
						Hostname:         instance.Hostname,
						SnapshotID:       snapshotID,
						SnapshotProvider: provider.PveLxc,
					}); err != nil {
						fmt.Printf("Warning: failed to record sandbox ownership: %v\n", err)
					}
				}
				if authMode.SetupProviders {
					setupProviderAuthIfNeeded(cmd, ctx, wwwClient, instance.ID)
				}
			}
		}
	}

	// Optional: mirror safe local agent config (soft-fail).
	orcaServe, _ := cmd.Flags().GetBool("orca-serve")
	targetHomeFlag, _ := cmd.Flags().GetString("target-home")
	targetHome := effectiveTargetHome(orcaServe, targetHomeFlag)
	if mirrorLocal {
		if err := mirrorLocalAgentConfig(ctx, client, instance, targetHome); err != nil {
			fmt.Printf("Warning: --mirror-local failed (box remains usable): %v\n", err)
		}
	}

	// Optional: compose Orca Server post-start (B1 → migrate? → workspace gh → matrix).
	// Each step soft-fails with a Warning; the box stays usable.
	if orcaServe {
		migrateFromRoot, _ := cmd.Flags().GetBool("migrate-agent-home-from-root")
		if err := runOrcaServePostStart(ctx, client, instance.ID, OrcaServeOpts{
			MigrateFromRoot: migrateFromRoot,
			WorkspaceGH:     true,
		}); err != nil {
			fmt.Printf("Warning: --orca-serve post-start: %v\n", err)
		}
	}

	// Save as last used instance (team slug not applicable for PVE LXC)
	_ = state.SetLastInstance(instance.ID, "")

	fmt.Println("\nVM is ready!")
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

	interactive, _ := cmd.Flags().GetBool("interactive")
	if interactive && instance.VSCodeURL != "" {
		fmt.Println("\nOpening VS Code in browser...")
		if err := openBrowser(instance.VSCodeURL); err != nil {
			fmt.Printf("Warning: could not open browser: %v\n", err)
		}
	}

	return nil
}

func runStartE2B(cmd *cobra.Command, args []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// Get team slug
	teamSlug, err := auth.GetTeamSlug()
	if err != nil {
		return fmt.Errorf("failed to get team: %w\nRun 'devsh auth login' to authenticate", err)
	}

	// Create E2B client
	client, err := e2b.NewClient()
	if err != nil {
		return fmt.Errorf("failed to create client: %w", err)
	}
	client.SetTeamSlug(teamSlug)

	// Get template ID (uses --snapshot flag for consistency)
	templateID, _ := cmd.Flags().GetString("snapshot")

	// Determine name from path if provided
	name, syncPath, err := resolveOptionalStartPath(args)
	if err != nil {
		return err
	}

	fmt.Println("Creating E2B sandbox...")
	instance, err := client.StartInstance(ctx, e2b.StartOptions{
		TemplateID: templateID,
		Name:       name,
	})
	if err != nil {
		return fmt.Errorf("failed to create sandbox: %w", err)
	}

	fmt.Printf("Sandbox created: %s\n", instance.ID)

	// Wait for sandbox to be ready
	fmt.Println("Waiting for sandbox to be ready...")
	instance, err = client.WaitForReady(ctx, instance.ID, 2*time.Minute)
	if err != nil {
		return fmt.Errorf("sandbox failed to start: %w", err)
	}

	if syncPath != "" {
		fmt.Printf("Warning: sync is not yet supported for E2B (skipping sync of %s)\n", syncPath)
	}

	// Set up provider auth via www API
	noAuth, _ := cmd.Flags().GetBool("no-auth")
	if !noAuth {
		wwwClient, wwwErr := vm.NewClient()
		if wwwErr != nil {
			fmt.Printf("Warning: provider auth setup skipped: %v\n", wwwErr)
		} else {
			wwwClient.SetTeamSlug(teamSlug)
			setupProviderAuthIfNeeded(cmd, ctx, wwwClient, instance.ID)
		}
	}

	// Save as last used instance
	state.SetLastInstance(instance.ID, teamSlug)

	fmt.Println("\nSandbox is ready!")
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

	interactive, _ := cmd.Flags().GetBool("interactive")
	if interactive && instance.VSCodeURL != "" {
		fmt.Println("\nOpening VS Code in browser...")
		if err := openBrowser(instance.VSCodeURL); err != nil {
			fmt.Printf("Warning: could not open browser: %v\n", err)
		}
	}

	return nil
}

// resolveMirrorTargetHome resolves the --target-home flag for --mirror-local.
// Empty or non-absolute values fall back to the default "/root".
func resolveMirrorTargetHome(flag string) string {
	flag = strings.TrimSpace(flag)
	if flag == "" {
		return "/root"
	}
	if !strings.HasPrefix(flag, "/") {
		return "/root" // or return error at call site; keep resolve pure
	}
	return flag
}

// effectiveTargetHome resolves the cloud home for agent config materialization.
// An explicit --target-home always wins; otherwise --orca-serve implies
// /home/orca (Orca Server agent home) and the default stays /root.
func effectiveTargetHome(orcaServe bool, targetHomeFlag string) string {
	if strings.TrimSpace(targetHomeFlag) != "" {
		return resolveMirrorTargetHome(targetHomeFlag)
	}
	if orcaServe {
		return "/home/orca"
	}
	return "/root"
}

// buildMirrorExtractCommand builds the remote shell command that extracts the
// pushed agent-config tar under targetHome. Tar entries are relative like
// .claude/... .codex/... so extraction lands under the target home. When the
// target is /home/orca the extracted config is chowned to orca:orca (the push
// may land as root); the chown is best-effort (2>/dev/null || true).
func buildMirrorExtractCommand(remoteTar, targetHome string) string {
	quotedTar := pvelxc.ShellSingleQuote(remoteTar)
	quotedHome := pvelxc.ShellSingleQuote(targetHome)
	// tar entries are .claude/... .codex/... relative to home
	cmd := fmt.Sprintf("mkdir -p %s && tar -xf %s -C %s && rm -f %s",
		quotedHome, quotedTar, quotedHome, quotedTar)
	if targetHome == "/home/orca" {
		// ensure ownership after extract (push may land as root)
		cmd += " && chown -R orca:orca /home/orca/.claude /home/orca/.codex 2>/dev/null || true"
	}
	return cmd
}

// mirrorLocalAgentConfig packs a redacted ~/.claude + ~/.codex subset and dual-path
// pushes it into the container, then extracts under targetHome (default /root).
// Soft-fail at caller.
func mirrorLocalAgentConfig(ctx context.Context, client *pvelxc.Client, instance *pvelxc.Instance, targetHome string) error {
	fmt.Println("Mirroring local agent config (--mirror-local)...")
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("resolve home: %w", err)
	}
	tmpDir, err := os.MkdirTemp("", "devsh-mirror-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	archivePath := filepath.Join(tmpDir, "agent-config.tar")
	if _, err := mirrorlocal.PackToFile(mirrorlocal.PackOptions{
		HomeDir:         home,
		LocalHomePrefix: home,
		TargetHome:      targetHome,
		IncludeSecrets:  false,
	}, archivePath); err != nil {
		return fmt.Errorf("pack: %w", err)
	}

	remoteTar := "/tmp/devsh-mirror-agent-config.tar"
	result, err := client.PushFileFromEnv(ctx, instance.ID, instance.VMID, archivePath, remoteTar)
	if err != nil {
		return fmt.Errorf("push: %w", err)
	}
	if result != nil {
		fmt.Printf("  Push path: %s\n", result.Path)
	}

	// Extract into targetHome (tar entries are relative like .claude/... .codex/...)
	extractCmd := buildMirrorExtractCommand(remoteTar, targetHome)
	stdout, stderr, code, execErr := client.ExecCommand(ctx, instance.ID, extractCmd)
	if execErr != nil {
		return fmt.Errorf("extract exec: %w", execErr)
	}
	if code != 0 {
		return fmt.Errorf("extract failed (exit %d): %s", code, strings.TrimSpace(stderr+"\n"+stdout))
	}
	fmt.Println("  Local agent config mirrored (secrets redacted)")
	return nil
}

func init() {
	startCmd.Flags().String("snapshot", "", "Snapshot ID to create from")
	startCmd.Flags().BoolP("interactive", "i", false, "Open VS Code in browser after creation")
	startCmd.Flags().Bool("no-auth", false, "Skip ownership recording and automatic provider auth setup")
	startCmd.Flags().Bool("clean", false, "Skip provider auth setup but still record sandbox ownership (pve-lxc)")
	startCmd.Flags().Bool("mirror-local", false, "Pack/redact local ~/.claude and ~/.codex into the box (pve-lxc; soft-fail)")
	startCmd.Flags().String("target-home", "", "Cloud home for --mirror-local path rewrite/extract (default /root; use /home/orca for Orca Server)")
	startCmd.Flags().Bool("orca-serve", false, "Compose Orca Server agent home post-start: B1 bridge, workspace gh, agent matrix (pve-lxc; soft-fail)")
	startCmd.Flags().Bool("migrate-agent-home-from-root", false, "With --orca-serve: copy mirrorlocal allowlist from /root to /home/orca (never auth.json)")
	startCmd.Flags().String("template", "", "Load ~/.cmux/templates/<name>.yaml (or path) and expand to start flags")
	rootCmd.AddCommand(startCmd)
}
