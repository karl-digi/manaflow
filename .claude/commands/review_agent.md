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

### Codex review output (mandatory)
!`cd "$CLAUDE_PROJECT_DIR" && script -q /dev/null codex --dangerously-bypass-approvals-and-sandbox --model gpt-5.2-codex -c model_reasoning_effort="high" -c model_reasoning_summary="concise" review --base main 2>&1 | sed 's/\x1b\[[0-9;]*m//g' || true`

### Divergence vs upstream/main
!`cd "$CLAUDE_PROJECT_DIR" && git fetch origin --prune >/dev/null 2>&1 && git fetch upstream --prune >/dev/null 2>&1 && git rev-list --left-right --count main...upstream/main | awk '{print "ahead=" $1 " behind=" $2}'`

### Upstream commits behind (latest 120)
!`cd "$CLAUDE_PROJECT_DIR" && git log --no-merges --date=short --pretty=format:'%h %ad %s' main..upstream/main | head -120`

### Current branch changed files
!`cd "$CLAUDE_PROJECT_DIR" && git diff --name-only main...HEAD`

### Upstream commits touching changed files (latest 120)
!`cd "$CLAUDE_PROJECT_DIR" && CHANGED_FILES=$(git diff --name-only main...HEAD); if [ -n "$CHANGED_FILES" ]; then git log --no-merges --date=short --pretty=format:'%h %ad %s' main..upstream/main -- $CHANGED_FILES | head -120; else echo "(none)"; fi`

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

### Already Fixed Upstream?
- For each finding, map to matching commit(s) from `main..upstream/main` when applicable.
- Include commit hash and rationale for each mapping.

### Best Recommendation
- Choose one for each finding:
  - `cherry-pick upstream commit`
  - `manual backport`
  - `fix locally first`

### Gap Reduction Plan
- Provide concrete steps to reduce drift vs `manaflow-ai/manaflow:main`:
  - quick wins (safe cherry-picks now)
