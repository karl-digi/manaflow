---
name: vault-repo-review
description: Audit Obsidian vault documentation against actual cmux repo state. Cross-references vault notes with recent commits, open PRs/issues, and file system changes to identify stale documentation, missing coverage, and broken references.
---

# Purpose

Keep Obsidian vault documentation in sync with the cmux repository by:
- Detecting stale notes (marked "Active" but not updated recently)
- Identifying missing documentation for recent features
- Finding broken wiki links and invalid file path references
- Generating actionable review reports

This workflow is agent-agnostic - all commands use standard CLI tools (`git`, `gh`, `rg`, `ls`, `stat`) that any terminal-capable agent can execute.

# Prerequisites

**Paths**:
- Repository: `/Users/karlchow/Desktop/code/cmux/`
- Vault: `/Users/karlchow/Documents/obsidian_vault/5️⃣-Projects/GitHub/cmux/`

**Required CLI tools**:
- `git` - For commit history
- `gh` - For PR/issue queries (must be authenticated)
- `rg` (ripgrep) - For content search
- Standard POSIX: `ls`, `stat`, `find`, `date`

# Phase 1 - Repo Activity Scan

Gather recent repository activity to establish what has changed.

## Recent Commits (30 days)

```bash
cd /Users/karlchow/Desktop/code/cmux
git log --oneline --since="30 days ago" | head -80
```

## Commit Statistics by Area

```bash
cd /Users/karlchow/Desktop/code/cmux
# Count commits by top-level directory
git log --since="30 days ago" --name-only --pretty=format: | \
  grep -v '^$' | \
  cut -d'/' -f1-2 | \
  sort | uniq -c | sort -rn | head -20
```

## Open PRs

```bash
gh pr list --repo karlorz/cmux --state open --json number,title,updatedAt,headRefName --limit 20
```

## Open Issues

```bash
gh issue list --repo karlorz/cmux --state open --json number,title,labels --limit 20
```

## TODO/FIXME Count

```bash
cd /Users/karlchow/Desktop/code/cmux
rg -c "TODO|FIXME" --type ts --type tsx --type go --type rust 2>/dev/null | \
  sort -t: -k2 -rn | head -20
```

# Phase 2 - Vault Inventory

Enumerate all vault notes and their current states.

## List All Notes

```bash
VAULT_DIR="/Users/karlchow/Documents/obsidian_vault/5️⃣-Projects/GitHub/cmux"
find "$VAULT_DIR" -name "*.md" -type f | sort
```

## Parse _Overview.md Status Table

Extract the document-status mapping from the MOC:

```bash
VAULT_DIR="/Users/karlchow/Documents/obsidian_vault/5️⃣-Projects/GitHub/cmux"
# Extract table rows with Document and Status columns
grep -E '^\| \[\[' "$VAULT_DIR/_Overview.md" | \
  sed 's/\[\[//g; s/\]\]//g' | \
  awk -F'|' '{gsub(/^ +| +$/, "", $2); gsub(/^ +| +$/, "", $4); if ($4 != "") print $2 "|" $4}'
```

## Check File Modification Dates

```bash
VAULT_DIR="/Users/karlchow/Documents/obsidian_vault/5️⃣-Projects/GitHub/cmux"
for f in "$VAULT_DIR"/*.md "$VAULT_DIR"/**/*.md; do
  [ -f "$f" ] || continue
  mtime=$(stat -f '%Sm' -t '%Y-%m-%d' "$f" 2>/dev/null || stat -c '%y' "$f" 2>/dev/null | cut -d' ' -f1)
  basename "$f" | sed 's/.md$//'
  echo "  -> $mtime"
done 2>/dev/null | paste - -
```

## Flag Stale "Active" Notes

Notes marked "Active" or "Current" but not modified in 14+ days:

