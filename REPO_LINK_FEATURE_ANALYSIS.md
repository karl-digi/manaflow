# "Search or paste a repo link..." Feature - Comprehensive Analysis

## Overview
The "Search or paste a repo link..." feature allows users to manually add public GitHub repositories to their project list by pasting a repository URL or link. The feature consists of frontend UI components, a backend action handler, URL parsing utilities, and database operations.

---

## 1. Frontend Input Component

### Location
**File:** `/root/workspace/apps/client/src/components/ui/searchable-select.tsx`

### Key Implementation Details

#### SearchableSelect Component (Lines 228-761)
- **Type:** React forwardRef component with generic searchable dropdown
- **Placeholder Message:** Line 588 - `"Search or paste a repo link..."` (shown when `onSearchPaste` prop is provided)
- **Props Interface:**
  - `onSearchPaste?: (value: string) => boolean | Promise<boolean>` - Callback for handling pasted content
  - `placeholder?: string` - Custom placeholder text
  - Other props: options, value, onChange, singleSelect, loading, etc.

#### Paste Handler Implementation (Lines 597-615)
```typescript
onPaste={async (event) => {
  if (!onSearchPaste) {
    return;
  }
  const pasted = event.clipboardData?.getData("text/plain") ?? "";
  const trimmed = pasted.trim();
  if (!trimmed) {
    return;
  }
  try {
    const handled = await onSearchPaste(trimmed);
    if (handled) {
      setSearch("");
      setOpen(false);
    }
  } catch (error) {
    console.error("Failed to handle search paste:", error);
  }
}}
```

**Behavior:**
1. Intercepts paste events via `onPaste` handler
2. Extracts plain text from clipboard
3. Calls the `onSearchPaste` callback asynchronously
4. On success (true returned): clears search field and closes dropdown
5. On failure (false returned): keeps dropdown open, allowing user to retry
6. Errors are logged but don't prevent further interaction

---

## 2. Dashboard Input Controls Component

### Location
**File:** `/root/workspace/apps/client/src/components/dashboard/DashboardInputControls.tsx`

### Integration
- **Lines 5-9:** Imports SearchableSelect and SelectOption types
- **Line 77:** Uses Convex action: `const addManualRepo = useAction(api.github_http.addManualRepo);`
- **Lines 301-344:** Handler for custom repo submission

#### Custom Repo Input State (Lines 229-233)
```typescript
const [showCustomRepoInput, setShowCustomRepoInput] = useState(false);
const [customRepoUrl, setCustomRepoUrl] = useState("");
const [customRepoError, setCustomRepoError] = useState<string | null>(null);
const [isAddingRepo, setIsAddingRepo] = useState(false);
```

#### URL Parsing & Validation (Lines 310-314)
```typescript
const parsed = parseGithubRepoUrl(trimmedUrl);
if (!parsed) {
  setCustomRepoError("Invalid GitHub repository URL. Use format: owner/repo or https://github.com/owner/repo");
  return;
}
```
- Uses shared utility `parseGithubRepoUrl()` for URL validation
- Supports multiple formats (see parsing utility section below)

#### Repository Addition Handler (Lines 320-344)
```typescript
try {
  const result = await addManualRepo({
    teamSlugOrId,
    repoUrl: trimmedUrl,
  });

  if (result.success) {
    onProjectChange([result.fullName]);
    setCustomRepoUrl("");
    setCustomRepoError(null);
    setShowCustomRepoInput(false);
    toast.success(`Added ${result.fullName} to repositories`);
  }
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : "Failed to add repository";
  setCustomRepoError(errorMessage);
  toast.error(errorMessage);
}
```

#### Footer Menu Integration (Lines 503-628)
- Provides footer in project selector with actions:
  - "Create environment"
  - "Add repos from GitHub" (if GitHub app configured)
  - "Import repos from link" (toggles custom input form)
  
- Custom input form includes:
  - Text input field with placeholder `"github.com/owner/repo"`
  - Submit button with loading state
  - Error message display
  - Help text: "Enter any GitHub repository link"

#### SearchableSelect Integration (Lines 492-497)
```typescript
<SearchableSelect
  options={projectOptions}
  value={selectedProject}
  onChange={onProjectChange}
  onSearchPaste={onProjectSearchPaste}  // <-- Passed to component
  placeholder="Select project"
  singleSelect={true}
  // ...
/>
```

---

## 3. Dashboard Route Component

### Location
**File:** `/root/workspace/apps/client/src/routes/_layout.$teamSlugOrId.dashboard.tsx`

### Key Implementation (Lines 681-710)

