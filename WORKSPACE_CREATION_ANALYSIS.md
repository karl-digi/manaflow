# CMUX Workspace Creation Flow - Analysis

## Overview
This document details how the "new cloud/local workspace" commands are implemented in cmux and where GitHub URL parsing and git checkout logic should be integrated.

---

## 1. Command Palette Implementation

### Location
- **Electron CmdK Handler:** `/root/workspace/apps/client/electron/main/cmdk.ts`
- **React Command Bar:** `/root/workspace/apps/client/src/components/CommandBar.tsx`

### How It Works

#### 1.1 Keyboard Shortcut Detection (Electron)
- **File:** `apps/client/electron/main/cmdk.ts`
- **Mechanism:** 
  - Listens for `Cmd+K` (Mac) or `Ctrl+K` (Linux/Windows)
  - Detects exact key combination (lines 242-252)
  - Prevents default browser behavior
  - Captures currently focused DOM element before opening palette
  - Sends `cmux:event:shortcut:cmd-k` IPC message to renderer

#### 1.2 React UI Component
- **File:** `apps/client/src/components/CommandBar.tsx`
- **Key State:**
  ```tsx
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activePage, setActivePage] = useState<
    "root" | "teams" | "local-workspaces" | "cloud-workspaces"
  >("root");
  ```

---

## 2. Workspace Creation Flow

### 2.1 Local Workspace Creation

#### Frontend Flow (CommandBar.tsx)
1. **File:** `apps/client/src/components/CommandBar.tsx:685-839`
2. **Function:** `createLocalWorkspace(projectFullName: string)`
3. **Steps:**
   ```
   User selects repo → clearCommandInput() → closeCommand() → 
   createLocalWorkspace(projectFullName) is called
   ```

4. **Process:**
   - Constructs repo URL: `https://github.com/${projectFullName}.git`
   - Calls `reserveLocalWorkspace()` mutation to create task/taskRun in Convex
   - Emits `create-local-workspace` socket event with:
     ```js
     {
       teamSlugOrId,
       projectFullName,
       repoUrl,
       taskId,
       taskRunId,
       workspaceName,
       descriptor
     }
     ```
   - Waits for callback response and navigates to task/run page

#### Backend Handler (socket-handlers.ts)
1. **File:** `apps/server/src/socket-handlers.ts:639-1105`
2. **Event:** `socket.on("create-local-workspace", ...)`
3. **Steps:**

   **Validation (lines 645-687):**
   - Validates payload against `CreateLocalWorkspaceSchema`
   - Checks for invalid environment repos
   - Validates repo name format: `[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+`

   **Workspace Setup (lines 732-820):**
   - Creates task/taskRun reservation if not provided
   - Constructs workspace path: `${CMUX_WORKSPACE_DIR}/${workspaceName}`
   - Loads workspace config from API (`getApiWorkspaceConfigs`)
   - Writes environment variables to `.env` file if configured

   **Git Clone (lines 950-1012):**
   ```ts
   // Build clone arguments
   const cloneArgs = ["clone"];
   if (branch) {
     cloneArgs.push("--branch", branch, "--single-branch");
   }
   cloneArgs.push(repoUrl, resolvedWorkspacePath);
   
   // Execute: git clone [--branch <branch>] <repoUrl> <path>
   await execFileAsync("git", cloneArgs, { cwd: workspaceRoot });
   
   // Verify checkout succeeded
   await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
     cwd: resolvedWorkspacePath,
   });
   ```

   **VSCode Setup (lines 896-1035):**
   - Updates VSCode instance status to "starting"
   - Updates task run with placeholder workspace URL
   - Runs maintenance script in background (if configured)
   - Sets up file watcher for git changes

### 2.2 Cloud Workspace Creation

#### Frontend Flow
1. **File:** `apps/client/src/components/CommandBar.tsx:934-1012`
2. **Function:** `createCloudWorkspaceFromRepo(projectFullName: string)`
3. **Process:**
   - Creates task in Convex with `isCloudWorkspace: true`
   - Emits `create-cloud-workspace` socket event with:
     ```js
     {
       teamSlugOrId,
       projectFullName,
       repoUrl,
       taskId,
       theme
     }
     ```
   - Launches Morph sandbox (Docker/configurable provider)

