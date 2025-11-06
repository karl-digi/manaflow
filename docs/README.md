# cmux Documentation Hub

This README is the canonical entry point for cmux product, operator, and developer documentation. It summarizes the platform, explains local and cloud execution modes, and links code-level references so contributors can extend or troubleshoot the system quickly.

---

## Table of Contents
1. [Overview](#overview)
2. [Quick Start](#quick-start)
   - [Local Mode](#local-mode)
   - [Cloud Mode](#cloud-mode)
3. [Core Concepts & Features](#core-concepts--features)
4. [Configuration & Settings](#configuration--settings)
5. [Local vs Cloud Mode Parity](#local-vs-cloud-mode-parity)
6. [Integrations](#integrations)
7. [Troubleshooting](#troubleshooting)
8. [Guides & Recipes](#guides--recipes)
9. [Reference](#reference)
10. [Versioning & Changelog](#versioning--changelog)
11. [Documentation Workflow](#documentation-workflow)

---

## Overview

- **What cmux is**  
  cmux multiplexes multiple coding-agent CLIs (Claude Code, Codex, Gemini CLI, Cursor CLI, Sourcegraph AMP, OpenCode, Qwen, and more) into isolated workspaces with coordinated git state, diff tracking, telemetry, and VS Code-in-browser access. Each run is backed by Convex for realtime data, socket-based transports for agent logs, and either Docker (local mode) or Morph-managed sandboxes (cloud mode).  
  _Key source_: `apps/server/src/agentSpawner.ts`, `apps/server/src/socket-handlers.ts`, `packages/shared/src/agentConfig.ts`.

- **Primary use cases**  
  - Parallelize “task” execution across different agent stacks to compare outputs.  
  - Provide review-ready git diffs with linked VS Code sessions per agent.  
  - Offer managed cloud sandboxes for consistent dev/test environments.  
  - Power PR review, diagnostics, and human-in-the-loop workflows from a single dashboard.

- **Supported platforms**  
  - macOS (arm64 & x64) is fully supported.  
  - Linux and Windows builds are planned; scripts exist (`scripts/build-cli.ts`, `configs/systemd-*`) but are not yet packaged for general availability.  
  - Cloud sandboxes run on Morph regardless of the user’s OS.

- **High-level architecture**  
  ```
  CLI (packages/cmux/src/cli.ts)
      ├─ boots Convex runtime + bundled UI & API server (apps/server)
      └─ exposes Socket.IO bridge for dashboard + worker control
  Dashboard (apps/client) ↔ Server (apps/server)
      ├─ Agent spawner orchestrates Docker or Morph VS Code instances
      ├─ Convex backend (`packages/convex`) persists tasks/taskRuns/workspaces
      └─ Worker runtime (apps/worker) executes agent commands via tmux + sockets
  ```

- **Key repositories/directories**
  - `apps/` – UI (`client`), backend (`server`), distributed worker, proxies, landing marketing site.
  - `packages/` – CLI bundle (`cmux`), shared libs, Convex functions, VS Code extension.
  - `configs/` – Systemd/NFPM packaging for host installs.
  - `scripts/` – Operational tooling (Docker snapshots, Morph automation, telemetry inspectors).
  - `docs/assets/` – Static assets used by README/badges.

---

## Quick Start

### Local Mode

**Prerequisites**
- macOS with Rosetta (if running on Apple Silicon and targeting x64 binaries).  
- Docker Desktop _or_ OrbStack running (`checkDockerStatus()` in `packages/cmux/src/utils/checkDocker.ts`).  
- `git` available on PATH (server enforces via `RepositoryManager`, `apps/server/src/repositoryManager.ts`).  
- Optional: configure API keys for selected agents (see [Integrations](#integrations)).

**Installation**
1. Download the signed macOS binary from <https://www.cmux.dev/direct-download-macos> or install via npm/bun (`npm install -g cmux`, `bun add -g cmux`).
2. On first launch `cmux` extracts bundled assets to `~/.cmux/` (see `ensureBundleExtracted`).

**Launch**
```bash
cmux --port 9776               # default
cmux --port 8080               # custom port
cmux --no-autokill-ports       # enforce manual port cleanup
cmux /path/to/repo             # pre-select repo
```
- CLI auto-spawns Convex on port `9777` and a worker proxy port on `9778`. Required VS Code/Docker ports (39375–39381) are auto-managed (see `packages/shared/src/utils/reserved-cmux-ports.ts`).  
- Logs are streamed to `~/.cmux/logs/` and truncated per run (`packages/cmux/src/ensureLogFiles.ts`).  
- The dashboard becomes available at `http://localhost:<port>`, default `http://localhost:9776`.

**Workflow**
1. Create a task in the dashboard; cmux reserves a local workspace via `api.localWorkspaces.reserve` and clones/initializes git inside `~/cmux/local-workspaces/<slug>` unless overridden by `CMUX_WORKSPACE_DIR`.  
2. Select agents; `spawnAllAgents` creates unique branch names and fans out tmux terminals inside a Docker container (`apps/server/src/agentSpawner.ts`).  
3. Use VS Code-in-browser, live terminal logs, and diffs (`GitDiffManager`, `apps/server/src/gitDiff.ts`).  
4. Stop the run; CLI ensures Docker containers are stopped and tmux sessions destroyed (cleanup in `apps/server/src/server.ts`).

### Cloud Mode

**Prerequisites**
- cmux account with GitHub auth configured (Stack Auth in `apps/www`).  
- Team’s Morph Cloud API key seeded in server environment (`env.MORPH_API_KEY` used in `apps/www/lib/routes/sandboxes.route.ts`).  
- Optional: environment snapshots and scripts defined in Convex `environments` tables.

**Enable Cloud Mode**
1. In the dashboard, toggle “Cloud” when creating a workspace.  
2. Supply a task ID (auto-generated for new tasks) and select either:
   - **Repository mode** – Provide GitHub repo (`owner/name`) or URL for hydration (`hydrateRepoScript.ts`).  
   - **Environment mode** – Choose a predefined environment/snapshot (`resolveTeamAndSnapshot`).

**Launch**
- Server calls `POST /api/sandboxes/start` (`apps/www/lib/routes/sandboxes.route.ts`) to spin up a Morph sandbox with TTL = 1 hour.  
- `CmuxVSCodeInstance` records sandbox ID, VS Code URL, worker URL, then connects the worker socket (cloud provider `morph`).  
- Worker orchestrator script creates tmux session(s) and executes dev/maintenance scripts if present (`apps/www/lib/routes/sandboxes/devAndMaintenanceOrchestratorScript.ts`).  
- Frontend receives VS Code URLs instantly; readiness is handled client-side via heartbeat.

**Workflow**
1. Task metadata is persisted in Convex (`taskRuns` table) with `isCloudWorkspace=true`.  
2. Git hydration occurs inside the sandbox; repo credentials are injected using GitHub tokens (see `configureGitIdentity` + `setupGitCredentialsForDocker`).  
3. Agent terminals run inside Morph, but UI mirrors local mode features (diffs, logs, telemetry).  
4. Sandboxes auto-pause after TTL or via manual stop (`postApiSandboxesByIdStop`).

---

## Core Concepts & Features

- **Tasks & Task Runs** (`packages/convex/convex/tasks.ts`, `taskRuns.ts`)  
  - Tasks group prompts, repos, and environments.  
  - Each agent invocation produces a `taskRun` with VS Code metadata, branch info, telemetry, and status transitions (`pending → running → complete/failed`).

- **Multiplexing & Routing** (`apps/server/src/agentSpawner.ts`)  
  - Agent definitions live in `packages/shared/src/agentConfig.ts`.  
  - `spawnAllAgents` generates unique branches, prepares prompts, syncs images, and emits `worker:create-terminal` per agent.  
  - Worker sockets route logs/events back through Socket.IO namespaces (`worker:*` events).

- **Session Management** (`apps/server/src/vscode/*.ts`)  
  - `VSCodeInstance` manages lifecycle, worker sockets, and file change events.  
  - `DockerVSCodeInstance` handles local Docker port mapping and image pulling (`WORKER_IMAGE_NAME` default `cmux-worker:0.0.1`).  
  - `CmuxVSCodeInstance` interfaces with Morph APIs and handles remote worker connectivity.

- **Models, Tools, Connectors** (`packages/shared/src/providers/*`)  
  - Built-in providers: Anthropic, OpenAI/Codex, Gemini, Cursor, Sourcegraph AMP, OpenCode, Qwen.  
  - API key constraints are defined in `packages/shared/src/apiKeys.ts`; each config declares CLI args, telemetry settings, and completion detectors.  
  - Adding a provider entails creating a config under `packages/shared/src/providers/<name>/configs.ts` and exporting via `AGENT_CONFIGS`.

- **Project Structure**  
  - `apps/client` – React dashboard (TanStack router, Query) with real-time status cards, command bar, workspace views.  
  - `apps/server` – Node HTTP + Express proxy for VS Code, Socket.IO transport, git utilities.  
  - `apps/worker` – Bun runtime managing tmux sessions, file watching, telemetry ingestion.  
  - `packages/convex` – Convex schema, queries, and mutations for tasks, runs, GitHub sync, environments.  
  - `packages/cmux` – CLI entrypoint bundling server + client.  
  - `packages/shared` – Cross-runtime schemas (Zod), API clients, socket contracts.

- **CLI Commands & Flags** (`packages/cmux/src/cli.ts`)  
  - `cmux [repoPath]` – start server (options `--port`, `--cors`, `--no-autokill-ports`).  
  - `cmux uninstall` – purge `~/.cmux/`, emit uninstall hints for npm/bun/yarn/pnpm.  
  - Default ports: `9776` (web), `9777` (Convex), `9778` (aux), `39375-39381` (VS Code/worker).

---

## Configuration & Settings

- **Global locations**
  - `~/.cmux/` – extracted assets (`public/dist`), Convex bundle, log files.  
  - `~/cmux/local-workspaces/` – default workspace root (override via `CMUX_WORKSPACE_DIR`).  
  - `~/.cmux/logs/` – `cmux-cli.log`, `docker-vscode.log`, `server.log`, `docker-pull.log`.

- **Environment variables**
  - _CLI/Server_:  
    - `WORKER_IMAGE_NAME` – Docker image tag; triggers async `docker pull`.  
    - `CMUX_WORKSPACE_DIR` – Override local workspace parent directory.  
    - `CMUX_ALLOWED_SOCKET_ORIGINS` – Additional Socket.IO origins (`apps/server/src/transports/socketio-transport.ts`).  
    - `CMUX_DIFF_BASE` – Override git diff base (`apps/server/src/utils/collectRelevantDiff.ts`).  
    - `CMUX_BRANCH_NAME`, `CMUX_COMMIT_MESSAGE` – Script overrides for branch/commit automation.  
  - _Worker_: `WORKER_PORT` (default 39377), `CMUX_WORKSPACE_PATH`, `CMUX_REPO_FULL`, etc.  
  - _Build/Test_: `CMUX_SKIP_DOCKER_TESTS`, `CMUX_BUILD_LINUX`, `CMUX_PR_REVIEW_ENV`.  
  - _Telemetry_: providers inject per-task telemetry files (`/tmp/*-telemetry-$CMUX_TASK_RUN_ID.log`).

- **Per-project / per-user settings**
  - Convex table `workspaceSettings` persists user-specific worktree path overrides and auto-PR settings (`packages/convex/convex/workspaceSettings.ts`).  
  - Frontend surfaces provider readiness indicators based on `checkAllProvidersStatus` (`apps/server/src/utils/providerStatus.ts`).

- **Logging & Telemetry**
  - Node logs via `pino` wrappers (`apps/server/src/utils/fileLogger.ts`).  
  - Docker logs forwarded to `docker-vscode.log`.  
  - Provider CLIs emit telemetry to `/tmp`, tailed by completion detectors (Gemini/Qwen). Scripts like `scripts/watch-gemini-telemetry.js` assist manual debugging.  
  - Access logs/telemetry to triage agent stalls or memory issues.

- **Privacy & security**
  - GitHub tokens pulled from OS keychain (`apps/server/src/utils/getGitHubToken.ts`).  
  - Temporary git credentials for containers are stored under `/tmp/cmux-git-configs` and deleted after stop (`dockerGitSetup.ts`).  
  - Cloud sandboxes are isolated Morph instances; TTL-based lifecycle prevents long-lived secrets.  
  - WebSocket auth tokens are enforced via `runWithAuth` wrappers (`apps/server/src/socket-handlers.ts`).

- **Resource limits & tuning**
  - CLI warns if `ulimit -n < 8192` (file watcher stability).  
  - Git watchers ignore heavy directories and depth-limit to reduce load (`GitDiffManager`).  
  - For heavy tasks, set `WORKER_IMAGE_NAME` to custom images with more RAM/CPU or adjust Morph snapshot size.  
  - Reserved port set prevents collisions with dev servers; use proxies for custom ports via `apps/server/src/proxyApp.ts`.

---

## Local vs Cloud Mode Parity

### Feature Matrix

| Capability | Local Docker | Cloud (Morph) |
| ---------- | ------------ | ------------- |
| Compute Isolation | Docker container per workspace (`DockerVSCodeInstance`, `apps/server/src/vscode`) | Dedicated Morph sandbox per task run (`CmuxVSCodeInstance`) |
| Workspace Storage | Host-dir under `~/cmux/local-workspaces` (configurable) | Ephemeral VM storage (snapshot-based), persisted for TTL |
| Git Credentials | Injected via keychain token copied into container (`dockerGitSetup.ts`) | Morph hydration script with Git identity & env vaults |
| VS Code Access | proxied via local server: `http://localhost:9776/vscode/...` (`proxyApp.ts`) | Direct Morph URL (`https://instance.morph.cloud:39378?folder=/root/workspace`) |
| Dev Server Routing | Express proxy rewrites `<containerName>.<port>.localhost` | Morph HTTP services with auto-published devcontainer endpoints |
| Custom Images | Set `WORKER_IMAGE_NAME` to local image | Provide Morph snapshot ID or `postApiSandboxesStart` metadata |
| Telemetry | `/tmp/*-telemetry-<taskRun>.log` inside container, pulled via worker | Same telemetry path; orchestrator syncs logs |
| Pricing/Limits | Local hardware usage only | Billed via Morph account, TTL default 60m (pause after) |
| Best For | Iteration on laptop, quick debugging, offline use | Managed resources, team sharing, long-running tasks, CI-like runs |

### Data Flow (textual)

**Local Mode**
1. CLI spawns Convex + Express (`packages/cmux/src/cli.ts` → `apps/server/src/server.ts`).  
2. Dashboard emits `create-local-workspace`; Convex reserves metadata (`api.localWorkspaces.reserve`).  
3. Git clone/init executed on host (`apps/server/src/socket-handlers.ts` L720+).  
4. `DockerVSCodeInstance.start()` pulls/binds container, maps ports, connects worker socket.  
5. Agent commands executed via tmux inside container; worker emits logs/telemetry.  
6. File watchers notify UI and diff manager; server proxies VS Code and dev-server requests.  
7. Cleanup stops Docker containers and flushes logs (server exit handlers).

**Cloud Mode**
1. Dashboard emits `create-cloud-workspace` with task reference.  
2. Convex creates `taskRun`, updates VS Code status placeholders.  
3. Server calls Morph `instances.start` (via `postApiSandboxesStart`); TTL, metadata, env scripts included.  
4. Morph hydration script clones repo or loads environment (`hydrateRepoScript.ts`).  
5. Orchestrator script ensures tmux session, runs maintenance/dev scripts, exposes worker & VS Code ports.  
6. `CmuxVSCodeInstance` connects worker socket and returns remote VS Code URL.  
7. Convex updates run status; UI renders remote VS Code while telemetry/logs stream via WebSocket.  
8. Sandbox auto-pauses/stops on TTL or user action.

### Persistence, Caching & Storage
- Local clones persist under workspace dir; manual cleanup via UI or deleting directories.  
- Cloud workspaces default to ephemeral state; persist by creating Morph snapshots (`scripts/morph_snapshot*.py`).  
- Convex stores metadata/state regardless of mode (`packages/convex/convex/schema.ts`) ensuring history continuity.

### Security Considerations
- Local Docker relies on host security; ensure `~/.cmux/logs` non-world-readable for secrets.  
- Cloud uses Morph API keys stored on server; sandbox metadata includes team & task for auditing.  
- Agent API keys are injected per-run; avoid storing in repo or logs.  
- WebSocket authentication required for all client events; unauthorized sockets disconnect immediately.

### Pricing/Limits Guidance
- Local mode is free aside from hardware.  
- Cloud: Morph sandboxes bill by runtime minutes and size; TTL set to 3600s. Use shorter TTL or explicit stop to control cost.  
- Consider running lighter agents (Haiku, GPT-5-mini) for exploratory tasks; reserve heavier models for targeted runs.

---

## Integrations

- **Git & Build Systems**
  - Git operations centralize through `RepositoryManager` for queueing and hook injection (`apps/server/src/repositoryManager.ts`).  
  - Dev server routing uses Express proxy with dynamic hostnames (`apps/server/src/proxyApp.ts`).  
  - Systemd packaging (`configs/systemd-*`) enables host-level services for cmux worker/proxy when deploying on dedicated servers.

- **Model Providers & API Keys** (`packages/shared/src/apiKeys.ts`)
  | Provider | Env Var | Notes |
  | -------- | ------- | ----- |
  | Anthropic Claude (Sonnet/Opus/Haiku) | `ANTHROPIC_API_KEY` | Supports thinking mode via custom args. |
  | OpenAI / Codex | `OPENAI_API_KEY` | Configs for GPT-5 tiers, o3/o4, reasoning knobs. |
  | OpenRouter | `OPENROUTER_API_KEY` | Enables OpenRouter-backed Qwen or GPT models. |
  | Google Gemini | `GEMINI_API_KEY` | Telemetry logged locally (`packages/shared/src/providers/gemini`). |
  | Sourcegraph AMP | `AMP_API_KEY` | Sourcegraph integration for code intelligence. |
  | Cursor | `CURSOR_API_KEY` | Wraps Cursor CLI for autop-run. |
  | Alibaba ModelStudio (Qwen) | `MODEL_STUDIO_API_KEY` | Additional Qwen provider configs. |

- **Webhooks & Event Streams**
  - GitHub integration: OAuth setup, PR sync, check runs, deployments (`packages/convex/convex/github_*.ts`).  
  - Stack integrations: `packages/convex/convex/stack*.ts` handle stack workflows.  
  - Morph orchestration exposes HTTP endpoints under `/api/dev-server`, `/api/sandboxes`, etc., via Hono router (`apps/www/lib/routes`).  
  - Event emitter: Socket.IO transports unify agent lifecycle events (`apps/server/src/transports/socketio-transport.ts`).

---

## Troubleshooting

### Common Issues & Resolutions

| Symptom | Likely Cause | Fix |
| ------- | ------------ | --- |
| “git: command not found” inside agent logs or workspace hydration failures | Docker image missing git or git not installed on host; see `apps/server/src/socket-handlers.ts` clone path | Rebuild/pull worker image (`WORKER_IMAGE_NAME`) with git installed, or install git on host. Verify `docker run cmux-worker which git`. |
| Agents hang, CPU grows over time (suspected memory leak) | tmux sessions/worker processes not cleaned up; watchers accumulating | Check running containers (`docker ps --filter name=cmux-`). Ensure CLI upgraded (cleanup logic in `apps/server/src/server.ts`). Capture heap snapshots via `node --inspect` if server process grows. Consider raising `ulimit -n` and monitor `~/.cmux/logs/docker-vscode.log`. |
| Processes persist after `Ctrl+C` | CLI exit before cleanup resolves | Manually call `cmux uninstall` or run `docker stop $(docker ps -a --filter "name=cmux-" -q)` plus `rm -rf ~/.cmux/logs/*.log` as needed. Ensure you wait for CLI exit message; upgrade to latest release (cleanup improvements under `apps/server/src/server.ts`). |
| VS Code page shows 502 / blank | Proxy cannot reach container (port mapping invalid or container stopped) | Inspect `docker logs <container>` and `~/.cmux/logs/server.log`. Restart workspace; verify reserved ports not in use. For cloud, ensure sandbox still running (`POST /api/sandboxes/by-id/status`). |
| Docker image pull failures | Auth required for private registry | Pre-login (`docker login`) and set `WORKER_IMAGE_NAME` to accessible image. Check `~/.cmux/logs/docker-pull.log`. |
| Docker not detected | OrbStack / Docker Desktop stopped | Start daemon; CLI prints targeted instructions (mac vs non-mac). |

### Diagnostic Commands & Logs
- `tail -f ~/.cmux/logs/server.log` – backend operations, errors.  
- `tail -f ~/.cmux/logs/docker-vscode.log` – container lifecycle.  
- `docker ps -a | grep cmux-` – list active VS Code containers.  
- `docker logs <container>` – inspect agent run.  
- `node scripts/watch-gemini-telemetry.js --file /tmp/gemini-telemetry-*.log --from-start` – live telemetry.  
- `bun scripts/test.ts --filter worker` – run worker integration tests (ensure `CMUX_SKIP_DOCKER_TESTS` unset).  
- `convex dev` (inside `packages/convex`) – debug backend logic locally.

---

## Guides & Recipes

- **Local Development Setup**
  1. Install cmux CLI and dependencies (Docker).  
  2. Run `cmux` pointing at your repo.  
  3. Configure API keys via dashboard or `~/.config/cmux/` (if supported).  
  4. Start task → select agents → review diffs and logs.  
  5. Use `git diff` in workspace for manual edits; changes sync to UI via `GitDiffManager`.

- **Cloud Deployment Workflow**
  1. Define Morph snapshots and environment scripts (`apps/www/lib/routes/sandboxes/startDevAndMaintenanceScript.ts`).  
  2. Set environment secrets in data vault (`loadEnvironmentEnvVars`).  
  3. From dashboard, start cloud workspace referencing snapshot/environment.  
  4. Monitor via VS Code URL; publish devcontainer endpoints with `postApiSandboxesByIdPublishDevcontainer`.  
  5. Capture snapshot updates using scripts in `scripts/morph_snapshot*.py`.

- **Custom Model Integration**
  1. Create new config file under `packages/shared/src/providers/<provider>/configs.ts`.  
  2. Export `AgentConfig` with command, args, telemetry, API keys.  
  3. Add to `AGENT_CONFIGS` in `agentConfig.ts`.  
  4. Update frontend selector (provider readiness, icon) if needed.  
  5. Document API key requirement here and in dashboard hints.

- **VS Code Extension / Editor Sync**
  - `packages/vscode-extension` contains the extension bundling tmux attach logic.  
  - Customize behaviour (e.g., new tmux session names) by editing `extension.ts`.  
  - Use cmux CLI to copy host VS Code settings during onboarding (feature flagged in TODOs).

- **Automated PR Review Scenario**
  1. Trigger `github-sync-pr-state` socket event (UI or script) to refresh PR data.  
  2. Use `apps/www/scripts/pr-review.ts` for CLI-driven reviews.  
  3. Embrace `apps/www/lib/services/code-review/start-code-review.ts` for server-side automation.

---

## Reference

- **CLI Command Reference**
  | Command | Description |
  | ------- | ----------- |
  | `cmux [repo]` | Launch server; accepts options `-p/--port`, `-c/--cors`, `--no-autokill-ports`. |
  | `cmux uninstall` | Removes `~/.cmux/`, prints uninstall instructions for package managers. |

- **Configuration Schema**
  - Convex schema defined in `packages/convex/convex/schema.ts` covers collections: `tasks`, `taskRuns`, `localWorkspaces`, `environments`, `teams`, `workspaceSettings`, `taskRunLogChunks`, `storage`, etc.  
  - REST/OpenAPI definitions live under `apps/www/lib/routes/*.ts` (Hono). Run `bunx @hono/swagger-ui` to visualize (future improvement).

- **API Endpoints (Selected)**
  - `POST /api/sandboxes/start` – start Morph sandbox.  
  - `POST /api/dev-server` – request dev server publish (Morph).  
  - `GET /api/github/repos` / `GET /api/github/prs` – GitHub data proxies.  
  - `POST /api/branch/switch` – branch operations.  
  - `POST /api/users/me` – authenticated user info.  
  - `GET /api/health` – health checks for monitoring.  
  - `POST /api/teams/:id/environments` – environment management.

- **Ports Summary**
  - `9776` – Dashboard/server HTTP.  
  - `9777` – Convex backend (bundled).  
  - `9778` – Ancillary services (e.g., reverse proxy).  
  - `39375-39381` – VS Code HTTP, worker, proxy, VNC, Chrome DevTools (reserved).  
  - Custom dev servers are proxied through Express using wildcards (`apps/server/src/proxyApp.ts`).

- **System Services**
  - `configs/systemd-host/*` – service units for headless deployments (`cmux-openvscode`, `cmux-worker`, `cmux-proxy`).  
  - NFPM packaging manifest (`configs/nfpm/cmux.yaml`) describes layout for `.deb`/`.rpm`.

---

## Versioning & Changelog

- CLI version injected via `scripts/build-cli.ts` (defines `VERSION` constant during Bun compile).  
- `package.json` (root & `packages/cmux`) tracks semver published to npm/bun.  
- Recommended documentation workflow:
  1. Tag releases (`git tag vX.Y.Z`).  
  2. Update `docs/README.md` and proposed `docs/changelog.md` with features/fixes.  
  3. Note compatibility (e.g., new env vars, API endpoints).  
  4. For Morph snapshot updates, record snapshot IDs used per release.

- **Known Issues & Deprecations**
  - Worktree reliability and git credential copying tracked in `TODOS.md`.  
  - Morph VS Code integration marked “make MorphVSCodeInstance actually work” – progress ongoing; use `CmuxVSCodeInstance` as current implementation.  
  - Long branch names TODO; expect naming adjustments soon.  
  - Electron distribution WIP; local docs should mention limitations until shipped.

---

## Documentation Workflow

- **Docs location**: Source resides under `docs/`. This README serves as the root for a future generated site.
- **Recommended hosting**: Adopt Docusaurus or a similar static site generator to leverage:  
  1. Versioned docs tied to releases.  
  2. Full-text search across guides/reference.  
  3. Deep-linkable sections for agent configs, troubleshooting, API reference.  
  4. Easy deployment via GitHub Pages, Vercel, or Netlify.
- **Next steps**
  1. Break this README into topic pages (`docs/overview.md`, `docs/quick-start/local.md`, etc.).  
  2. Generate OpenAPI specs from `apps/www/lib/routes` for API docs.  
  3. Automate changelog extraction from Git history and Convex migrations.  
  4. Add diagrams (Mermaid) showing local vs cloud data flow once Docusaurus is in place.

---

This document should be updated alongside feature work and release planning so contributors and users have a single, accurate reference for cmux capabilities and operations.
