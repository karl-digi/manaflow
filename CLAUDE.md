This project is called cmux. cmux is a web app that spawns Claude Code, Codex CLI, Gemini CLI, Amp, Opencode, and other coding agent CLIs in parallel across multiple tasks. For each run, cmux spawns an isolated openvscode instance via Docker or a configurable sandbox provider. The openvscode instance by default opens the git diff UI and a terminal with the running dev server (configurable via devcontainer.json).

# Repository Targets

- Primary upstream for this workspace is `manaflow-ai/manaflow`, with fork target `karlorz/cmux`.
- Terminal project is separate: upstream `manaflow-ai/cmux`, fork `karl-digi/cmux`, and should be handled in a separate workspace.

# Git Policy (IMPORTANT)

**All agents (Claude, Codex, Gemini, etc.) MUST follow these rules:**

1. **NO direct commits to main/master** - Always create a feature branch first
2. **NO direct push to main/master** - Push to feature branches only
3. **NO merging PRs without explicit user approval** - Create PR, wait for user to review and approve
4. **NO force push to main/master** - This destroys history

**Workflow:**
1. Create feature branch: `git checkout -b <type>/<description>`
2. Make changes and commit to feature branch
3. Push feature branch: `git push -u origin <branch>`
4. Create PR: `gh pr create --base main`
5. **STOP and wait for user approval before merging**
6. Only merge after user explicitly says "merge" or "approve"

# Code Review

When reviewing code, apply the guidelines in REVIEW.md at the project root.

# Config

Use bun to install dependencies and run the project.
`./scripts/dev.sh` will start the project. Optional flags:

- `--force-docker-build`: Rebuild worker image even if cached.

If you make code changes, run `bun check` and fix errors after completing a task.
After `bun check`, if there are code changes or codex review progress, explicitly invoke a simplify tool/workflow rather than doing only an informal manual review:
- First check whether the current agent/runtime supports the `/simplify` command; if it does, run `/simplify`.
- Otherwise, run the portable `$simplify` skill or the agent's equivalent simplify workflow.

# Backend

