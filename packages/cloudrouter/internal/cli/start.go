package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/karlorz/cloudrouter/internal/api"
	"github.com/spf13/cobra"
)

const (
	// Preset ID from packages/shared/src/e2b-templates.json (stable identifier)
	// Using lite template (no Docker-in-Docker) as default for faster boot times
	defaultTemplatePresetID = "cmux-devbox-lite"

	// Template name in E2B (fallback if template list endpoint is unavailable)
	defaultTemplateName    = "cmux-devbox-lite"
	defaultTemplateNameDev = "cmux-devbox-lite-dev"

	// Modal preset IDs from packages/shared/src/modal-templates.json
	modalDefaultPresetID = "cmux-devbox-gpu"
)

// getDefaultTemplateName returns the default E2B template name.
// Uses dev template if buildMode is "dev" (set via ldflags at compile time).
// Can be overridden with CLOUDROUTER_DEV_MODE=1 (force dev) or CLOUDROUTER_DEV_MODE=0 (force prod).
func getDefaultTemplateName() string {
	// Allow env var override
	if envMode := os.Getenv("CLOUDROUTER_DEV_MODE"); envMode != "" {
		if envMode == "1" {
			return defaultTemplateNameDev
		}
		return defaultTemplateName
	}
	// Use build mode (set via ldflags)
	if buildMode == "dev" {
		return defaultTemplateNameDev
	}
	return defaultTemplateName
}

var (
	startFlagName     string
	startFlagTemplate string
	startFlagOpen     bool
	startFlagGit      string
	startFlagBranch   string
	startFlagProvider string
	startFlagGPU      string
	startFlagCPU      float64
	startFlagMemory   int
	startFlagDisk     int
	startFlagSize     string
	startFlagImage    string
	startFlagTimeout  int
)

// sizePreset defines a machine size preset (cpu, memory, disk).
type sizePreset struct {
	CPU      float64
	MemoryMiB int
	DiskGB   int
	Label    string
}

var sizePresets = map[string]sizePreset{
	"small":  {CPU: 2, MemoryMiB: 8192, DiskGB: 20, Label: "2 vCPU, 8 GB RAM, 20 GB disk"},
	"medium": {CPU: 4, MemoryMiB: 16384, DiskGB: 40, Label: "4 vCPU, 16 GB RAM, 40 GB disk"},
	"large":  {CPU: 8, MemoryMiB: 32768, DiskGB: 80, Label: "8 vCPU, 32 GB RAM, 80 GB disk"},
	"xlarge": {CPU: 16, MemoryMiB: 65536, DiskGB: 160, Label: "16 vCPU, 64 GB RAM, 160 GB disk"},
}

// isGitURL checks if the string looks like a git URL
func isGitURL(s string) bool {
	return strings.HasPrefix(s, "git@") ||
		strings.HasPrefix(s, "https://github.com/") ||
		strings.HasPrefix(s, "https://gitlab.com/") ||
		strings.HasPrefix(s, "https://bitbucket.org/") ||
		strings.HasSuffix(s, ".git")
}

// detectWorkspacePath detects the default workspace path by checking user identity on the sandbox.
// Returns /root/workspace for root user, /home/user/workspace for regular user.
// Creates the workspace directory if it doesn't exist.
// Important: We check whoami FIRST to avoid permission issues (e.g., /root/workspace exists but user is non-root).
func detectWorkspacePath(client *api.Client, teamSlug, sandboxID string) string {
	// Detect based on user identity first (not directory existence) to avoid permission issues
	detectCmd := `if [ "$(whoami)" = "root" ]; then mkdir -p /root/workspace && echo /root/workspace; else mkdir -p /home/user/workspace && echo /home/user/workspace; fi`

	resp, err := client.Exec(teamSlug, sandboxID, detectCmd, 10)
	if err == nil && resp.ExitCode == 0 && resp.Stdout != "" {
		path := strings.TrimSpace(resp.Stdout)
		if path != "" {
			return path
		}
	}

	// Fallback to /home/user/workspace (E2B default)
	return "/home/user/workspace"
}

