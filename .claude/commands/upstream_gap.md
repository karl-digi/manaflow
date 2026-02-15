---
description: Analyze upstream gap and PR #1 conflicts, suggest actions to reduce divergence
argument-hint: [optional: cherry-pick|conflicts|full]
allowed-tools: Bash, Read, Grep, WebFetch
---

Analyze the gap between karlorz/cmux and manaflow-ai/manaflow upstream.
Fetch conflict status from karl-digi/manaflow PR #1 and provide actionable suggestions.

Mode: $ARGUMENTS (default: full)

## Auto-collected context

### PR #1 status and mergability
!`gh pr view 1 --repo karl-digi/manaflow --json title,state,mergeable,mergeStateStatus,url 2>&1`

### PR #1 files with conflicts
!`gh pr view 1 --repo karl-digi/manaflow --json files --jq '.files[] | select(.additions > 0 or .deletions > 0) | .path' 2>&1 | head -50`

### Divergence stats
!`cd "$CLAUDE_PROJECT_DIR" && git fetch origin --prune >/dev/null 2>&1 && git fetch upstream --prune >/dev/null 2>&1 && git rev-list --left-right --count origin/main...upstream/main 2>/dev/null | awk '{print "karlorz/cmux:main is " $1 " commits ahead, " $2 " commits behind upstream"}'`

### Upstream commits we're missing (latest 30)
!`cd "$CLAUDE_PROJECT_DIR" && git log --no-merges --date=short --pretty=format:'%h %ad %-20an %s' origin/main..upstream/main 2>/dev/null | head -30`

### Our commits not in upstream (latest 30)
!`cd "$CLAUDE_PROJECT_DIR" && git log --no-merges --date=short --pretty=format:'%h %ad %-20an %s' upstream/main..origin/main 2>/dev/null | head -30`

### Conflict-prone files (files changed in both directions)
!`cd "$CLAUDE_PROJECT_DIR" && comm -12 <(git diff --name-only upstream/main...origin/main 2>/dev/null | sort) <(git diff --name-only origin/main...upstream/main 2>/dev/null | sort) 2>/dev/null | head -30`

### Safe cherry-pick candidates (upstream commits not touching conflict-prone files)
!`cd "$CLAUDE_PROJECT_DIR" && CONFLICT_FILES=$(comm -12 <(git diff --name-only upstream/main...origin/main 2>/dev/null | sort) <(git diff --name-only origin/main...upstream/main 2>/dev/null | sort) 2>/dev/null); if [ -n "$CONFLICT_FILES" ]; then git log --no-merges --date=short --pretty=format:'%h %ad %s' origin/main..upstream/main 2>/dev/null | while read line; do HASH=$(echo "$line" | cut -d' ' -f1); FILES=$(git diff-tree --no-commit-id --name-only -r "$HASH" 2>/dev/null); SAFE=true; for f in $FILES; do echo "$CONFLICT_FILES" | grep -qx "$f" && SAFE=false && break; done; $SAFE && echo "$line"; done | head -20; else git log --no-merges --date=short --pretty=format:'%h %ad %s' origin/main..upstream/main 2>/dev/null | head -20; fi`

## Output format

### 1. PR #1 Conflict Status
- Current mergability state
- List conflicting files (if any)

### 2. Divergence Summary
| Metric | Count |
|--------|-------|
| Ahead of upstream | X commits |
| Behind upstream | Y commits |
| Conflict-prone files | Z files |

### 3. Upstream Commits We're Missing
Group by category:
- **Features**: New functionality added upstream
- **Fixes**: Bug fixes we should backport
- **Refactors**: Code improvements
- **Chores**: CI, deps, docs

### 4. Safe Cherry-Pick Candidates
Commits that don't touch conflict-prone files - can be cherry-picked without conflicts:
```bash
git cherry-pick <hash>
```

### 5. Conflict Resolution Priority
Rank conflict-prone files by impact:
1. High impact (core functionality, schemas)
2. Medium impact (features, UI)
3. Low impact (scripts, configs, docs)

### 6. Recommended Actions
Concrete steps to reduce the gap:
1. **Immediate**: Safe cherry-picks to run now
2. **This week**: Conflicts to resolve manually
3. **Later**: Low-priority items to defer

### 7. Commands to Execute
Ready-to-run commands:
```bash
# Cherry-pick safe commits
git cherry-pick <hash1> <hash2> ...

# Update PR #1 after resolving conflicts
git push karl-digi <branch>:karlorz-cmux-main --force

# Re-sync after upstream changes
gh repo sync karl-digi/manaflow --source manaflow-ai/manaflow --branch main
```
