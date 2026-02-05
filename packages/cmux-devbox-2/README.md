# cmux CLI (E2B)

CLI for managing E2B cloud sandboxes with VSCode, VNC, file sync, and browser automation.

## Installation

```bash
# Install via npm (includes platform binary)
npm install -g cmux

# Or build from source
cd apps/cmux-devbox-2
make build-dev
make install-dev
```

## Quick Start

```bash
# 1. Login (opens browser)
cmux login

# 2. Create a sandbox
cmux start ./my-project

# 3. Open VSCode in browser
cmux code <id>

# 4. Open terminal session
cmux pty <id>

# 5. Stop when done
cmux stop <id>
```

## Commands

```bash
# Authentication
cmux login                      # Login via browser
cmux logout                     # Clear credentials
cmux whoami                     # Show current user/team

# Sandbox Management
cmux start                      # Create new sandbox
cmux start ./my-project         # Create and sync directory
cmux ls                         # List all sandboxes
cmux status <id>                # Show sandbox status
cmux stop <id>                  # Stop sandbox
cmux delete <id>                # Delete sandbox
cmux extend <id>                # Extend timeout

# File Sync
cmux sync <id> .                # Sync current directory
cmux sync <id> ./src            # Sync specific directory
cmux sync <id> . --watch        # Watch and sync on changes
cmux sync <id> . -e "*.log"     # Exclude patterns

# Open in Browser
cmux code <id>                  # Open VSCode
cmux vnc <id>                   # Open VNC desktop

# Terminal Session
cmux pty <id>                   # Open interactive terminal

# Execute Commands
cmux exec <id> "echo hello"     # Run command in sandbox
cmux exec <id> "npm install"    # Install dependencies

# Browser Automation (computer subcommands)
cmux computer snapshot <id>              # Get accessibility tree
cmux computer open <id> <url>            # Navigate to URL
cmux computer click <id> <selector>      # Click element (@e1 or CSS)
cmux computer type <id> <text>           # Type text
cmux computer fill <id> <selector> <val> # Fill input field
cmux computer press <id> <key>           # Press key (Enter, Tab, etc.)
cmux computer scroll <id> <direction>    # Scroll (up/down)
cmux computer screenshot <id> [file]     # Take screenshot
cmux computer back <id>                  # Navigate back
cmux computer forward <id>               # Navigate forward
cmux computer reload <id>                # Reload page
cmux computer url <id>                   # Get current URL
cmux computer title <id>                 # Get page title
cmux computer wait <id> <selector>       # Wait for element
cmux computer hover <id> <selector>      # Hover over element
```

## Example Session

```bash
# Login (one time)
cmux login

# Create sandbox and sync project
cmux start ./my-project
# Output: Created sandbox: cmux_abc12345

# Or create then sync separately
cmux start
cmux sync cmux_abc12345 .
# Output: Syncing ... Uploading 15 files... ✓ Synced 15 files

# Open VSCode to edit files
cmux code cmux_abc12345

# Open terminal session
cmux pty cmux_abc12345

# Run commands
cmux exec cmux_abc12345 "npm install"
cmux exec cmux_abc12345 "npm run dev"

# Browser automation
cmux computer open cmux_abc12345 https://google.com
cmux computer snapshot cmux_abc12345
cmux computer click cmux_abc12345 @e3
cmux computer type cmux_abc12345 "hello world"
cmux computer screenshot cmux_abc12345 screenshot.png

# Watch for file changes
cmux sync cmux_abc12345 . --watch

# Cleanup when done
cmux stop cmux_abc12345
```

## Flags

| Flag | Description |
|------|-------------|
| `-t, --team` | Team slug (auto-detected from login) |
| `-o, --open` | Open VSCode after creation (with `start`) |
| `-w, --watch` | Watch for changes (with `sync`) |
| `-e, --exclude` | Patterns to exclude (with `sync`) |
| `--json` | Output as JSON |
| `-v, --verbose` | Verbose output |

## Sync Excludes

By default, sync excludes:
- `node_modules`
- `.git`
- `.venv`
- `__pycache__`
- `.DS_Store`
- `dist`
- `build`

Add custom excludes with `-e`:
```bash
cmux sync <id> . -e "*.log" -e "tmp/"
```

## Architecture

```
cmux CLI
    │
    ▼
Convex API (/api/v2/cmux/*)
    │
    ▼
E2B Sandbox
├── Worker Daemon (port 39377) - exec, file sync, browser automation
├── VSCode Server (port 39378)
├── VNC Desktop (port 39380)
└── Chrome CDP (port 9222)
```