#### handleProjectSearchPaste Callback
```typescript
const handleProjectSearchPaste = useCallback(
  async (input: string) => {
    try {
      const result = await addManualRepo({
        teamSlugOrId,
        repoUrl: input,
      });

      if (result.success) {
        // Refetch repos to get the newly added one
        await reposByOrgQuery.refetch();

        // Select the newly added repo
        setSelectedProject([result.fullName]);
        localStorage.setItem(
          `selectedProject-${teamSlugOrId}`,
          JSON.stringify([result.fullName])
        );

        toast.success(`Added ${result.fullName} to repositories`);
        return true;
      }

      return false;
    } catch (error) {
      // Only show error toast for non-validation errors
      if (
        error instanceof Error &&
        error.message &&
        !error.message.includes("Invalid GitHub")
      ) {
        toast.error(error.message);
      }
      return false; // Don't close dropdown if invalid URL
    }
  },
  [addManualRepo, teamSlugOrId, reposByOrgQuery]
);
```

**Behavior:**
1. Calls backend `addManualRepo` action
2. On success: refetches repo list, selects new repo, saves to localStorage, shows success toast
3. Validation errors are silently ignored (dropdown stays open)
4. Other errors show toast notification
5. Returns boolean for dropdown state management

---

## 4. URL Parsing Utility

### Location
**File:** `/root/workspace/packages/shared/src/utils/parse-github-repo-url.ts`

### Supported Formats (Lines 25-31)
The parser supports three formats:
1. **Simple format:** `owner/repo`
2. **HTTPS format:** `https://github.com/owner/repo` or `https://github.com/owner/repo.git`
3. **SSH format:** `git@github.com:owner/repo.git`

### Implementation Details (Lines 11-51)
```typescript
export function parseGithubRepoUrl(input: string): {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
  gitUrl: string;
} | null {
  // Regex patterns for different formats
  const simpleMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
  const httpsMatch = trimmed.match(
    /^https?:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:\/)?$/i
  );
  const sshMatch = trimmed.match(
    /^git@github\.com:([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/i
  );

  const match = simpleMatch || httpsMatch || sshMatch;
  if (!match) return null;

  const [, owner, repo] = match;
  
  // Returns object with parsed components
  return {
    owner,
    repo: cleanRepo,
    fullName: `${owner}/${cleanRepo}`,
    url: `https://github.com/${owner}/${cleanRepo}`,
    gitUrl: `https://github.com/${owner}/${cleanRepo}.git`,
  };
}
```

**Returns:**
- Object with keys: `owner`, `repo`, `fullName`, `url`, `gitUrl`
- `null` if URL doesn't match any supported format

---

## 5. Backend Action Handler

### Location
**File:** `/root/workspace/packages/convex/convex/github_http.ts`

### addManualRepo Action (Lines 10-99)

#### Arguments (Lines 11-14)
```typescript
args: {
  teamSlugOrId: v.string(),
  repoUrl: v.string(),
}
```

#### Handler Flow

**1. Parse URL (Lines 17-20)**
```typescript
const parsed = parseGithubRepoUrl(repoUrl);
if (!parsed) {
  throw new Error("Invalid GitHub repository URL");
}
```

**2. Validate Repository is Public (Lines 24-39)**
```typescript
const octokit = new Octokit({
  userAgent: "cmux",
  request: { timeout: 10_000 },
});

const { data } = await octokit.rest.repos.get({
  owner: parsed.owner,
  repo: parsed.repo,
});

if (data.private) {
  throw new Error("Private repositories are not supported for manual addition");
}
```
- Uses Octokit (GitHub API client) WITHOUT authentication (public repos only)
- Fetches repo metadata to verify it exists and is public
- Returns 404 if repo doesn't exist or is private

**3. Verify Authentication & Team Access (Lines 42-48)**
```typescript
const identity = await ctx.auth.getUserIdentity();
if (!identity) {
  throw new Error("Not authenticated");
}

// Verify team access
await ctx.runQuery(api.github.hasReposForTeam, { teamSlugOrId });
```

**4. Check for Existing Repository (Lines 50-58)**
```typescript
const existing = await ctx.runQuery(
  internal.github.getRepoByFullNameInternal,
  {
    teamSlugOrId,
    fullName: parsed.fullName,
  }
);