var startCmd = &cobra.Command{
	Use:     "start [path-or-git-url]",
	Aliases: []string{"create", "new"},
	Short:   "Create a new sandbox",
	Long: `Create a new sandbox and optionally sync files or clone a git repo.

Size presets (--size):
  small       2 vCPU,  8 GB RAM,  20 GB disk
  medium      4 vCPU, 16 GB RAM,  40 GB disk
  large       8 vCPU, 32 GB RAM,  80 GB disk
  xlarge     16 vCPU, 64 GB RAM, 160 GB disk

GPU options (--gpu):
  T4          16GB VRAM  - inference, fine-tuning small models
  L4          24GB VRAM  - inference, image generation
  A10G        24GB VRAM  - training medium models
  L40S        48GB VRAM  - inference, video generation
  A100        40GB VRAM  - training large models (7B-70B)
  A100-80GB   80GB VRAM  - very large models
  H100        80GB VRAM  - fast training, research
  H200        141GB VRAM - maximum memory capacity
  B200        192GB VRAM - latest gen, frontier models

Individual resource flags (--cpu, --memory, --disk) override --size values.

Examples:
  cloudrouter start                          # Create a sandbox (8 vCPU, 32 GB RAM)
  cloudrouter start --size small             # Smaller sandbox (2 vCPU, 8 GB RAM)
  cloudrouter start --size xlarge            # Large sandbox (16 vCPU, 64 GB RAM)
  cloudrouter start --cpu 12 --memory 49152  # Custom resources (12 vCPU, 48 GB RAM)
  cloudrouter start --gpu B200               # Sandbox with B200 GPU
  cloudrouter start --gpu A100               # Sandbox with A100 GPU
  cloudrouter start --gpu H100:2             # Sandbox with 2x H100 GPUs
  cloudrouter start .                        # Sync current directory
  cloudrouter start https://github.com/u/r   # Clone git repo`,
	Args: cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		// Determine what to do: git clone, sync path, or nothing
		var syncPath string
		var gitURL string
		name := startFlagName

		// Check --git flag first
		if startFlagGit != "" {
			gitURL = startFlagGit
			// Support GitHub shorthand: user/repo -> https://github.com/user/repo
			if !strings.Contains(gitURL, "://") && !strings.HasPrefix(gitURL, "git@") {
				gitURL = "https://github.com/" + gitURL
			}
			// Extract repo name for sandbox name
			if name == "" {
				parts := strings.Split(strings.TrimSuffix(gitURL, ".git"), "/")
				if len(parts) > 0 {
					name = parts[len(parts)-1]
				}
			}
		} else if len(args) > 0 {
			arg := args[0]

			// Check if argument is a git URL
			if isGitURL(arg) {
				gitURL = arg
				// Support GitHub shorthand
				if !strings.Contains(gitURL, "://") && !strings.HasPrefix(gitURL, "git@") && strings.Count(gitURL, "/") == 1 {
					gitURL = "https://github.com/" + gitURL
				}
				// Extract repo name for sandbox name
				if name == "" {
					parts := strings.Split(strings.TrimSuffix(gitURL, ".git"), "/")
					if len(parts) > 0 {
						name = parts[len(parts)-1]
					}
				}
			} else {
				// It's a local path
				absPath, err := filepath.Abs(arg)
				if err != nil {
					return fmt.Errorf("invalid path: %w", err)
				}

				// Check path exists and is a directory
				info, err := os.Stat(absPath)
				if err != nil {
					return fmt.Errorf("path not found: %w", err)
				}
				if !info.IsDir() {
					return fmt.Errorf("path must be a directory")
				}
				syncPath = absPath

				// Use directory name as sandbox name if not specified
				if name == "" {
					name = filepath.Base(absPath)
				}
			}
		}

		client := api.NewClient()
		provider := startFlagProvider

		// If no provider specified, fetch default from server config
		if provider == "" {
			if config, err := client.GetConfig(); err == nil && config.DefaultProvider != "" {
				provider = config.DefaultProvider
			}
		}

		// If --gpu is specified without --provider, default to modal
		if startFlagGPU != "" && provider == "" {
			provider = "modal"
		}

		// Apply --size preset (individual flags override preset values)
		if startFlagSize != "" {
			preset, ok := sizePresets[strings.ToLower(startFlagSize)]
			if !ok {
				return fmt.Errorf("invalid size %q, valid sizes: small, medium, large, xlarge", startFlagSize)
			}
			if startFlagCPU <= 0 {
				startFlagCPU = preset.CPU
			}
			if startFlagMemory <= 0 {
				startFlagMemory = preset.MemoryMiB
			}
			if startFlagDisk <= 0 {
				startFlagDisk = preset.DiskGB
			}
		}

		// Determine which template to use
		templateID := startFlagTemplate
		if templateID == "" {
			templates, err := client.ListTemplates(teamSlug, provider)
			if err == nil {
				if provider == "modal" {
					// For Modal, pick a GPU template if --gpu is specified
					if startFlagGPU != "" {
						gpuLower := strings.ToLower(startFlagGPU)
						for _, t := range templates {
							if t.Provider == "modal" && t.GPU != "" && strings.ToLower(t.GPU) == gpuLower {
								templateID = t.ID
								break
							}
						}
					}
					// Fallback to default modal template
					if templateID == "" {
						for _, t := range templates {
							if t.Provider == "modal" && t.ID == modalDefaultPresetID {
								templateID = t.ID
								break
							}
						}
					}
					// Still nothing? Use first modal template
					if templateID == "" {
						for _, t := range templates {
							if t.Provider == "modal" {
								templateID = t.ID
								break
							}
						}
					}
				} else if provider == "pve-lxc" {
					// PVE LXC provider - pick first pve-lxc template
					for _, t := range templates {
						if t.Provider == "pve-lxc" {
							templateID = t.ID
							break
						}
					}
				} else {
					// E2B provider (always uses docker template)
					for _, t := range templates {
						if t.PresetID == defaultTemplatePresetID {
							templateID = t.ID
							break
						}
					}
				}
			}

			// Fallback to template name if the template list endpoint isn't
			// available (or isn't returning the expected schema yet).
			if templateID == "" && provider != "modal" && provider != "pve-lxc" {
				templateID = getDefaultTemplateName()
			}
		}

		// Build create request
		createReq := api.CreateInstanceRequest{
			TeamSlugOrID: teamSlug,
			TemplateID:   templateID,
			Name:         name,
			TTLSeconds:   startFlagTimeout,
		}
		if provider != "" {
			createReq.Provider = provider
		}
		if startFlagGPU != "" {
			createReq.GPU = startFlagGPU
		}
		if startFlagCPU > 0 {
			createReq.CPU = startFlagCPU
		}
		if startFlagMemory > 0 {
			createReq.MemoryMiB = startFlagMemory
		}
		if startFlagDisk > 0 {
			createReq.DiskGB = startFlagDisk
		}
		if startFlagImage != "" {
			createReq.Image = startFlagImage
		}

		resp, err := client.CreateInstance(createReq)
		if err != nil {
			return err
		}

		// Try to fetch auth token (may need a few retries as sandbox boots)
		var token string
		fmt.Print("Waiting for sandbox to initialize")
		for i := 0; i < 10; i++ {
			time.Sleep(2 * time.Second)
			fmt.Print(".")
			token, err = client.GetAuthToken(teamSlug, resp.DevboxID)
			if err == nil && token != "" {
				break
			}
		}
		fmt.Println()

		// Detect workspace path (auto-detect based on user/filesystem)
		workspacePath := detectWorkspacePath(client, teamSlug, resp.DevboxID)

		// Clone git repo if specified (fast!)
		if gitURL != "" && token != "" {
			fmt.Printf("Cloning %s...\n", gitURL)
			cloneCmd := fmt.Sprintf("cd %s && git clone %s .", workspacePath, gitURL)
			if startFlagBranch != "" {
				cloneCmd = fmt.Sprintf("cd %s && git clone -b %s %s .", workspacePath, startFlagBranch, gitURL)
			}
			execResp, err := client.Exec(teamSlug, resp.DevboxID, cloneCmd, 120)
			if err != nil {
				fmt.Printf("Warning: git clone failed: %v\n", err)
			} else if execResp.ExitCode != 0 {
				fmt.Printf("Warning: git clone failed: %s\n", execResp.Stderr)
			} else {
				fmt.Println("✓ Repository cloned")
			}
		}

		// Sync directory if specified (using rsync over WebSocket SSH)
		if syncPath != "" && token != "" {
			inst, err := client.GetInstance(teamSlug, resp.DevboxID)
			if err == nil && inst.WorkerURL != "" {
				fmt.Printf("Syncing %s to sandbox...\n", syncPath)
				if err := runRsyncOverWebSocket(inst.WorkerURL, token, syncPath, workspacePath); err != nil {
					fmt.Printf("Warning: failed to sync files: %v\n", err)
				} else {
					fmt.Println("✓ Files synced")
				}
			}
		}

		// Build authenticated URLs (use the detected workspace path)
		var vscodeAuthURL, vncAuthURL, jupyterAuthURL string
		if token != "" {
			if resp.VSCodeURL != "" {
				vscodeAuthURL, _ = buildAuthURLWithFolder(resp.VSCodeURL, token, false, workspacePath)
			}
			if resp.VNCURL != "" {
				vncAuthURL, _ = buildAuthURL(resp.VNCURL, token, true)
			}
			if resp.JupyterURL != "" {
				jupyterAuthURL, _ = buildJupyterAuthURL(resp.JupyterURL, token)
			}
		}
		// Fallback: Modal may return pre-built Jupyter URL with token
		if jupyterAuthURL == "" && resp.JupyterURL != "" {
			jupyterAuthURL = resp.JupyterURL
		}

		// Build type label: "Docker" for e2b, "GPU (type)" for modal, "PVE LXC" for pve-lxc
		typeLabel := "Docker"
		if resp.Provider == "modal" {
			if resp.GPU != "" {
				typeLabel = fmt.Sprintf("GPU (%s)", resp.GPU)
			} else {
				typeLabel = "GPU"
			}
		} else if resp.Provider == "pve-lxc" {
			typeLabel = "PVE LXC"
		}

		fmt.Printf("Created sandbox: %s\n", resp.DevboxID)
		fmt.Printf("  Type:   %s\n", typeLabel)
		fmt.Printf("  Status: %s\n", resp.Status)
		if vscodeAuthURL != "" {
			fmt.Printf("  VSCode:  %s\n", vscodeAuthURL)
		} else if resp.VSCodeURL != "" {
			fmt.Printf("  VSCode:  %s\n", resp.VSCodeURL)
		}
		if jupyterAuthURL != "" {
			fmt.Printf("  Jupyter: %s\n", jupyterAuthURL)
		}
		if vncAuthURL != "" {
			fmt.Printf("  VNC:     %s\n", vncAuthURL)
		} else if resp.VNCURL != "" {
			fmt.Printf("  VNC:     %s\n", resp.VNCURL)
		}

		// Auto-open: prefer Jupyter for GPU, VSCode for Docker
		openableURL := vscodeAuthURL
		if resp.Provider == "modal" && jupyterAuthURL != "" {
			openableURL = jupyterAuthURL
		}
		if startFlagOpen && openableURL != "" {
			if resp.Provider == "modal" && jupyterAuthURL != "" {
				fmt.Println("\nOpening Jupyter Lab...")
			} else {
				fmt.Println("\nOpening VSCode...")
			}
			openURL(openableURL)
		}

		return nil
	},
}

