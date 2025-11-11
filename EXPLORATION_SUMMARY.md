# CMUX Workspace Creation - Exploration Summary

This document provides a comprehensive overview of the exploration performed on the cmux codebase to understand how workspace creation works and where GitHub URL parsing and git checkout logic should be integrated.

## Generated Documentation

Three detailed documents have been created to assist with your implementation:

### 1. **WORKSPACE_CREATION_ANALYSIS.md**
- Comprehensive breakdown of the command palette implementation
- Detailed workspace creation flow for both local and cloud workspaces
- GitHub URL parsing utility documentation
- Git checkout logic explanation
- Integration points for URL pasting feature
- Socket event schemas
- Recommended implementation steps
- Quick reference table of key code locations

### 2. **WORKSPACE_ARCHITECTURE.txt**
- Visual ASCII diagrams of the system architecture
- Frontend component flow (React/Electron)
- Backend socket handler flow (Node.js)
- Workspace creation lifecycle
- GitHub URL parsing and branch checkout flow
- Request/response patterns

### 3. **CODE_SNIPPETS.md**
- 10 detailed code snippets from the actual implementation
- Keyboard shortcut detection logic
- Command bar state management
- Local workspace creation function
- Backend git clone logic
- GitHub URL parser implementation
- Socket schema definitions
- Workspace selection handlers
- Root command entries
- Socket validation logic

## Quick Start - Key Files

### Frontend Implementation
```
apps/client/
├── electron/main/
│   └── cmdk.ts                    # Keyboard shortcut handling (Cmd+K)
└── src/components/
    ├── CommandBar.tsx              # Command palette UI & logic (2718 lines)
    └── dashboard/
        └── WorkspaceCreationButtons.tsx
```

### Backend Implementation
```
apps/server/
└── src/
    └── socket-handlers.ts          # Socket event handlers (2320 lines)
    
packages/shared/src/
├── socket-schemas.ts              # Schema validation
└── utils/
    └── parse-github-repo-url.ts    # GitHub URL parser (51 lines)
```

## Workspace Creation Flow Summary

### Local Workspace
1. User opens command palette (Cmd+K)
2. Selects "New Local Workspace"
3. Searches/selects repository
4. `handleLocalWorkspaceSelect()` is called
5. `createLocalWorkspace()` emits socket event with:
   - `teamSlugOrId`
   - `projectFullName` (e.g., "owner/repo")
   - `repoUrl` (e.g., "https://github.com/owner/repo.git")
   - `branch` (optional)

### Backend Processing
1. Socket handler validates payload
2. Reserves task/taskRun in Convex
3. Creates workspace directory
4. Runs: `git clone [--branch <branch>] <repoUrl> <path>`
5. Verifies checkout with: `git rev-parse --verify HEAD`
6. Writes environment variables if configured
7. Updates VSCode instance status
8. Returns success callback to frontend
9. Frontend navigates to VSCode page

### Cloud Workspace
Similar flow but spawns Morph sandbox instead of local VSCode

## GitHub URL Parsing

### Location
`packages/shared/src/utils/parse-github-repo-url.ts`

### Supported Formats
- Simple: `owner/repo`
- HTTPS: `https://github.com/owner/repo` or `https://github.com/owner/repo.git`
- SSH: `git@github.com:owner/repo.git`

### Output
```typescript
{
  owner: string;           // "owner"
  repo: string;            // "repo"
  fullName: string;        // "owner/repo"
  url: string;             // "https://github.com/owner/repo"
  gitUrl: string;          // "https://github.com/owner/repo.git"
}
```

## Git Checkout Logic

### Location
`apps/server/src/socket-handlers.ts:950-1012`

### Implementation
```typescript
const cloneArgs = ["clone"];
if (branch) {
  cloneArgs.push("--branch", branch, "--single-branch");
}
cloneArgs.push(repoUrl, resolvedWorkspacePath);
await execFileAsync("git", cloneArgs, { cwd: workspaceRoot });
```

### Verification
```typescript
await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
  cwd: resolvedWorkspacePath,
});
```

## Integration Points for URL Pasting

### Current Search Flow
- User types in command palette search input
- Search is matched against available repos
- Results are displayed
- User selects repo to create workspace

### Enhancement Opportunities

#### Option 1: Smart Search Input
Detect if search input is a GitHub URL and:
1. Parse URL with `parseGithubRepoUrl()`
2. Extract `fullName`
3. Check if repo exists in available repos
4. Auto-suggest or directly create workspace