if (existing) {
  return { success: true, repoId: existing._id, fullName: parsed.fullName };
}
```
- Prevents duplicates
- Returns early if repo already added

**5. Validate Owner Type (Lines 60-64)**
```typescript
const ownerType = data.owner.type;
if (ownerType !== "User" && ownerType !== "Organization") {
  throw new Error(`Invalid owner type: ${data.owner.type}`);
}
```

**6. Insert Manual Repository (Lines 67-79)**
```typescript
const repoId = await ctx.runMutation(
  internal.github.insertManualRepoInternal,
  {
    teamSlugOrId,
    userId: identity.subject,
    fullName: parsed.fullName,
    org: parsed.owner,
    name: parsed.repo,
    gitRemote: parsed.gitUrl,
    providerRepoId: data.id,
    ownerLogin: data.owner.login,
    ownerType,
    defaultBranch: data.default_branch,
    lastPushedAt: data.pushed_at ? new Date(data.pushed_at).getTime() : undefined,
  }
);

return { success: true, repoId, fullName: parsed.fullName };
```

#### Error Handling (Lines 82-97)
- GitHub API errors (404, etc.) are caught and converted to user-friendly messages
- "Repository not found or is private" for 404 errors
- Generic "GitHub API error: {status}" for other HTTP errors
- Re-throws Error instances
- Generic "Failed to validate repository" for unknown errors

---

## 6. Backend Mutations

### Location
**File:** `/root/workspace/packages/convex/convex/github.ts`

### insertManualRepoInternal Mutation (Lines 714-776)

#### Arguments (Lines 715-727)
```typescript
args: {
  teamSlugOrId: v.string(),
  userId: v.string(),
  fullName: v.string(),
  org: v.string(),
  name: v.string(),
  gitRemote: v.string(),
  providerRepoId: v.number(),
  ownerLogin: v.string(),
  ownerType: v.union(v.literal("User"), v.literal("Organization")),
  defaultBranch: v.string(),
  lastPushedAt: v.optional(v.number()),
}
```

#### Handler Logic (Lines 728-776)

**1. Get Team ID**
```typescript
const teamId = await getTeamId(ctx, args.teamSlugOrId);
const now = Date.now();
```

**2. Check for Existing Repository**
```typescript
const existing = await ctx.db
  .query("repos")
  .withIndex("by_team_fullName", (q) =>
    q.eq("teamId", teamId).eq("fullName", args.fullName)
  )
  .first();
```

**3. Update or Insert**
- If exists: Updates with new metadata (preserves manual flag)
- If new: Inserts with `manual: true` flag

#### Inserted Fields
```typescript
{
  fullName: args.fullName,
  org: args.org,
  name: args.name,
  gitRemote: args.gitRemote,        // <-- Used for cloning
  provider: "github",
  userId: args.userId,
  teamId,
  providerRepoId: args.providerRepoId,
  ownerLogin: args.ownerLogin,
  ownerType: args.ownerType,
  visibility: "public",
  defaultBranch: args.defaultBranch,
  lastPushedAt: args.lastPushedAt,
  lastSyncedAt: now,
  manual: true,                      // <-- Flag for manual repos
}
```

### getRepoByFullNameInternal Query (Lines 779-793)
- Used to check if repo already exists
- Queries by team and fullName index

---

## 7. Database Schema

### Location
**File:** `/root/workspace/packages/convex/convex/schema.ts`

### Repos Table (Lines 454-482)
```typescript
repos: defineTable({
  fullName: v.string(),              // owner/repo
  org: v.string(),                   // owner name
  name: v.string(),                  // repo name
  gitRemote: v.string(),             // git clone URL
  provider: v.optional(v.string()),  // "github"
  userId: v.string(),
  teamId: v.string(),
  // Provider metadata
  providerRepoId: v.optional(v.number()),
  ownerLogin: v.optional(v.string()),
  ownerType: v.optional(v.union(v.literal("User"), v.literal("Organization"))),
  visibility: v.optional(v.union(v.literal("public"), v.literal("private"))),
  defaultBranch: v.optional(v.string()),
  connectionId: v.optional(v.id("providerConnections")),
  lastSyncedAt: v.optional(v.number()),
  lastPushedAt: v.optional(v.number()),
  // Manual repos flag
  manual: v.optional(v.boolean()),   // <-- Indicates manually added repo
})
  .index("by_org", ["org"])
  .index("by_gitRemote", ["gitRemote"])
  .index("by_team_user", ["teamId", "userId"])
  .index("by_team", ["teamId"])
  .index("by_providerRepoId", ["teamId", "providerRepoId"])
  .index("by_connection", ["connectionId"])
  .index("by_team_fullName", ["teamId", "fullName"])
