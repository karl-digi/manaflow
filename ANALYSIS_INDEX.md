# "Search or paste a repo link..." Feature - Analysis Index

## Document Overview

This analysis provides a comprehensive breakdown of the "Search or paste a repo link..." feature implemented in the cmux codebase. The feature allows users to manually add public GitHub repositories to their project list.

## Generated Documents

### 1. Main Analysis Document
**File:** `/root/workspace/REPO_LINK_FEATURE_ANALYSIS.md` (18 KB)

**Contents:**
- Detailed breakdown of each component
- Full code snippets with line numbers
- Data flow diagrams and sequences
- Database schema documentation
- Query reference examples
- File paths and locations
- Limitations and enhancement opportunities

**Best for:** Deep understanding, code review, architectural analysis

### 2. Summary Document
**File:** `/root/workspace/REPO_LINK_FEATURE_SUMMARY.txt` (12 KB)

**Contents:**
- Quick start checklist
- Supported URL formats
- Validation layers
- GitHub API integration details
- Database schema overview
- Error messages and user experience
- Current limitations
- Dependencies list
- File and line numbers reference
- Data persistence strategies
- Enhancement roadmap

**Best for:** Quick reference, onboarding, getting oriented

## Key Findings

### Feature Architecture

The feature is implemented across three layers:

1. **Frontend** - React components for user input
   - Searchable dropdown with paste detection
   - Dashboard controls with custom input form
   - Route handler for state management

2. **Backend** - Convex actions and mutations
   - `addManualRepo` action orchestrates validation
   - GitHub API integration for repo verification
   - Database mutations for persistence

3. **Database** - Convex managed database
   - `repos` table with `manual` flag
   - `gitRemote` field for git operations
   - Indexes for efficient querying

### Supported URL Formats

Three formats are accepted:
1. `owner/repo` (simple)
2. `https://github.com/owner/repo` (HTTPS)
3. `git@github.com:owner/repo.git` (SSH)

### Key Information

- **Public repos only** - Private repos are rejected by GitHub API validation
- **No git archive** - Current codebase has no tar/zip export capability
- **No local repo support** - Cannot add file:// paths or local cloned repos
- **Duplicate prevention** - Repos are identified by team + fullName
- **Manual flag** - Distinguishes user-added repos from GitHub App repos

## File Locations

### Frontend Components (3 files)
1. `/root/workspace/apps/client/src/components/ui/searchable-select.tsx`
   - SearchableSelect component with paste handler

2. `/root/workspace/apps/client/src/components/dashboard/DashboardInputControls.tsx`
   - Dashboard integration and form handling

3. `/root/workspace/apps/client/src/routes/_layout.$teamSlugOrId.dashboard.tsx`
   - Route handler and paste callback

### Backend Components (2 files)
4. `/root/workspace/packages/convex/convex/github_http.ts`
   - `addManualRepo` action

5. `/root/workspace/packages/convex/convex/github.ts`
   - `insertManualRepoInternal` and `getRepoByFullNameInternal`

### Utilities (1 file)
6. `/root/workspace/packages/shared/src/utils/parse-github-repo-url.ts`
   - URL parsing and validation

### Database (1 file)
7. `/root/workspace/packages/convex/convex/schema.ts`
   - `repos` table schema

### Supporting Files (3 files)
8. `/root/workspace/packages/cmux/src/utils/gitUtils.ts`
   - Git repository utilities

9. `/root/workspace/apps/server/src/repositoryManager.ts`
   - Repository cloning and git operations

10. `/root/workspace/apps/server/src/archiveTask.ts`
    - Task archiving (no git archive capability)

## Data Flow Summary

```
User pastes URL
    ↓
Frontend (SearchableSelect) detects paste
    ↓
onSearchPaste callback triggered (handleProjectSearchPaste)
    ↓
Backend action (addManualRepo) called
    ↓
URL parsed and validated
    ↓
GitHub API validates repo is public
    ↓
Check for duplicates
    ↓
Insert/update database record with manual: true
    ↓
Frontend refetches repos
    ↓
Success toast and auto-selection
    ↓
Dropdown closes
```

## Error Handling Strategy

- **Validation errors** (Invalid URL): Silent, keeps dropdown open
- **Public/private errors**: User-friendly error message in form
- **Other errors**: Toast notification shown
- **Network errors**: Caught and logged

## Current Limitations

1. **Public repositories only** - No private repo support
2. **GitHub only** - No other providers (GitLab, Bitbucket, etc.)
3. **No local repo support** - Cannot add file:// paths
4. **No git archive** - No tar/zip export functionality
5. **No streaming** - Full repository must be processed at once

## Enhancement Opportunities

To support local repositories with git archive:

1. Extend URL parsing for file:// paths
2. Add `localPath` and `isLocal` fields to repos schema
3. Implement git archive command in RepositoryManager
4. Support tar, tar.gz, and zip formats
5. Add frontend UI for file picker and format selection

## Quick Reference

### GitHub API Call
- Uses Octokit without authentication
- Validates repo exists and is public
- Fetches owner login, default branch, and metadata
- Returns 404 for non-existent or private repos

### Database Query for Manual Repos
```typescript
const manualRepos = await ctx.db
  .query("repos")
  .withIndex("by_team_user", (q) =>
    q.eq("teamId", teamId).eq("userId", userId)
  )
  .filter((q) => q.eq(q.field("manual"), true))
  .collect();
```

### Key Fields in repos Table
- `gitRemote`: "https://github.com/owner/repo.git" (used for cloning)
- `manual`: true (distinguishes manual repos)
- `visibility`: "public" (always for manual repos)

## Dependencies

### Frontend
- React (hooks)
- TanStack Router & Query
- Convex (api.github_http.addManualRepo)
- sonner (toast notifications)
- @cmux/shared (parseGithubRepoUrl)

### Backend
- Convex (database, auth)
- Octokit (GitHub API client)
- @cmux/shared (parseGithubRepoUrl)

## Next Steps

1. Review `REPO_LINK_FEATURE_ANALYSIS.md` for detailed implementation
2. Check `REPO_LINK_FEATURE_SUMMARY.txt` for quick reference
3. Examine specific files based on your needs
4. Refer to absolute paths for file locations

## Document Generation

- **Date:** 2025-11-11
- **Analysis Level:** Comprehensive
- **Files Analyzed:** 10
- **Total Documentation:** ~30 KB

---

For questions or clarifications, refer to the detailed analysis documents or the specific source files listed above.
