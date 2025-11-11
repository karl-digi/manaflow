# Local Repository Support Implementation

This document describes the implementation of local file path support for the "Search or paste a repo link..." input field.

## Overview

Users can now type or paste local file system paths (in addition to GitHub URLs) to use local git repositories in cmux. The implementation includes:

1. **Path Detection & Validation** - Automatically detects file paths vs GitHub URLs
2. **Directory Autocomplete** - Real-time directory suggestions as users type
3. **Tilde (~) Expansion** - Properly resolves `~` to the user's HOME directory
4. **Git Archive Integration** - Uses `git archive` to create clean copies of repos
5. **Cloud & Local Mode Support** - Local repos work in both modes

## Key Features

### 1. Directory Autocomplete

As users type a path, the system provides real-time directory suggestions:

- Shows subdirectories of the current path
- Filters by the typed prefix
- Displays full paths with `~` substitution for brevity
- Keyboard navigation (arrows, tab, enter, escape)
- Limited to 20 suggestions for performance

### 2. Path Resolution

The system properly handles:
- Absolute paths: `/absolute/path/to/repo`
- Home directory: `~/my-projects/repo`
- Relative paths: `./repo` or `../sibling-repo`

### 3. Validation

Before accepting a local path, the system validates:
- Path exists and is a directory
- Directory contains a `.git` subdirectory (is a git repo)
- Path is accessible to the current user

### 4. Git Archive

For local repos, the system uses `git archive` instead of `git clone`:
- Creates a tarball of the repo at the specified branch
- Excludes `.git` directory (reduces size)
- Respects `.gitattributes` `export-ignore` directives
- Extracts to a temporary working directory
- Cleans up archive file after extraction

## Implementation Details

### Backend (Server)

#### New Files:
- **`packages/shared/src/utils/parse-local-repo-path.ts`** - Utility functions for parsing and resolving local paths
- **`apps/server/src/localRepoArchiver.ts`** - Git archive implementation for local repos

#### Socket Handlers (socket-handlers.ts):
- **`get-directory-suggestions`** - Returns directory suggestions for a partial path
- **`validate-local-repo`** - Validates a local path is a git repository

#### Key Functions:
```typescript
// Get directory suggestions as user types
socket.on("get-directory-suggestions", async (data, callback) => {
  // Resolves ~ to HOME, reads directory, filters, returns suggestions
});

// Validate that a path is a valid git repo
socket.on("validate-local-repo", async (data, callback) => {
  // Checks path exists, is directory, has .git subdirectory
});

// Archive and extract local repo
export async function archiveLocalRepo(options: ArchiveLocalRepoOptions): Promise<ArchiveLocalRepoResult> {
  // Uses git archive to create tarball, extracts to target directory
}
```

### Frontend (Client)

#### New Components:
- **`apps/client/src/components/ui/directory-autocomplete-input.tsx`** - Autocomplete input with directory suggestions

#### Modified Components:
- **`apps/client/src/components/dashboard/DashboardInputControls.tsx`** - Added local path support
- **`apps/client/src/components/ui/searchable-select.tsx`** - Updated placeholder text

#### Key Changes:
```typescript
// Detect if input is a file path
const isFilePath = trimmedUrl.startsWith('/') ||
                   trimmedUrl.startsWith('~') ||
                   trimmedUrl.startsWith('./') ||
                   trimmedUrl.startsWith('../');

// Validate and add local repo
if (isFilePath) {
  socket.emit("validate-local-repo", { localPath: trimmedUrl }, (response) => {
    if (response.success && response.isValid) {
      // Use special format: "local://<absolute-path>"
      const localRepoId = `local://${response.resolvedPath}`;
      onProjectChange([localRepoId]);
    }
  });
}
```

## Usage Examples

### Adding a Local Repository

1. Click "Import repos from link" button
2. Type or paste a local path:
   - `~/my-projects/my-app`
   - `/Users/username/code/my-app`
   - `./my-local-repo`
3. Select from autocomplete suggestions or press Enter
4. System validates the path and adds it to the project list

### Autocomplete Interaction

- **Type path**: Suggestions appear automatically
- **Arrow keys**: Navigate through suggestions
- **Tab**: Accept current suggestion
- **Enter**: Accept current suggestion or submit if none selected
- **Escape**: Close suggestions dropdown

## Local Repo Format

Local repositories are stored with a special identifier:
```
local://<absolute-resolved-path>
```

Example:
```
local:///Users/john/projects/my-app
```

This format allows the system to distinguish between:
- GitHub repos: `owner/repo` or full GitHub URLs
- Local repos: `local://...` prefix
- Environments: `env:...` prefix

## Cloud vs Local Mode

Local file paths work with both execution modes:

### Cloud Mode
- Local repo is archived using `git archive`
- Archive is uploaded to cloud provider
- Cloud container extracts and runs the code

### Local Mode
- Local repo is archived using `git archive`
- Archive is extracted to local Docker volume
- Local Docker container runs the code

Both modes use the same archive mechanism, ensuring consistency.

## Future Enhancements

Possible improvements for future iterations:

1. **Recent paths** - Show recently used local paths
2. **Favorites** - Allow users to bookmark frequently used local repos
3. **Hidden directory support** - Allow showing/filtering hidden directories
4. **Symlink resolution** - Better handling of symbolic links
5. **Permission handling** - Better error messages for permission issues
6. **Multi-user home** - Support for `~username/` style paths
7. **Watch mode** - Real-time sync of local changes to running container
8. **Git worktree support** - Support for git worktrees

## Security Considerations

The implementation includes several security measures:

1. **Path validation** - Only accepts paths that exist and contain `.git`
2. **No arbitrary file access** - Only directories, not individual files
3. **Hidden directories filtered** - `.` prefixed directories hidden by default
4. **Server-side validation** - All path resolution happens server-side
5. **Limited suggestions** - Maximum 20 suggestions to prevent DoS

## Testing

To test the implementation:

1. Start the dev server: `./scripts/dev.sh`
2. Navigate to the dashboard
3. Click "Import repos from link"
4. Try typing:
   - `~` - Should show your home directory subdirectories
   - `~/` - Same as above
   - `/` - Should show root directory (if permissions allow)
   - Start typing a partial path and verify autocomplete works
5. Select a valid git repository and verify it's added
6. Try an invalid path (non-git directory) and verify error message

## Known Limitations

1. **No SSH/Remote paths** - Only local filesystem paths are supported
2. **No network mounts** - Network-mounted directories may have issues
3. **Case sensitivity** - Path matching respects OS filesystem case sensitivity
4. **Performance** - Very large directories (1000+ subdirectories) may be slow
5. **Permissions** - User must have read permissions on all parent directories

## Troubleshooting

### "Not a git repository" error
- Ensure the directory contains a `.git` subdirectory
- Run `git status` in the directory to verify it's a valid git repo

### "Directory does not exist" error
- Check the path for typos
- Ensure you have read permissions on the directory
- Try using an absolute path instead of relative

### Autocomplete not showing
- Make sure you're connected to the server
- Check that the path starts with `/`, `~`, `./`, or `../`
- Verify the parent directory exists and is readable

### Tilde (~) not expanding
- Tilde expansion only works for current user: `~/path`
- Other user expansion (`~username/`) is not currently supported
