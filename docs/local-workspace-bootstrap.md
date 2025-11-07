# Local Workspace Bootstrap

Provide a first-class way for every user to define the environment variables and bootstrap scripts that should be applied whenever a local workspace is created. The goal is that a freshly created workspace already has the expected secrets, dev tooling, and package installs in flight before VS Code finishes loading.

---

## Problem & Goals

- Today `apps/server/src/socket-handlers.ts` simply clones a repo into `~/cmux/local-workspaces/<name>` and marks the `taskRuns` row as running. Users still need to:
  - copy `.env` files or secrets manually,
  - run `npm/pnpm/bun install`,
  - execute any per-project bootstrap scripts (install brew deps, run `direnv allow`, etc.).
- We need a configurable, repeatable pipeline so that “open workspace” == “workspace is ready”.

### Goals
1. **Per-user/per-team config** for local workspace bootstrap (env vars + scripts).
2. **Safe secret handling**: secrets live in Convex the same way API keys already do; generated files on disk are clearly labeled and permissions are locked down.
3. **Observable progress**: task headers should show “Installing dependencies …” with logs/errors surfaced in the UI, not hidden terminals.
4. **Extensible** foundation so we can later reuse the same config for cloud (Morph) workspaces.

### Non-goals
- Replacing the existing environment-level maintenance/dev scripts (those continue to power Morph environments).
- Dotfile mangement across the entire OS.

---

## User Experience

### 1. Configure once from Settings
On `/_layout/$teamSlugOrId/settings` (same screen that already hosts worktree path + API keys):

| Section | UX |
| --- | --- |
| **Environment variables** | Table identical to the Environment builder (`EnvVar` rows with show/hide). Extra inputs: `Target file` (defaults to `.env.local`) and `Write mode` (`Append cmux block` vs `Replace entire file`). |
| **Package install** | Toggle `Auto-install dependencies`. When enabled, pick package manager (`pnpm`, `npm`, `yarn`, `bun`, `auto-detect`). Optional args (defaults to `install`). |
| **Custom bootstrap script** | `ScriptTextareaField` with linted preset that runs after installs. Options: “Run on every workspace” vs “Only on first clone”, “Stop workspace if script fails”. |
| **Test run** | `Dry-run bootstrap` button takes a folder path, runs the script, and streams output inside a modal. |

A “Save bootstrap” button piggybacks on the existing save logic (same toast, same optimistic UI). When config changes we bump a `version` counter; existing workspaces can detect the mismatch and offer a “re-run bootstrap” CTA.

### 2. Launch a workspace
When the user spawns a local workspace, the task header shows a dedicated card:

```
Bootstrap
  Env vars injected            ✅ 1.2 s
  Dependencies (pnpm install)  ⏳ Installing (42%)
  Custom script                ◻︎ Waiting
```

- Clicking the card expands log tail (`bootstrap.log` last 200 lines) with copy/download buttons.
- If a step fails we surface the error inline with “Re-run bootstrap” and “Open log file” buttons.
- Once everything succeeds we keep the card collapsed, showing a green check + duration.

### 3. Observability & control
- Re-run button emits a new socket event `reapply-local-bootstrap` so that users can retry without recreating the workspace.
- Task timeline entries (in the right panel) also record `Bootstrap succeeded` or `Bootstrap failed`.

---

## Data Model & API Changes

### `workspaceSettings` table (`packages/convex/convex/schema.ts`)
Add an optional `localBootstrap` object:

```ts
localBootstrap: v.optional(
  v.object({
    version: v.number(),
    envFileName: v.string(),            // default ".env.local"
    envWriteMode: v.union(
      v.literal("append-block"),
      v.literal("replace-file"),
    ),
    envVars: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        value: v.string(),
        isSecret: v.boolean(),
      }),
    ),
    autoInstall: v.optional(
      v.object({
        enabled: v.boolean(),
        manager: v.union(
          v.literal("auto"),
          v.literal("pnpm"),
          v.literal("npm"),
          v.literal("yarn"),
          v.literal("bun"),
        ),
        args: v.string(),               // e.g. "install --frozen-lockfile"
        runMode: v.union(
          v.literal("creation-only"),
          v.literal("always"),
        ),
      }),
    ),
    setupScript: v.optional(v.string()),
    failFast: v.optional(v.boolean()),  // abort workspace create on failure?
    updatedAt: v.number(),
  }),
),
```

