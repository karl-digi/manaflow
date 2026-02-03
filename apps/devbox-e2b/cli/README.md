# cmux CLI

Manage E2B cloud development sandboxes with VSCode, Chrome, and VNC.

## Setup

```bash
cd apps/devbox-e2b/cli
bun install
alias cmux="bun run $(pwd)/src/index.ts"
```

## Quick Start

```bash
# Login (opens browser)
cmux login

# Set default team
cmux config set-team <your-team>

# Start a new sandbox and open VSCode
cmux start --name my-dev --open
```

## Commands

```
AUTH (both forms work)
  cmux login              Login via browser
  cmux auth login         Same as above
  cmux logout             Logout
  cmux auth logout        Same as above
  cmux whoami             Show current user
  cmux auth whoami        Same as above
  cmux status             Show full auth status

SANDBOX LIFECYCLE
  cmux start [--name]     Start new sandbox (aliases: new, create)
  cmux ls                 List sandboxes
  cmux stop <id>          Stop sandbox (alias: kill)
  cmux pause <id>         Pause
  cmux resume <id>        Resume
  cmux ttl <id> <sec>     Update timeout

ACCESS
  cmux open <id>          Open VSCode in browser
  cmux open <id> --vnc    Open VNC desktop
  cmux shell <id>         Interactive terminal (alias: pty)

EXECUTE
  cmux exec <id> <cmd>    Run command
  cmux cat <id> <path>    Read file
  cmux write <id> <p> <c> Write file

BROWSER AUTOMATION
  cmux browser <id> -p .. Run browser agent
  cmux screenshot <id>    Take screenshot
  cmux cdp <id>           Chrome CDP info

STATUS
  cmux get <id>           Sandbox details
  cmux services <id>      List services
  cmux worker-status <id> Worker status

CONFIG
  cmux config show        Show config
  cmux config set-team    Set default team
  cmux config clear-team  Clear default team
```

## Test Commands

```bash
# 1. Login and setup
cmux login
cmux config set-team austin-dev

# 2. Start a sandbox
cmux start --name test-box

# 3. Test with the ID (e.g., cmux_abc12345)
cmux exec cmux_abc12345 "echo hello"
cmux services cmux_abc12345
cmux open cmux_abc12345

# 4. Cleanup
cmux stop cmux_abc12345
```

## Browser Agent

```bash
cmux browser <id> --prompt "navigate https://google.com"
cmux browser <id> --prompt "click #submit"
cmux browser <id> --prompt "type #search hello"
cmux screenshot <id>
```

## Architecture

```
CLI ──► Convex API ──► E2B API ──► Sandbox
        (JWT auth)   (server key)
```

Sandbox Services:
- VSCode: port 39378
- VNC: port 39380
- Chrome CDP: port 9222
- Worker API: port 39377
