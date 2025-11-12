# Cloud Workspace "Open With" Implementation

## Problem Statement

The "Open with" functionality for cloud tasks (Morph instances) had several issues:

1. **Hardcoded `/root/workspace` path**: The vscode-remote option always used `/root/workspace` folder parameter, ignoring any potential variations
2. **No git sync**: Repositories in cloud workspaces couldn't be synced/updated without manual intervention
3. **Multiple repos in environments**: Environments can have `selectedRepos` (multiple git repos), but the system didn't handle opening them properly
4. **Incorrect folder for single vs multi-repo setups**:
   - Single repo: cloned directly into `/root/workspace`
   - Multi-repo (environments): cloned as subdirectories under `/root/workspace`

## Solution Overview

The solution introduces:
1. **Configurable workspace root**: `cloudWorkspaceRoot` parameter (defaults to `/root/workspace`)
2. **URL API usage**: Proper URL construction instead of string concatenation to avoid query param issues
3. **Sync repos action**: New "Sync repos" button that re-runs hydration to git pull updates
4. **Proper edge case handling**: Handles missing repos, wrong repos, and multiple repo scenarios

## Architecture

### Frontend Changes

#### 1. useOpenWithActions Hook (`apps/client/src/hooks/useOpenWithActions.ts`)

**New Parameters:**
- `cloudWorkspaceRoot?: string | null` - The workspace root path in the cloud instance (default: `/root/workspace`)
- `selectedRepos?: string[] | null` - List of repos in the environment (for UI hints/future features)
- `onSyncCloudWorkspace?: (() => Promise<void>) | null` - Callback to sync repos

**Key Changes:**
```typescript
// Before: Hardcoded path with string concatenation
const vscodeUrlWithWorkspace = `${normalizedUrl}?folder=/root/workspace`;

// After: URL API with configurable path
const url = new URL(normalizedUrl);
const folder = cloudWorkspaceRoot ?? "/root/workspace";
url.searchParams.set("folder", folder);
window.open(url.toString(), "_blank", "noopener,noreferrer");
```

**New Return Value:**
- `syncRepos?: () => Promise<void>` - Function to sync cloud workspace repos (with toast notifications)

#### 2. useSyncCloudWorkspace Hook (`apps/client/src/hooks/useSyncCloudWorkspace.ts`)

New hook that wraps the socket event for syncing cloud workspaces:

```typescript
const { sync } = useSyncCloudWorkspace(taskRunId, teamSlugOrId);
await sync(); // Re-runs hydration on the Morph instance
```

#### 3. OpenWithDropdown Component (`apps/client/src/components/OpenWithDropdown.tsx`)

**New Props:**
- `cloudWorkspaceRoot?: string | null`
- `selectedRepos?: string[] | null`
- `onSyncCloudWorkspace?: (() => Promise<void>) | null`

**New UI:**
- "Sync repos" menu item with RefreshCw icon (only shown when `onSyncCloudWorkspace` is provided)

#### 4. Component Integration

Updated these components to pass cloud workspace parameters:
- `TaskTree.tsx` - Task run tree component
- `dashboard/TaskItem.tsx` - Dashboard task item component

Both now:
1. Detect if run is a cloud workspace (`run.vscode?.provider === "morph"`)
2. Extract `selectedRepos` from environment if available
3. Create sync callback using `useSyncCloudWorkspace`
4. Pass all parameters to `useOpenWithActions` and `OpenWithDropdown`

### Backend Changes

#### 1. Socket Schemas (`packages/shared/src/socket-schemas.ts`)

New schemas:
```typescript
export const SyncCloudWorkspaceSchema = z.object({
  taskRunId: typedZid("taskRuns"),
  teamSlugOrId: z.string(),
});

export const SyncCloudWorkspaceResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
```

#### 2. Socket Handler (`apps/server/src/socket-handlers.ts`)

New `sync-cloud-workspace` event handler that:
1. Validates the task run exists and is a cloud workspace (Morph provider)
2. Gets the Morph instance using the container name
3. Reads the `hydrateRepoScript.ts` 
4. Determines hydration mode:
   - **Single repo**: Sets env vars for owner/repo/cloneUrl/branch
   - **Multi-repo (environment)**: No clone URL (triggers subdirectory pull)
5. Executes the hydrate script on the Morph instance
6. Returns success/error response

**Key Logic:**
```typescript
// Single repo case
if (task.projectFullName) {
  const [owner, repo] = task.projectFullName.split("/");
  envVars.CMUX_OWNER = owner;
  envVars.CMUX_REPO = repo;
  envVars.CMUX_CLONE_URL = cloneUrl;
  envVars.CMUX_BASE_BRANCH = task.baseBranch || "main";
}

// Multi-repo case (environment with selectedRepos)
// No clone URL set -> hydrateRepoScript runs hydrateSubdirectories()
```

## Edge Cases Handled

### 1. Repository Doesn't Exist Yet
**Scenario**: User clicks "Sync repos" but the repo hasn't been cloned

**Handling**: The `hydrateRepoScript.ts` checks if the repo exists:
- If not: Clones the repository
- If yes: Fetches and pulls updates

**Code**: See `hydrateRepoScript.ts` lines 96-132 (`checkExistingRepo`)

### 2. Wrong Repository in Workspace
**Scenario**: `/root/workspace` contains a different repo than expected

**Handling**: The hydrate script detects remote URL mismatch and clears the workspace:
```typescript
if (owner && repo && !trimmedRemoteUrl.includes(`${owner}/${repo}`)) {
  return { needsClear: true };
}
```

**Code**: See `hydrateRepoScript.ts` lines 126-128

### 3. Multiple Repos (Environment)
**Scenario**: Environment has `selectedRepos: ["org/repo1", "org/repo2"]`

