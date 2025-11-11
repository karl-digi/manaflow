# CMUX Workspace Creation - Quick Reference Card

## Files You Need to Know

| Location | Purpose | Lines | Role |
|----------|---------|-------|------|
| `apps/client/electron/main/cmdk.ts` | Keyboard shortcut handler | ~880 | Detects Cmd+K, sends IPC messages |
| `apps/client/src/components/CommandBar.tsx` | Command palette UI | 2718 | All workspace creation logic on frontend |
| `apps/server/src/socket-handlers.ts` | Backend socket events | 2320 | Git clone, verification, VSCode setup |
| `packages/shared/src/socket-schemas.ts` | Data validation | ~200 | Zod schemas for type safety |
| `packages/shared/src/utils/parse-github-repo-url.ts` | URL parsing | 51 | Parses GitHub URLs into components |

## Core Functions

### Frontend
```typescript
// Command Bar Component
export function CommandBar({ teamSlugOrId, ... }: CommandBarProps)

// State Management
const [open, setOpen] = useState(false);
const [search, setSearch] = useState("");
const [activePage, setActivePage] = useState<"root" | "local-workspaces" | ...>();

// Workspace Creation
const createLocalWorkspace = useCallback(async (projectFullName: string) => { ... });
const createCloudWorkspaceFromRepo = useCallback(async (projectFullName: string) => { ... });

// Workspace Selection
const handleLocalWorkspaceSelect = useCallback((projectFullName: string) => { ... });
const handleCloudWorkspaceSelect = useCallback((option: CloudWorkspaceOption) => { ... });
```

### Backend
```typescript
// Socket Handler
socket.on("create-local-workspace", async (rawData, callback) => {
  // Validate payload
  // Reserve task/taskRun
  // Clone repository
  // Verify checkout
  // Setup VSCode
  // Return callback
});

// Git Operations
const cloneArgs = ["clone"];
if (branch) cloneArgs.push("--branch", branch, "--single-branch");
cloneArgs.push(repoUrl, resolvedWorkspacePath);
await execFileAsync("git", cloneArgs, { cwd: workspaceRoot });
```

### URL Parser
```typescript
export function parseGithubRepoUrl(input: string): {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
  gitUrl: string;
} | null
```

## Data Flow

```
User Input (Cmd+K)
    ↓
cmdk.ts (Electron) - Captures keystroke
    ↓
IPC Message: cmux:event:shortcut:cmd-k
    ↓
CommandBar.tsx - Opens palette, shows commands
    ↓
User selects "New Local Workspace"
    ↓
setActivePage("local-workspaces")
    ↓
Display available repos
    ↓
User selects repo
    ↓
handleLocalWorkspaceSelect(projectFullName)
    ↓
createLocalWorkspace(projectFullName)
    ↓
reserveLocalWorkspace() mutation
    ↓
socket.emit("create-local-workspace", payload, callback)
    ↓
BACKEND: socket.on("create-local-workspace", ...)
    ↓
Validate → Reserve Task → Clone Repo → Verify → Setup VSCode
    ↓
callback({success: true, taskId, workspaceUrl, ...})
    ↓
Navigate to VSCode page
```

## Key Objects

### Local Workspace Creation Payload
```typescript
{
  teamSlugOrId: string;      // Team identifier
  projectFullName: string;   // "owner/repo"
  repoUrl: string;           // "https://github.com/owner/repo.git"
  branch?: string;           // Optional branch name
  taskId?: Id<"tasks">;
  taskRunId?: Id<"taskRuns">;
  workspaceName?: string;
  descriptor?: string;
}
```

### Local Workspace Response
```typescript
{
  success: boolean;
  taskId?: Id<"tasks">;
  taskRunId?: Id<"taskRuns">;
  workspaceName?: string;
  workspacePath?: string;
  workspaceUrl?: string;
  pending?: boolean;
  error?: string;
}
```

