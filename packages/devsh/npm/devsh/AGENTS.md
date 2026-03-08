# devsh CLI - Agent Instructions

devsh is a CLI for managing cloud development VMs. Use these commands to help users work with remote development environments.

## Quick Reference

```bash
# Authentication
devsh login               # Login (opens browser)
devsh logout              # Logout
devsh whoami              # Show current user and team

# VM Lifecycle
devsh start [path]        # Create VM, optionally sync directory
devsh ls                  # List all VMs
devsh status <id>         # Show VM details and URLs
devsh pause <id>          # Pause VM (preserves state, saves cost)
devsh resume <id>         # Resume paused VM
devsh delete <id>         # Delete VM permanently

# Access VM
devsh code <id>           # Open VS Code in browser
devsh ssh <id>            # SSH into VM
devsh vnc <id>            # Open VNC desktop
devsh pty <id>            # Interactive terminal session

# Work with VM
devsh exec <id> "cmd"     # Run command in VM
devsh sync <id> <path>    # Sync local files to VM
devsh sync <id> <path> --pull  # Pull files from VM

# Browser Automation (control Chrome in VNC)
devsh computer open <id> <url>           # Navigate to URL
devsh computer snapshot <id>             # Get interactive elements (@e1, @e2...)
devsh computer click <id> <selector>     # Click element (@e1 or CSS selector)
devsh computer type <id> "text"          # Type into focused element
devsh computer fill <id> <sel> "value"   # Clear and fill input
devsh computer screenshot <id> [file]    # Take screenshot
devsh computer press <id> <key>          # Press key (enter, tab, escape)
```

## VM IDs

VM IDs look like `cmux_abc12345`. Always use the full ID when running commands.

## Common Workflows

### Create and access a VM
```bash
devsh start ./my-project    # Creates VM, syncs directory, returns ID
devsh code cmux_abc123      # Opens VS Code
```

### Run commands remotely
```bash
devsh exec cmux_abc123 "npm install"
devsh exec cmux_abc123 "npm run dev"
```

### Sync files
```bash
devsh sync cmux_abc123 .              # Push current dir to VM
devsh sync cmux_abc123 ./dist --pull  # Pull build output from VM
```

### Browser automation
```bash
devsh computer open cmux_abc123 "https://localhost:3000"
devsh computer snapshot cmux_abc123   # See clickable elements
devsh computer click cmux_abc123 @e1  # Click first element
```

### End of session
```bash
devsh pause cmux_abc123    # Pause to save costs (can resume later)
# OR
devsh delete cmux_abc123   # Delete permanently
```

## Git Policy (IMPORTANT)

**When working in VMs or this repo, ALWAYS follow these rules:**

1. **NO direct commits to main/master** - Create feature branch first
2. **NO direct push to main/master** - Push to feature branches only
3. **NO merging PRs without explicit user approval** - Wait for user to say "merge" or "approve"
4. **NO force push to main/master**

## Tips

- Run `devsh login` first if not authenticated
- Use `devsh whoami` to check current user and team
- Use `devsh ls` to see all VMs and their states
- Paused VMs preserve state and can be resumed instantly
- The `devsh pty` command requires an interactive terminal
- Browser automation commands work on the Chrome instance in the VNC desktop