#### Backend Handler
1. **File:** `apps/server/src/socket-handlers.ts:1107-1260+`
2. **Event:** `socket.on("create-cloud-workspace", ...)`
3. **Process:**
   - Validates payload
   - Creates task/taskRun
   - Spawns Morph sandbox instance
   - Configures VSCode with environment/repo setup

---

## 3. GitHub URL Parsing Utility

### Location & Implementation
- **File:** `/root/workspace/packages/shared/src/utils/parse-github-repo-url.ts`

### Supported Formats
```ts
parseGithubRepoUrl(input: string) → {
  owner: string;
  repo: string;
  fullName: string;        // "owner/repo"
  url: string;             // "https://github.com/owner/repo"
  gitUrl: string;          // "https://github.com/owner/repo.git"
} | null
```

### Supported URL Patterns
1. **Simple:** `owner/repo`
2. **HTTPS:** `https://github.com/owner/repo` or `https://github.com/owner/repo.git`
3. **SSH:** `git@github.com:owner/repo.git`

### Code
```ts
export function parseGithubRepoUrl(input: string) {
  const simpleMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
  const httpsMatch = trimmed.match(
    /^https?:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:\/)?$/i
  );
  const sshMatch = trimmed.match(
    /^git@github\.com:([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/i
  );
  
  const match = simpleMatch || httpsMatch || sshMatch;
  // ... validation and extraction
}
```

---

## 4. Git Checkout Logic

### Branch Specification
- **File:** `apps/server/src/socket-handlers.ts:950-972`
- **Implementation:**
  ```ts
  // Clone with optional branch
  const cloneArgs = ["clone"];
  if (branch) {
    cloneArgs.push("--branch", branch, "--single-branch");
  }
  cloneArgs.push(repoUrl, resolvedWorkspacePath);
  
  await execFileAsync("git", cloneArgs, { cwd: workspaceRoot });
  ```

### Verification
- **File:** `apps/server/src/socket-handlers.ts:974-991`
- **Ensures checkout succeeded:**
  ```ts
  await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: resolvedWorkspacePath,
  });
  ```

### Git-related Utilities
- **Check Git Status:** `packages/shared/src/providers/common/check-git.ts`
- **Check Version & Remote Access:**
  ```ts
  export async function checkGitStatus() {
    const version = await execAsync("git --version");
    const remoteAccess = await execAsync(
      "git ls-remote https://github.com/git/git.git HEAD"
    );
    return { isAvailable, version, remoteAccess };
  }
  ```

---

## 5. Integration Points for URL Pasting

### Current Workspace Selection Flow
1. **Local Workspaces Page** (CommandBar.tsx:2580-2619)
   - Lists available repos from `reposByOrg` query
   - User selects from dropdown
   - Triggers `handleLocalWorkspaceSelect(projectFullName)`

2. **Cloud Workspaces Page** (CommandBar.tsx:2621-2660)
   - Lists environments and repos
   - User selects from list
   - Triggers `handleCloudWorkspaceSelect(option)`

### Integration Strategy for URL Pasting

#### Option 1: Enhance Search Input
**Location:** CommandBar.tsx line 2520-2526
```tsx
<Command.Input
  value={search}
  onValueChange={setSearch}  // ← Intercept here
  placeholder="Type a command or search..."
  ref={inputRef}
  className="..."
/>
```

**Modify to:**
1. Parse input with `parseGithubRepoUrl()` when user pastes URL
2. Extract `fullName` (owner/repo)
3. Check if it matches available repos
4. Auto-select and create workspace if valid

#### Option 2: Add Dedicated URL Paste Command
**Location:** CommandBar.tsx around line 1518-1926

**New Command Entry:**
```tsx
{
  value: "paste-url",
  label: "Create Workspace from URL",
  keywords: ["paste", "url", "clipboard", "github"],
  searchText: buildSearchText("Create Workspace from URL", ...),
  execute: async () => {
    const url = await navigator.clipboard.readText();
    const parsed = parseGithubRepoUrl(url);
    if (parsed) {
      handleLocalWorkspaceSelect(parsed.fullName);
    }
  },
  renderContent: () => (
    <>
      <Link className="h-4 w-4" />
      <span>Create Workspace from URL</span>
    </>
  ),
}
```

