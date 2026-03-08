# devsh

Cloud VMs for development - spawn isolated dev environments instantly.

## Installation

```bash
npm install -g devsh
```

## Quick Start

```bash
# Login
devsh login

# Create a VM
devsh start                     # Returns ID

# Access the VM
devsh code <id>          # Open VS Code in browser
devsh ssh <id>           # SSH into VM

# Run commands
devsh exec <id> "npm install"

# Manage lifecycle
devsh pause <id>         # Pause (preserves state)
devsh resume <id>        # Resume
devsh delete <id>        # Delete permanently

# List all VMs
devsh ls
```

## Commands

| Command | Description |
|---------|-------------|
| `devsh login` | Login via browser |
| `devsh start [path]` | Create new VM, optionally sync directory |
| `devsh ls` | List all VMs |
| `devsh code <id>` | Open VS Code in browser |
| `devsh vnc <id>` | Open VNC desktop in browser |
| `devsh ssh <id>` | SSH into VM |
| `devsh pty <id>` | Open interactive terminal |
| `devsh exec <id> "cmd"` | Execute command |
| `devsh sync <id> <path>` | Sync files to VM |
| `devsh pause <id>` | Pause VM |
| `devsh resume <id>` | Resume VM |
| `devsh delete <id>` | Delete VM |

## Browser Automation

Control Chrome in the VNC desktop:

```bash
devsh computer open <id> https://example.com
devsh computer snapshot <id>       # Get interactive elements
devsh computer click <id> @e1      # Click element
devsh computer type <id> "hello"   # Type text
devsh computer screenshot <id>     # Take screenshot
```

## Platform Support

- macOS (Apple Silicon & Intel)
- Linux (x64 & ARM64)
- Windows (x64)

## License

MIT