### Convex API

| Endpoint | Change |
| --- | --- |
| `api.workspaceSettings.get` | Already returns the full document, so no change beyond typing. |
| `api.workspaceSettings.update` | Accept optional `localBootstrap` payload; when omitted we leave existing data untouched. Any mutation bumps `localBootstrap.version = (prev ?? 0) + 1`. |
| `api.taskRuns.updateBootstrapStatus` (new) | Auth mutation that patches the `taskRuns` row with the latest bootstrap step statuses/log tails. |
| `api.taskRuns.markBootstrapComplete` (new) | Convenience mutation to flip success/failure + `completedAt`. |

### `taskRuns` schema
Add `bootstrap` field:

```ts
bootstrap: v.optional(
  v.object({
    version: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
    ),
    steps: v.array(
      v.object({
        kind: v.union(
          v.literal("env"),
          v.literal("install"),
          v.literal("script"),
        ),
        label: v.string(),
        status: v.union(
          v.literal("pending"),
          v.literal("running"),
          v.literal("succeeded"),
          v.literal("failed"),
        ),
        startedAt: v.optional(v.number()),
        finishedAt: v.optional(v.number()),
        exitCode: v.optional(v.number()),
        logTail: v.optional(v.string()), // last ~4 KB, sanitized
        error: v.optional(v.string()),
      }),
    ),
    lastUpdatedAt: v.number(),
  }),
),
```

The UI queries `taskRuns.getByTask` today, so no extra endpoints are required—Convex’s reactivity will push updates whenever we patch the run.

---

## Desktop Runtime Flow

1. **Fetch config**
   - After `api.localWorkspaces.reserve` resolves inside `apps/server/src/socket-handlers.ts`, call `api.workspaceSettings.get` for the auth’d user.
   - Cache configs per `(teamId,userId)` for ~30 seconds to avoid extra round trips when multiple workspaces start.

2. **Prepare `.cmux` folder**
   - Create `<workspace>/.cmux` (chmod `700`).
   - Drop a `bootstrap.json` file that records `{ profileVersion, appliedAt }`. This helps us know when “re-run bootstrap” should run again.

3. **Inject env vars**
   - Use `formatEnvVarsContent` to render the env block.
   - Respect `envWriteMode`:
     - `append-block` → insert between `# >>> cmux (do not edit)` / `# <<<`.
     - `replace-file` → rewrite the target file from scratch.
   - Files are written with `0o600` permissions.
   - Update step status to `succeeded` immediately (or `failed` with log on exception).

4. **Auto-install dependencies**
   - Build the command:
     - If manager is `auto`, inspect lockfiles (`pnpm-lock.yaml`, `package-lock`, `yarn.lock`, `bun.lockb`) and pick the first match.
     - Fallback to `npm install`.
   - Spawn via `spawn("/bin/zsh", ["-lc", command], { cwd, env: process.env })`.
   - Stream `stdout` / `stderr`:
     - Append to `.cmux/bootstrap.log`.
     - Keep a rolling 4 KB tail per step; include ANSI scrubber before storing in Convex.
     - Emit optional realtime event `local-bootstrap-log` (future friendly) if we want live streaming without waiting for Convex writes.
   - Respect `runMode` (`creation-only` vs `always`).

5. **Custom script**
   - Write script contents to `.cmux/bootstrap.sh` with a small header:

     ```sh
     #!/bin/zsh
     set -euo pipefail
     export CMUX_BOOTSTRAP_VERSION="7"
     export CMUX_WORKSPACE_NAME="alpha-falcon"
     # --- user content follows
     ```

   - Run it after the install step (or immediately if install disabled).