```bash
VAULT_DIR="/Users/karlchow/Documents/obsidian_vault/5️⃣-Projects/GitHub/cmux"
THRESHOLD=$(date -v-14d +%Y%m%d 2>/dev/null || date -d "14 days ago" +%Y%m%d)

find "$VAULT_DIR" -name "*.md" -type f | while read f; do
  mtime=$(stat -f '%Sm' -t '%Y%m%d' "$f" 2>/dev/null || stat -c '%Y%m%d' "$f" 2>/dev/null)
  if [ "$mtime" -lt "$THRESHOLD" ]; then
    # Check if note claims Active/Current status
    if grep -qE 'Status.*Active|Status.*Current|\*\*Active\*\*|\*\*Current\*\*' "$f" 2>/dev/null; then
      echo "STALE: $f (modified: $mtime)"
    fi
  fi
done
```

# Phase 3 - Cross-Reference Alignment

Verify vault note claims match actual repo state.

## Check Referenced PRs

For notes that mention PR numbers, verify their current state:

```bash
VAULT_DIR="/Users/karlchow/Documents/obsidian_vault/5️⃣-Projects/GitHub/cmux"
# Find all PR references in vault notes
rg -o 'PR #?(\d+)|pull/(\d+)' "$VAULT_DIR" --no-filename | \
  grep -oE '[0-9]+' | sort -u | while read pr; do
    state=$(gh pr view "$pr" --repo karlorz/cmux --json state -q '.state' 2>/dev/null || echo "NOT_FOUND")
    echo "PR #$pr: $state"
done
```

## Check Referenced Files Exist

Extract file paths from vault notes and verify they exist in repo:

```bash
VAULT_DIR="/Users/karlchow/Documents/obsidian_vault/5️⃣-Projects/GitHub/cmux"
REPO_DIR="/Users/karlchow/Desktop/code/cmux"

# Find path-like references (packages/*, apps/*, scripts/*, etc.)
rg -o '(packages|apps|scripts|configs)/[a-zA-Z0-9_/-]+\.(ts|tsx|json|sh|go|rs|md)' "$VAULT_DIR" --no-filename | \
  sort -u | while read fpath; do
    if [ ! -f "$REPO_DIR/$fpath" ]; then
      echo "MISSING: $fpath"
    fi
done
```

## Check Wiki Link Targets

Verify wiki links point to existing notes:

```bash
VAULT_DIR="/Users/karlchow/Documents/obsidian_vault/5️⃣-Projects/GitHub/cmux"
# Extract wiki links and check if target files exist
rg -o '\[\[[^\]|]+' "$VAULT_DIR" --no-filename | \
  sed 's/\[\[//' | sort -u | while read link; do
    # Handle links with paths (dev-log/2026-02-28-foo)
    target="$VAULT_DIR/${link}.md"
    if [ ! -f "$target" ]; then
      # Also check in parent vault directories
      parent_target="/Users/karlchow/Documents/obsidian_vault/5️⃣-Projects/GitHub/cmux/${link}.md"
      if [ ! -f "$parent_target" ]; then
        echo "BROKEN LINK: [[$link]]"
      fi
    fi
done
```

## Identify Undocumented Features

Find recent significant changes that may lack vault coverage:

```bash
cd /Users/karlchow/Desktop/code/cmux
VAULT_DIR="/Users/karlchow/Documents/obsidian_vault/5️⃣-Projects/GitHub/cmux"

# Get recent commit subjects
git log --since="14 days ago" --pretty=format:"%s" | \
  grep -iE 'feat|feature|add|new|implement' | while read subject; do
    # Extract key terms and check vault
    keywords=$(echo "$subject" | tr '[:upper:]' '[:lower:]' | grep -oE '[a-z]{4,}' | head -3)
    found=0
    for kw in $keywords; do
      if rg -qi "$kw" "$VAULT_DIR" 2>/dev/null; then
        found=1
        break
      fi
    done
    if [ $found -eq 0 ]; then
      echo "UNDOCUMENTED: $subject"
    fi
done
```

# Phase 4 - Report Generation

Generate a structured review report.

## Report Template