### Parsed GitHub URL
```typescript
{
  owner: "facebook",
  repo: "react",
  fullName: "facebook/react",
  url: "https://github.com/facebook/react",
  gitUrl: "https://github.com/facebook/react.git"
}
```

## Key Constants & Enums

```typescript
// Active Pages
type ActivePage = "root" | "teams" | "local-workspaces" | "cloud-workspaces";

// Workspace Status
type WorkspaceStatus = "starting" | "running" | "stopped" | "failed";

// Environment Variables
CMUX_WORKSPACE_DIR  // Default: ~/cmux/local-workspaces
```

## Git Commands Used

```bash
# Clone with optional branch
git clone --branch <branch> --single-branch <repoUrl> <path>

# Verify checkout succeeded
git rev-parse --verify HEAD
```

## Socket Events

| Event | Direction | Purpose |
|-------|-----------|---------|
| `create-local-workspace` | Client → Server | Request workspace creation |
| `create-cloud-workspace` | Client → Server | Request cloud workspace |
| `git-file-changed` | Server → Client | File watcher update |
| `terminal-output` | Server → Client | Terminal data |

## Import Statements You'll Need

```typescript
// Frontend
import { parseGithubRepoUrl } from "@cmux/shared";
import type { CreateLocalWorkspaceResponse } from "@cmux/shared";
import { toast } from "sonner";
import { useSocket } from "@/contexts/socket/use-socket";

// Backend
import { CreateLocalWorkspaceSchema } from "@cmux/shared";
import { execFileAsync } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";

// Utility Functions
import { buildSearchText, filterCommandItems } from "./command-bar/commandSearch";
import { deriveRepoBaseName } from "@cmux/shared";
```

## Common Patterns

### Prevent Double Creation
```typescript
if (isCreatingLocalWorkspace) {
  return;
}
setIsCreatingLocalWorkspace(true);
try {
  // Create workspace
} finally {
  setIsCreatingLocalWorkspace(false);
}
```

### Validation Pattern
```typescript
const parsed = CreateLocalWorkspaceSchema.safeParse(rawData);
if (!parsed.success) {
  callback({ success: false, error: "Invalid payload" });
  return;
}
const { projectFullName, branch, ... } = parsed.data;
```

### Git Error Handling
```typescript
try {
  await execFileAsync("git", cloneArgs, { cwd: workspaceRoot });
} catch (error) {
  const execErr = isExecError(error) ? error : null;
  const message = execErr?.stderr?.trim() || error.message;
  throw new Error(`Git clone failed: ${message}`);
}
```

## Testing URLs

```
Valid: "owner/repo"
Valid: "https://github.com/owner/repo"
Valid: "https://github.com/owner/repo.git"
Valid: "git@github.com:owner/repo"
Valid: "git@github.com:owner/repo.git"
Invalid: "not-a-url"
Invalid: "https://example.com/owner/repo"
```

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Socket not connected | Wait for `useSocket()` hook to initialize |
| Git clone fails | Check internet, repo URL validity |
| Workspace directory exists | Clean up before retry, use unique workspace names |
| Branch not found | Verify branch name, check git remote |
| Permission denied | Ensure workspace directory is writable |
| No VSCode connection | Check if serve-web proxy is ready |

## Useful Git Checks

```typescript
// Check if directory is a git repository
git rev-parse --git-dir

// Get current branch
git rev-parse --abbrev-ref HEAD

// Get current commit
git rev-parse HEAD

// List remote branches
git ls-remote <repoUrl>
```

## Documentation Files

- `EXPLORATION_SUMMARY.md` - Overview and how to use docs
- `WORKSPACE_CREATION_ANALYSIS.md` - In-depth analysis (start here)
- `WORKSPACE_ARCHITECTURE.txt` - Visual diagrams and flows
- `CODE_SNIPPETS.md` - Actual code from implementation
- `QUICK_REFERENCE.md` - This file!

---

**Last Updated:** November 11, 2025