**Handling**: 
- Workspace opens to `/root/workspace` (root folder showing all repo subdirectories)
- Sync runs `hydrateSubdirectories()` which:
  - Finds all subdirectories under `/root/workspace`
  - For each with a `.git` folder: runs `git pull --ff-only`

**Code**: See `hydrateRepoScript.ts` lines 223-241 and `sandboxes.route.ts` line 310-327

### 4. Git Pull Conflicts
**Scenario**: Repository has uncommitted changes or diverged from remote

**Handling**: 
- Uses `git pull --ff-only` to avoid merge commits
- If pull fails, logs error but doesn't crash
- User sees toast notification with error message
- Can manually resolve or re-run sync

**Code**: See `hydrateRepoScript.ts` lines 193-202

### 5. Non-Fast-Forward Updates
**Scenario**: Local branch has diverged from remote

**Handling**:
- Pull with `--ff-only` fails gracefully
- Error message surfaced to user via toast
- Future enhancement: Add "force rehydrate" option to clear and re-clone

### 6. Instance Not Found / Stopped
**Scenario**: User tries to sync but Morph instance is stopped or doesn't exist

**Handling**:
- Socket handler checks `instance = await client.instances.get(containerName)`
- Returns error: "Morph instance not found"
- Toast shows error to user

**Code**: See `socket-handlers.ts` line 1466

### 7. Missing Container Name
**Scenario**: Task run doesn't have `vscode.containerName` stored

**Handling**:
- Returns error: "Container name not found"
- This shouldn't happen for properly created cloud workspaces

**Code**: See `socket-handlers.ts` line 1455

### 8. GitHub Token Issues
**Scenario**: GitHub token expired or not available

**Handling**:
- `getGitHubTokenFromKeychain` throws error
- Caught by try/catch in socket handler
- Error message returned to client
- User sees toast notification

**Code**: See `socket-handlers.ts` line 1502

## User Experience

### Opening Cloud Workspace

1. User clicks "Open with" dropdown on a cloud task run
2. Sees "VS Code (web)" option
3. Clicks it → Opens VS Code web at `/root/workspace`
   - Single repo: Repository files directly visible
   - Multi-repo: Multiple repository folders visible

### Syncing Repos

1. User clicks "Open with" dropdown
2. Sees new "Sync repos" option (with refresh icon)
3. Clicks it:
   - Toast: "Syncing repos..."
   - Backend runs hydration script
   - On success: Toast "Repos synced"
   - On error: Toast with error message

## Performance Considerations

- **No auto-sync on open**: Keeps "Open with" fast and predictable
- **Separate sync action**: User controls when to sync (avoids slow opens)
- **Background execution**: Sync runs asynchronously, user can continue working
- **Toast notifications**: Clear feedback without blocking UI

## Future Enhancements

### 1. Per-Repo Open
For multi-repo environments, add dropdown options:
```
- VS Code (web) - Open root
- VS Code (web) - owner/repo1
- VS Code (web) - owner/repo2
```

Implementation: Server-side directory enumeration + multiple actions in hook

### 2. Force Rehydrate
Add "Force sync (clear & re-clone)" option for handling diverged/corrupted repos

### 3. Multi-Root Workspace
Generate `.code-workspace` file listing all repos:
```json
{
  "folders": [
    { "path": "/root/workspace/repo1" },
    { "path": "/root/workspace/repo2" }
  ]
}
```

Then open with `?workspace=/root/workspace/cmux.code-workspace`

### 4. Sync Status Indicator
Show last sync time and repo status in the UI

### 5. Selective Repo Sync
For environments with many repos, allow syncing individual repos

## Testing

### Manual Testing Checklist

- [ ] Single repo cloud task - Open in VS Code web
- [ ] Single repo cloud task - Sync repos
- [ ] Environment with multiple repos - Open in VS Code web  
- [ ] Environment with multiple repos - Sync repos
- [ ] Sync with uncommitted changes (should show error)
- [ ] Sync with stopped instance (should show error)
- [ ] Sync with wrong repo in workspace (should clear & re-clone)
- [ ] Open with existing query params in vscodeUrl (should preserve them)

### Automated Testing
(Future work - add integration tests)

## Migration Notes

- **No breaking changes**: All new parameters are optional
- **Backwards compatible**: Falls back to `/root/workspace` if no cloudWorkspaceRoot provided
- **Existing workspaces**: Will work without changes, just won't have sync functionality until re-opened

## Troubleshooting

### "Container name not found" error
**Cause**: Task run missing `vscode.containerName`
**Fix**: Restart the cloud workspace

### "Morph instance not found" error  
**Cause**: Instance was stopped or deleted
**Fix**: Create a new cloud workspace for the task

### "Failed to sync repos" error
**Cause**: Various (git errors, permissions, network)
**Fix**: Check logs in `logs/server.log` for detailed error message

### Sync button not appearing
**Cause**: Not a cloud workspace (Morph provider)
**Check**: `run.vscode?.provider === "morph"`

## Related Files

### Frontend
- `apps/client/src/hooks/useOpenWithActions.ts` - Main hook
- `apps/client/src/hooks/useSyncCloudWorkspace.ts` - Sync hook
- `apps/client/src/components/OpenWithDropdown.tsx` - Dropdown UI
- `apps/client/src/components/TaskTree.tsx` - Task tree integration
- `apps/client/src/components/dashboard/TaskItem.tsx` - Dashboard integration

### Backend
- `apps/server/src/socket-handlers.ts` - Sync event handler
- `apps/www/lib/routes/sandboxes/hydrateRepoScript.ts` - Repo hydration logic
- `packages/shared/src/socket-schemas.ts` - Socket event schemas

### Documentation
- This file: `CLOUD_WORKSPACE_OPEN_WITH.md`