func init() {
	startCmd.Flags().StringVarP(&startFlagName, "name", "n", "", "Name for the sandbox")
	startCmd.Flags().StringVarP(&startFlagTemplate, "template", "T", "", "Template ID")
	startCmd.Flags().BoolVarP(&startFlagOpen, "open", "o", false, "Open VSCode after creation")
	startCmd.Flags().StringVar(&startFlagGit, "git", "", "Git repository URL to clone (or user/repo shorthand)")
	startCmd.Flags().StringVarP(&startFlagBranch, "branch", "b", "", "Git branch to clone")

	// Provider selection (internal: e2b = Docker, modal = GPU)
	startCmd.Flags().StringVarP(&startFlagProvider, "provider", "p", "", "Sandbox provider: e2b (default), modal, pve-lxc")

	// GPU and resource options
	startCmd.Flags().StringVar(&startFlagGPU, "gpu", "", "GPU type (T4, L4, A10G, L40S, A100, H100, H200, B200)")
	startCmd.Flags().StringVar(&startFlagSize, "size", "", "Machine size preset: small, medium, large, xlarge")
	startCmd.Flags().Float64Var(&startFlagCPU, "cpu", 0, "CPU cores (overrides --size)")
	startCmd.Flags().IntVar(&startFlagMemory, "memory", 0, "Memory in MiB (overrides --size)")
	startCmd.Flags().IntVar(&startFlagDisk, "disk", 0, "Disk size in GB (overrides --size)")
	startCmd.Flags().StringVar(&startFlagImage, "image", "", "Container image (e.g., ubuntu:22.04)")
	startCmd.Flags().IntVar(&startFlagTimeout, "timeout", 600, "Sandbox timeout in seconds (default: 10 minutes)")
}