This project uses Convex and Hono.
Hono is defined in apps/www/lib/hono-app.ts as well as apps/www/lib/routes/\*
The Hono app generates a client in @cmux/www-openapi-client. This is automatically re-generated when the dev-server is running. If you change the Hono app (and the dev server isn't running), you should run `(cd apps/www && bun run generate-openapi-client)` to re-generate the client. Note that the generator is in www and not www-openapi-client.
We MUST force validation of requests that do not have the proper `Content-Type`. Set the value of `request.body.required` to `true`. For example:

```ts
app.openapi(
  createRoute({
    method: "post",
    path: "/books",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              title: z.string(),
            }),
          },
        },
        required: true, // <== add
      },
    },
    responses: {
      200: {
        description: "Success message",
      },
    },
  }),
  (c) => c.json(c.req.valid("json"))
);
```

## Convex

This project supports both **Convex Cloud** and **self-hosted Convex**. Mode is auto-detected by `scripts/setup-convex-env.sh`:

- **Cloud mode**: `CONVEX_DEPLOY_KEY` is set -> uses `NEXT_PUBLIC_CONVEX_URL`
- **Self-hosted mode**: `CONVEX_SELF_HOSTED_ADMIN_KEY` is set -> uses `CONVEX_SELF_HOSTED_URL`

Schemas are defined in packages/convex/convex/schema.ts.
If you're working in Convex dir, you cannot use node APIs/import from "node:\*"
Use crypto.subtle instead of node:crypto
Exception is if the file defines only actions and includes a "use node" directive at the top of the file

### Querying Convex Data

Always use `--env-file` to ensure correct backend connection:

```bash
cd packages/convex
bunx convex data <table> --format jsonl --env-file ../../.env | rg "pattern"
# Example:
bunx convex data sessions --format jsonl --env-file ../../.env | rg "mn7abc123"
```

The `--env-file` flag is required - it reads either `CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY` (for self-hosted) or `CONVEX_DEPLOY_KEY` (for cloud) from `.env`.

## Sandboxes

This project uses Morph sandboxes for running Claude Code/Codex/other coding CLIs inside.
To inspect Morph instances, use the morphcloud cli with the corresponding morphvm\_ id:

```bash
uvx --env-file .env morphcloud instance exec morphvm_q11mhv3p "ls"
🏁  Command execution complete!
--- Stdout ---
server.log
xagi-server
--- Exit Code: 0 ---
```

Morph snapshots capture RAM state. So after snapshot, running processes will still be running.
To modify and rebuild all snapshots, edit `./scripts/snapshot.py` and run `uv run --env-file .env ./scripts/snapshot.py`
After building a snapshot, you should always use the `say` command to notify the user to verify the changes that were made to the snapshot.
After the say command, you should give the user a table with the snapshot preset and vnc/vscode/xterm urls.
.env sometimes might not exist, but you can still run the script if `echo $MORPH_API_KEY` works.

# Frontend

This project uses React, TanStack Router, TanStack Query, Shadcn UI, and Tailwind CSS.
Always use tailwind `neutral` instead of `gray` for gray colors.
Always support both light and dark mode.

# Misc

Always use "node:" prefixes for node imports
Do not use the "any" type
Do not use casts unless absolutely necessary. Most casts may be solved with zod parsing.
Don't modify README.md unless explicitly asked
Do not write docs unless explicitly asked
Do not use dynamic imports unless absolutely necessary. Exceptions include when you're following existing patterns in the codebase
We're using Node 24, which supports global fetch
When using try/catch, never suppress errors. Always console.error any errors.

# Tests

Use vitest
Place test files next to the file they test using a .test.ts extension
Do not use mocks
Do not do early returns (eg. skipping tests if we're missing environment variables)
Make tests resilient

## Logs

When running `./scripts/dev.sh`, service logs are written to `logs/{type}.log`:

- docker-compose.log: Output from `.devcontainer` Docker Compose stack. Hidden from console by default; use `--show-compose-logs` to stream.
- convex-dev.log: Convex development server (`bunx convex dev`).
- server.log: Backend dev server in `apps/server`.
- client.log: Frontend dev server in `apps/client` (Vite).

Log files are overwritten on each run. Use `tail -f logs/<file>` to follow live output.

## devsh CLI

The devsh CLI manages sandbox lifecycle (create, exec, delete). See `packages/sandbox/` for implementation.

```bash
# Development build (local API URLs from .env)
make install-devsh-dev

# Production build (production API URLs from .env.production)
make install-devsh-prod

# Publish devsh to npm (usual order)
cd packages/devsh && make npm-version VERSION=x.y.z
make devsh-npm-republish-prod-dry DEVSH_NPM_VERSION=x.y.z
make devsh-npm-republish-prod DEVSH_NPM_VERSION=x.y.z

# Usage
devsh start -p pve-lxc          # Create sandbox
devsh exec <sandbox-id> "cmd"   # Execute command
devsh delete <sandbox-id>       # Delete sandbox
```

# Agent Memory Protocol

Agents running in cmux sandboxes have access to persistent memory at `/root/lifecycle/memory/`. This is outside the git workspace to avoid polluting repositories.

## Memory Structure

```
/root/lifecycle/memory/
├── knowledge/MEMORY.md   # Long-term insights (P0/P1/P2 priority tiers)
├── daily/{date}.md       # Daily session logs (ephemeral)
├── TASKS.json            # Task registry
├── MAILBOX.json          # Inter-agent messages
├── sync.sh               # Memory sync to Convex
└── mcp-server.js         # MCP server for programmatic access
```

## Priority Tiers (knowledge/MEMORY.md)

- **P0 Core**: Never expires - project fundamentals, invariants
- **P1 Active**: 90-day TTL - ongoing work, current strategies
- **P2 Reference**: 30-day TTL - temporary findings, debug notes

Format: `- [YYYY-MM-DD] Your insight here`

## Inter-Agent Messaging (MAILBOX.json)

Agents can coordinate via the mailbox using MCP tools or direct file access:

- `send_message(to, message, type)` - Send to agent or "*" for broadcast
- `get_my_messages()` - Get messages addressed to this agent
- `mark_read(messageId)` - Mark message as read

Message types: `handoff`, `request`, `status`

## Validation Scripts

```bash
./scripts/test-memory-protocol.sh       # S1: Memory seeding/read/write
./scripts/test-two-agent-coordination.sh # S2: Mailbox coordination
./scripts/test-memory-sync-latency.sh   # S3: Convex sync
./scripts/test-mcp-server.sh            # S4: MCP server tools
```

## Related Files

- `packages/shared/src/agent-memory-protocol.ts` - Protocol implementation
- `packages/convex/convex/agentMemory_http.ts` - Convex sync endpoint
- `packages/convex/convex/agentMemoryQueries.ts` - Memory queries

## Style

- Do not use emojis in shell scripts or debug messages.

## Agent Models

- Production `--agent` models for feature and fix work: `claude/opus-4.6`, `claude/opus-4.5`, `codex/gpt-5.4-xhigh`, `codex/gpt-5.3-codex-xhigh`.
- Validation-only `--agent` models: `claude/haiku-4.5`, `codex/gpt-5.1-codex-mini`, `opencode/big-pickle`.
- Test repos for `devsh task create --repo`: `karlorz/testing-repo-1`, `karlorz/testing-repo-2`, `karlorz/testing-repo-3`.

## Additional Git/PR Rules

- If needed, set the default GitHub repo for this workspace with `gh repo set-default karlorz/cmux`.
- Never use `gh pr merge --delete-branch`; the web app relies on preserved branches for merged-task git diffs.
- Preferred merge command: `gh pr merge <number> --squash --auto`.
- Do not use `--admin` unless explicitly requested.

## Additional Logs

- PVE snapshot helper output is written to `logs/snapshot-pvelxc.log`.

## Cloudrouter Dev

- `CLOUDROUTER_REFRESH_TOKEN` must be present in `.env`.
- Standard setup: `bun install && make install-cloudrouter-dev && cloudrouter whoami`.
- Typical local flow: run `make dev` in one terminal, then `cloudrouter start . -p e2b` in another.
- Default dev template is `cmux-devbox-lite-dev`; force the production template with `CLOUDROUTER_DEV_MODE=0 cloudrouter start . -p e2b`.
- Optional Convex sandbox provider override: `SANDBOX_PROVIDER=pve-lxc`, `morph`, `e2b`, or `modal`.

## devsh Publishing

- `make install-devsh-prod` builds and installs the production `devsh` binary locally using `.env.production`.
- `cd packages/devsh && make npm-version VERSION=x.y.z` bumps the published package version.
- `make devsh-npm-republish-prod-dry` runs the npm publish dry-run.
- `make devsh-npm-republish-prod` publishes the package and requires browser 2FA.
- The Go module path is `github.com/karlorz/devsh`; do not change it.

## Host Machine Commands

- `make convex-fresh` resets Convex locally and recreates the Docker Compose state.
- `make convex-init` and `make convex-init-prod` initialize Convex with `.env` or `.env.production`.
- `make convex-clear-prod` resets production Convex state and is destructive.
- `bun run convex:deploy` and `bun run convex:deploy:prod` deploy Convex using `.env` or `.env.production`.
- `make dev` starts `./scripts/dev.sh`; `make dev-electron` starts the Electron remote-debug workflow.

## PVE LXC Notes

- Reference docs: `https://pve.proxmox.com/pve-docs/api-viewer/`, `https://pve.proxmox.com/wiki/Proxmox_VE_API`, `https://github.com/proxmox/pve-docs`.
- Required provider env vars: `PVE_API_URL` and `PVE_API_TOKEN`; set `PVE_PUBLIC_DOMAIN` when using Cloudflare Tunnel.
- Update an existing snapshot with `uv run --env-file .env ./scripts/snapshot-pvelxc.py --update --update-vmid <vmid>`.
- Create the base template on the PVE host by fetching the setup script from `scripts/pve/pve-lxc-setup.sh` in the `karlorz/cmux` repo's raw view, then pipe it to `bash -s -- 9000`.
- Rebuild snapshots from the dev machine with `uv run --env-file .env ./scripts/snapshot-pvelxc.py --template-vmid 9000 --ide-deps-channel latest`.
- Trigger the weekly snapshot workflow with `gh workflow run "Weekly PVE LXC Snapshot" --repo karlorz/cmux --ref main`.
- Trigger the production Morph snapshot workflow with `gh workflow run "Daily Morph Snapshot" --repo karlorz/cmux --ref main`.

## Provider Env Notes

- Morph Cloud uses `MORPH_API_KEY`.
- PVE LXC uses `PVE_API_URL`, `PVE_API_TOKEN`, and usually `PVE_PUBLIC_DOMAIN`.
- Cloudflare Tunnel on the PVE host uses `CF_API_TOKEN`, `CF_ZONE_ID`, `CF_ACCOUNT_ID`, and `CF_DOMAIN`.

## Edge Routers

- `apps/edge-router/` is the main router for Morph sandboxes and deploys to `cmux.sh`.
- `apps/edge-router-pvelxc/` is the PVE-LXC fork and deploys to `*.alphasolves.com`.
- For PVE-LXC sandbox changes, work in `apps/edge-router-pvelxc/` and deploy with `cd apps/edge-router-pvelxc && bun run deploy`.

## External Knowledge Sharing

- Update shared Obsidian/GitHub notes for major architecture, governance, workflow, API, or workspace-isolation changes.
- Use the local-first vault at `~/Documents/obsidian_vault`.
- If the local vault is unavailable, use the `obsidian-gh-knowledge` fallback configured in the environment.
- Include the date, a concise decision summary, affected repo-relative paths, and related PR or commit IDs.
- Never include secrets or credentials in shared notes, and keep volatile TODOs out of long-lived knowledge documents.
- Do not turn this file into a phase ledger, migration queue, mockup dump, or large architecture diagram.