#### Option 2: Dedicated URL Paste Command
Add new command in root entries:
```
"Create Workspace from URL" 
- Read from clipboard
- Parse GitHub URL
- Create workspace if valid
```

#### Option 3: Paste Interception
Handle paste events in workspace selection pages:
- Detect GitHub URL in pasted text
- Auto-populate search field
- User can select matched repo

## Key Architectural Insights

### Frontend-Backend Communication
- Uses Socket.IO for real-time events
- Callback pattern for async responses
- Validates all payloads with Zod schemas
- Emits status updates during workspace creation

### Workspace Lifecycle
1. **Pending** - Task reserved, workspace creation starting
2. **Running** - Repository cloned, VSCode initialized
3. **Stopped** - User stops workspace
4. **Failed** - Error during creation (cleanup performed)

### Error Handling
- Comprehensive validation at each stage
- Cleanup of partial workspaces on failure
- Informative error messages to user
- Logging at server level for debugging

### Performance Considerations
- Async maintenance script execution (non-blocking)
- File watcher setup for real-time git changes
- Workspace path configuration via environment variable
- Efficient git clone with `--single-branch` flag

## Important Code Patterns

### Reactive State Management
```typescript
const [isCreatingLocalWorkspace, setIsCreatingLocalWorkspace] = useState(false);
const [activePage, setActivePage] = useState<"root" | "local-workspaces" | ...>();
```

### Socket Communication
```typescript
socket.emit("create-local-workspace", payload, callback => {
  // Handle response
});
```

### Convex Mutations
```typescript
const reservation = await convex.mutation(
  api.localWorkspaces.reserve,
  { teamSlugOrId, projectFullName, repoUrl, branch }
);
```

### Git Operations
```typescript
await execFileAsync("git", ["clone", "--branch", branch, "--single-branch", repoUrl, path]);
await execFileAsync("git", ["rev-parse", "--verify", "HEAD"]);
```

## Next Steps for Implementation

If implementing URL pasting feature:

1. **Import URL Parser**
   ```typescript
   import { parseGithubRepoUrl } from "@cmux/shared";
   ```

2. **Enhance Search Input**
   - Add logic to detect GitHub URLs in search
   - Use `parseGithubRepoUrl()` to validate
   - Check if parsed `fullName` matches available repos

3. **Update Workspace Selection**
   - Check if search is a URL before filtering repos
   - Directly create workspace if URL is valid and repo exists
   - Show error if URL is invalid or repo not found

4. **Testing**
   - Test all URL formats (simple, HTTPS, SSH)
   - Verify branch support
   - Test error cases (invalid URL, repo not found, private repo)

## File Statistics

| Document | Size | Key Sections |
|----------|------|--------------|
| WORKSPACE_CREATION_ANALYSIS.md | 12 KB | 8 major sections + reference table |
| WORKSPACE_ARCHITECTURE.txt | 15 KB | 2 ASCII diagrams + flow descriptions |
| CODE_SNIPPETS.md | 13 KB | 10 annotated code snippets |

## References

### Main Implementation Files
- Frontend: `/root/workspace/apps/client/src/components/CommandBar.tsx` (2718 lines)
- Backend: `/root/workspace/apps/server/src/socket-handlers.ts` (2320 lines)
- Parser: `/root/workspace/packages/shared/src/utils/parse-github-repo-url.ts` (51 lines)
- Schemas: `/root/workspace/packages/shared/src/socket-schemas.ts`

### Related Documentation
- `/root/workspace/CLAUDE.md` - Project conventions and setup
- `/root/workspace/README.md` - Project overview
- `/root/workspace/LAUNCH.md` - Launch instructions

## How to Use This Documentation

1. **For Overview:** Start with WORKSPACE_CREATION_ANALYSIS.md Section 1-2
2. **For Architecture:** Review WORKSPACE_ARCHITECTURE.txt diagrams
3. **For Implementation:** Check CODE_SNIPPETS.md for exact patterns
4. **For Reference:** Use the quick reference table in WORKSPACE_CREATION_ANALYSIS.md
5. **For Deep Dive:** Read through all three documents in order

---

**Generated:** November 11, 2025
**Codebase:** cmux (main branch)
**Focus:** Workspace creation, command palette, GitHub URL parsing, git checkout