#### Option 3: Paste Interception in Workspace Pages
**Modify search input in workspace pages:**
```tsx
const handlePaste = (e: ClipboardEvent) => {
  const url = e.clipboardData?.getData("text");
  if (url) {
    const parsed = parseGithubRepoUrl(url);
    if (parsed) {
      setSearch(parsed.fullName);
    }
  }
};

// Add to command input
onPaste={handlePaste}
```

---

## 6. Socket Event Schemas

### Location
- **File:** `packages/shared/src/socket-schemas.ts`

### CreateLocalWorkspaceSchema (lines 53-63)
```ts
export const CreateLocalWorkspaceSchema = z.object({
  teamSlugOrId: z.string(),
  projectFullName: z.string().optional(),
  repoUrl: z.string().optional(),
  branch: z.string().optional(),
  taskId: typedZid("tasks").optional(),
  taskRunId: typedZid("taskRuns").optional(),
  workspaceName: z.string().optional(),
  descriptor: z.string().optional(),
  sequence: z.number().optional(),
});
```

### CreateLocalWorkspaceResponseSchema (lines 65-74)
```ts
export const CreateLocalWorkspaceResponseSchema = z.object({
  success: z.boolean(),
  taskId: typedZid("tasks").optional(),
  taskRunId: typedZid("taskRuns").optional(),
  workspaceName: z.string().optional(),
  workspacePath: z.string().optional(),
  workspaceUrl: z.string().optional(),
  pending: z.boolean().optional(),
  error: z.string().optional(),
});
```

---

## 7. File Structure Summary

### Key Files
```
apps/client/
├── electron/main/
│   └── cmdk.ts                    # Keyboard shortcut handling
└── src/components/
    ├── CommandBar.tsx              # Command palette UI & logic
    └── dashboard/
        └── WorkspaceCreationButtons.tsx

apps/server/
└── src/
    └── socket-handlers.ts          # Socket event handlers
    
packages/shared/src/
├── socket-schemas.ts              # Schema validation
└── utils/
    └── parse-github-repo-url.ts    # GitHub URL parser
```

---

## 8. Recommended Implementation Steps

### To Support "Paste GitHub URL to Create Workspace"

1. **Enhance Search Input Handler** (CommandBar.tsx:288-292)
   - On `onValueChange`, detect if input is a valid GitHub URL
   - Use `parseGithubRepoUrl()` utility
   - Auto-suggest matching repos

2. **Modify Workspace Selection** (CommandBar.tsx:841-848)
   - Check if search input is a GitHub URL
   - Parse to get fullName
   - Create workspace immediately if valid

3. **Update Socket Schema** (socket-schemas.ts:53-63)
   - Add optional `gitUrl` field if needed
   - Ensure `branch` parameter is utilized

4. **Backend Enhancements** (socket-handlers.ts:950-1012)
   - Already supports branch specification
   - Add commit hash support if needed:
     ```ts
     if (commitSha) {
       cloneArgs.push("--branch", commitSha);
     }
     ```

5. **Testing**
   - Test URL formats: `owner/repo`, `https://github.com/owner/repo.git`, `git@github.com:owner/repo`
   - Test branch checking (currently only supports `branch` in schema)
   - Verify error handling for invalid URLs/repos

---

## Key Code Locations for Reference

| Feature | File | Lines |
|---------|------|-------|
| Keyboard Shortcut (Electron) | `cmdk.ts` | 242-262 |
| Command Bar Component | `CommandBar.tsx` | 283-2718 |
| Local Workspace Creation | `CommandBar.tsx` | 685-839 |
| Cloud Workspace Creation | `CommandBar.tsx` | 934-1012 |
| Socket Handler (Local) | `socket-handlers.ts` | 639-1105 |
| Socket Handler (Cloud) | `socket-handlers.ts` | 1107-1260+ |
| Git Clone Logic | `socket-handlers.ts` | 950-972 |
| Branch Checkout | `socket-handlers.ts` | 954-957 |
| URL Parser | `parse-github-repo-url.ts` | 11-51 |
| Socket Schemas | `socket-schemas.ts` | 53-98 |