Save output to a new vault note at `dev-log/YYYY-MM-DD-vault-review.md`:

```markdown
# Vault-Repo Review Report

> [!info] Audit Metadata
> **Date**: YYYY-MM-DD
> **Repo Commit**: (HEAD short SHA)
> **Notes Scanned**: (count)
> **Days Since Last Full Review**: (N)

## Summary

- **Stale Notes**: N notes marked Active/Current but not modified in 14+ days
- **Missing Docs**: N recent features without vault coverage
- **Broken References**: N wiki links or file paths that don't resolve
- **Recommended Actions**: N items

---

## Stale Notes

| Note | Status | Last Modified | Reason |
|------|--------|---------------|--------|
| [[note-name]] | Active | YYYY-MM-DD | No update after PR #X merged |

---

## Missing Documentation

| Feature/Change | Commit/PR | Suggested Note |
|----------------|-----------|----------------|
| Description | abc1234 or PR #N | [[proposed-note-name]] |

---

## Broken References

| Source Note | Reference | Issue |
|-------------|-----------|-------|
| [[source]] | `path/to/file.ts` | File moved/deleted |
| [[source]] | [[missing-note]] | Target note doesn't exist |

---

## Recommended Actions

- [ ] Update [[note-name]] to reflect current state
- [ ] Archive [[obsolete-note]] (superseded by PR #X)
- [ ] Create [[new-note]] for feature X
- [ ] Fix broken link in [[source-note]]

---

**Generated by**: vault-repo-review skill
```

## Generate Report Script

Run all phases and output the report:

```bash
#!/bin/bash
set -euo pipefail

REPO_DIR="/Users/karlchow/Desktop/code/cmux"
VAULT_DIR="/Users/karlchow/Documents/obsidian_vault/5️⃣-Projects/GitHub/cmux"
DATE=$(date +%Y-%m-%d)
HEAD_SHA=$(cd "$REPO_DIR" && git rev-parse --short HEAD)
NOTE_COUNT=$(find "$VAULT_DIR" -name "*.md" -type f | wc -l | tr -d ' ')

echo "# Vault-Repo Review Report"
echo ""
echo "> [!info] Audit Metadata"
echo "> **Date**: $DATE"
echo "> **Repo Commit**: $HEAD_SHA"
echo "> **Notes Scanned**: $NOTE_COUNT"
echo ""
echo "## Phase 1: Recent Repo Activity"
echo ""
echo "### Commits (last 30 days)"
echo '```'
cd "$REPO_DIR" && git log --oneline --since="30 days ago" | head -20
echo '```'
echo ""
echo "### Open PRs"
echo '```'
gh pr list --repo karlorz/cmux --state open --json number,title --limit 10
echo '```'
echo ""
echo "## Phase 2: Stale Notes"
echo ""
# (Add stale note detection output here)
echo ""
echo "## Phase 3: Broken References"
echo ""
# (Add broken reference detection output here)
echo ""
echo "---"
echo "**Generated by**: vault-repo-review skill"
```

# Verification

After running the workflow:

1. **Report renders correctly**: Open the generated dev-log note in Obsidian and verify markdown renders without errors
2. **Wiki links resolve**: Click wiki links in the report to verify they open the correct notes
3. **File paths are actionable**: Spot-check 2-3 "MISSING" file paths to confirm they truly don't exist
4. **Stale detection is accurate**: Verify flagged "stale" notes actually have outdated content vs just lacking recent edits

# Scheduling

Recommended cadence:
- **Weekly**: Quick scan (Phases 1-2) to catch drift
- **After major feature work**: Full review (all phases) before/after large PRs
- **Monthly**: Generate formal report note and update `_Overview.md` "Last Updated" date

# References

- Vault MOC: `5️⃣-Projects/GitHub/cmux/_Overview.md`
- Vault conventions: `AGENTS.md` (callout blocks, Mermaid, status labels)
- Repo CLAUDE.md: Project guidelines and code patterns