```

**Key Fields:**
- `gitRemote` - Stores the HTTPS git URL (used for cloning)
- `manual` - Boolean flag distinguishing manually added repos from GitHub App repos
- `visibility` - Always "public" for manually added repos
- `defaultBranch` - Fetched from GitHub API

---

## 8. Current Git Integration

### Git Utilities
**File:** `/root/workspace/packages/cmux/src/utils/gitUtils.ts`

Provides `getGitRepoInfo()` to analyze local git repositories:
- Detects if path is a git repository
- Extracts remote URL
- Gets current and default branch
- Supports various git URL formats (SSH, HTTPS, GitLab, Bitbucket, etc.)

### Repository Manager
**File:** `/root/workspace/apps/server/src/repositoryManager.ts`

Manages git operations:
- Queue-based execution to prevent conflicts
- Supports cloning, worktree creation, pulling
- Uses `git` CLI commands via `execAsync`
- Caches operations for 5 seconds

### Archive Task
**File:** `/root/workspace/apps/server/src/archiveTask.ts`

Current archive functionality:
- Stops Docker containers or Cmux sandboxes
- Cleans up VSCode instances

**NOTE:** No explicit git archive functionality found in current codebase.

---

## 9. Data Flow Summary

```
User pastes URL in SearchableSelect
        ↓
onPaste event triggered
        ↓
onSearchPaste callback invoked (handleProjectSearchPaste)
        ↓
addManualRepo action called with teamSlugOrId + repoUrl
        ↓
Backend: parseGithubRepoUrl() parses URL
        ↓
Backend: Verify repo exists and is public (GitHub API)
        ↓
Backend: Check if already added
        ↓
Backend: insertManualRepoInternal inserts/updates repo in DB
        ↓
Frontend: Refetch repo list
        ↓
Frontend: Select newly added repo
        ↓
Frontend: Show success toast
        ↓
SearchableSelect dropdown closes
```

---

## 10. Existing Limitations & Opportunities

### Current Limitations
1. **Public repositories only** - Private repos are rejected
2. **GitHub only** - No GitLab, Bitbucket, or other providers
3. **No local repo support** - Cannot add file:// or local paths
4. **No git archive** - No built-in tar/zip archiving functionality
5. **No streaming/chunking** - Full repo must be downloaded at once

### Opportunities for Enhancement
1. **Local repository support** - Add ability to work with local cloned repos
2. **Git archive integration** - Support efficient tar/zip exports
3. **Partial clone/sparse checkout** - Download only needed files
4. **Provider support** - Extend to GitLab, Bitbucket, etc.
5. **Private repo support** - Allow authenticated private repos

---

## 11. Files Summary

| File | Purpose | Key Components |
|------|---------|-----------------|
| `/apps/client/src/components/ui/searchable-select.tsx` | Input component | `onPaste` handler, placeholder |
| `/apps/client/src/components/dashboard/DashboardInputControls.tsx` | Dashboard integration | Custom input form, validation |
| `/apps/client/src/routes/_layout.$teamSlugOrId.dashboard.tsx` | Route component | `handleProjectSearchPaste` callback |
| `/packages/shared/src/utils/parse-github-repo-url.ts` | URL parsing | Format validation, component extraction |
| `/packages/convex/convex/github_http.ts` | Backend action | `addManualRepo` - API orchestration |
| `/packages/convex/convex/github.ts` | Database mutations | `insertManualRepoInternal`, `getRepoByFullNameInternal` |
| `/packages/convex/convex/schema.ts` | Database schema | `repos` table with `manual` flag and `gitRemote` field |

---

## 12. Query Reference

### Getting manually added repos
```typescript
const manualRepos = await ctx.db
  .query("repos")
  .withIndex("by_team_user", (q) =>
    q.eq("teamId", teamId).eq("userId", userId)
  )
  .filter((q) => q.eq(q.field("manual"), true))
  .collect();
```

### Getting repo by git remote
```typescript
const repo = await ctx.db
  .query("repos")
  .withIndex("by_gitRemote", (q) => q.eq("gitRemote", gitUrl))
  .first();
```

---

## Absolute File Paths

1. `/root/workspace/apps/client/src/components/ui/searchable-select.tsx`
2. `/root/workspace/apps/client/src/components/dashboard/DashboardInputControls.tsx`
3. `/root/workspace/apps/client/src/routes/_layout.$teamSlugOrId.dashboard.tsx`
4. `/root/workspace/packages/shared/src/utils/parse-github-repo-url.ts`
5. `/root/workspace/packages/convex/convex/github_http.ts`
6. `/root/workspace/packages/convex/convex/github.ts`
7. `/root/workspace/packages/convex/convex/schema.ts`
8. `/root/workspace/packages/cmux/src/utils/gitUtils.ts`
9. `/root/workspace/apps/server/src/repositoryManager.ts`
10. `/root/workspace/apps/server/src/archiveTask.ts`