6. **Status + failure handling**
   - Every state transition updates `taskRuns.bootstrap`.
   - If `failFast` is true and a step fails, we mark the entire run as `failed` and surface the error via `taskRuns.fail`. Otherwise we continue but show the failure in UI.
   - On success we set `bootstrap.status = "succeeded"`, update `taskRuns.updatedAt`, and optionally send a toast via the socket (`rt.emit("notify", …)`).

7. **Re-run command**
   - New socket event `reapply-local-bootstrap` accepts `{ taskRunId }`.
   - Handler validates taskRun belongs to user/team, then re-enters the same pipeline (skipping `git clone`).

---

## Client UI Updates

1. **Settings page**
   - Add `WorkspaceBootstrapCard` below the existing “Local worktree path” section inside `apps/client/src/routes/_layout.$teamSlugOrId.settings.tsx`.
   - Reuse `EnvironmentConfiguration`’s env var row component for consistency. Shared logic (auto-add blank row, reveal/hide).
   - Persist form state to React Query mutation `api.workspaceSettings.update`.
   - When user toggles auto-install to `auto`, show a helper text: “We detect package managers via lockfiles (pnpm > npm > yarn > bun).”

2. **Task detail header**
   - New `BootstrapStatusBadge` inside `apps/client/src/components/task-detail-header.tsx`.
   - When `taskRun.bootstrap` exists:
     - Show spinner + label while `status` is `pending/running`.
     - On hover/click, open panel listing each step with durations and log tail.
     - Provide “Re-run bootstrap” button (calls new socket event).

3. **Workspace list / board**
   - In `apps/client/src/routes/_layout.$teamSlugOrId.workspaces.tsx`, surface a small status pill (✓ / ! / …) so users can see whether a workspace is ready without opening the detail page.

4. **Toasts**
   - When server marks `bootstrap.status = failed`, show a toast with “Bootstrap failed for alpha-falcon — view logs” linking to the task.

---

## Telemetry & Logging

- `.cmux/bootstrap.log` keeps the full raw output locally.
- Convex only stores truncated `logTail` text for quick UI display.
- `taskRuns.bootstrap` contains timestamps so we can compute durations for analytics.
- Optional future addition: send aggregated metrics (success/failure counts) to PostHog alongside workspace create events.

---

## Edge Cases & Safeguards

- **Existing `.env.local`**: we only mutate the cmux-delimited block, leaving user-owned lines untouched.
- **Multi-repo tasks**: bootstrap config is per user so each workspace gets identical env vars regardless of repo.
- **Missing config**: pipeline short-circuits; UI simply hides the badge.
- **Script hangs**: add `maxDurationMs` (default 10 minutes). When exceeded, we kill the process, mark failure, and surface in UI.
- **Secrets in logs**: before storing log tail, run a redaction pass that masks any env var values defined in the profile.

---

## Rollout Plan

1. **Data layer**
   - Update Convex schema + regenerate types.
   - Implement `workspaceSettings.update` + `taskRuns.updateBootstrapStatus`.
   - Write migration script to backfill `localBootstrap` = `null`.
2. **Server pipeline**
   - Refactor local workspace creation into smaller helpers (`prepareWorkspace`, `applyBootstrapEnv`, `runBootstrapSteps`).
   - Add new socket handler for re-run.
3. **Client UI**
   - Build Settings card with optimistic saves.
   - Add Task header component + toast wiring.
4. **QA**
   - Unit test the env file merger (append vs replace).
   - E2E manual test matrix: {pnpm/npm/yarn/bun} × macOS/Linux.
5. **Docs**
   - Update README (`Local workspace bootstrap` section) and record a short Loom showing the UX.

---

## Open Questions

1. Should auto-install default to “on” with auto-detect? (Leaning yes; we can seed with `pnpm install`.)
2. Do we need per-repo overrides? If so, we could extend the config to allow optional repository filters later.
3. Where should bootstrap logs live in the UI long-term? Task header may be cramped; a dedicated “Bootstrap” tab might be better if demand grows.

This spec gives us a concrete path to make every new workspace feel ready out of the box while keeping the UX approachable for less technical teammates.
