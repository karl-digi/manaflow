---
description: Codex-backed review with upstream gap analysis against manaflow-ai/manaflow:main
argument-hint: [optional focus]
allowed-tools: Bash, Read, Grep
---

Run a mandatory Codex-backed review for the current branch.
Do not replace Codex output with manual-only review.

Read review policy first: @REVIEW.md
User focus (optional): $ARGUMENTS

## Auto-collected context

### Codex review (mandatory - run via Bash tool with background polling)

You MUST run these codex reviews. Do NOT skip this step.

**Step 1 - Committed changes:**
1. Run in background: `.claude/scripts/codex-review-extract.sh --base main` using Bash with `run_in_background: true`
2. Use TaskOutput with `block: true, timeout: 300000` (5 minutes) to wait for completion
3. If timeout occurs, use TaskStop to kill the task and report timeout

**Step 2 - Uncommitted changes:**
1. First check `git status --porcelain`. If empty, skip this step.
2. If non-empty, run `.claude/scripts/codex-review-extract.sh --uncommitted` same way as Step 1

### Current branch changed files
!`cd "$CLAUDE_PROJECT_DIR" && git diff --name-only main...HEAD`

### Upstream gap analysis (if upstream remote exists)
!`cd "$CLAUDE_PROJECT_DIR" && if git remote get-url upstream >/dev/null 2>&1; then git fetch origin --prune >/dev/null 2>&1 && git fetch upstream --prune >/dev/null 2>&1 && echo "Divergence vs upstream/main:" && git rev-list --left-right --count main...upstream/main | awk '{print "ahead=" $1 " behind=" $2}' && echo "" && echo "Upstream commits behind (latest 120):" && git log --no-merges --date=short --pretty=format:'%h %ad %s' main..upstream/main | head -120; else echo "(upstream remote not configured - skipping gap analysis)"; fi`

### Upstream commits touching changed files (if upstream exists)
!`cd "$CLAUDE_PROJECT_DIR" && if git remote get-url upstream >/dev/null 2>&1; then CHANGED_FILES=$(git diff --name-only main...HEAD); if [ -n "$CHANGED_FILES" ]; then git log --no-merges --date=short --pretty=format:'%h %ad %s' main..upstream/main -- $CHANGED_FILES | head -120; else echo "(none)"; fi; else echo "(upstream remote not configured - skipping)"; fi`

## Output requirements

1. First line must be exactly one of:
- `Codex review executed: yes`
- `Codex review executed: no`

2. If Codex output is missing/empty or clearly failed (for example timeout, command-not-found, permission denied):
- set first line to `Codex review executed: no`
- output only a short `Blocker` section with the exact failed command and reason
- stop; do not produce findings from manual review

3. If Codex output exists:
- set first line to `Codex review executed: yes`
- produce this report:

### Findings
- Prioritize Codex findings by severity with file/line and fix recommendation.

### Already Fixed Upstream? (skip if no upstream)
- For each finding, map to matching commit(s) from `main..upstream/main` when applicable.
- Include commit hash and rationale for each mapping.

### Best Recommendation
- Choose one for each finding:
  - `cherry-pick upstream commit` (if upstream exists)
  - `manual backport` (if upstream exists)
  - `fix locally first`

### Gap Reduction Plan (skip if no upstream)
- Provide concrete steps to reduce drift vs `manaflow-ai/manaflow:main`:
  - quick wins (safe cherry-picks now)
