---
name: cmux-upstream-sync
description: Merge upstream manaflow-ai/cmux into fork karlorz/cmux while keeping fork-only features. Use when updating branches like sync/upstream-main-YYYYMMDD, resolving conflicts with .gitattributes rules, running bun check, and preparing a PR to karlorz/cmux:main.
---

# Purpose
- Keep fork custom work while pulling new fixes/features from upstream.
- Use merges (not rebases) into `sync/upstream-main-YYYYMMDD` then open PR to `karlorz/cmux:main`.

# Remotes
- Require `origin` -> fork and `upstream` -> manaflow-ai/cmux.
- If both `upstream` and `manaflow-ai` point to the same URL, prefer keeping `origin` + `upstream` and optionally remove the duplicate: `git remote remove manaflow-ai`.

# Quick workflow
1) Sync remotes:
```bash
git fetch origin --prune
git fetch upstream --prune
```
2) Create/update branch from fork main:
```bash
git checkout origin/main
git switch -C sync/upstream-main-$(date +%Y%m%d)
```
3) Merge upstream:
```bash
git merge upstream/main
```
4) Resolve conflicts (see rules below), then:
```bash
git status
# resolve files
git add <resolved>
git commit  # finalize merge
```
5) Verify:
```bash
bun install  # if new deps
bun check
```
6) Push + PR:
```bash
git push -u origin sync/upstream-main-$(date +%Y%m%d)
gh pr create --repo karlorz/cmux --base main --head sync/upstream-main-$(date +%Y%m%d) --fill
```
7) Summarize changes for reviewers:
- Note notable upstream changes pulled in, key conflicts and decisions, and any follow-up fixes needed (e.g., TODOs you left to keep fork behavior).
- If follow-ups are required, add a short checklist in the PR description.

# Conflict rules
- **Honor .gitattributes merge drivers first**:
  - `.beads/**` (auto-generated) => use theirs (upstream) via merge driver.
  - `packages/shared/src/morph-snapshots.json`, `configs/ide-deps.json`, `packages/www-openapi-client/src/client/types.gen.ts` => keep ours.
- **.gitattributes conflicts**: preserve all existing fork-specific merge rules; append any new upstream entries. Ensure `merge=theirs`/`merge=ours` settings stay intact.
- **Fork-only features**: when upstream touches forked areas, prefer keeping fork behavior and selectively pull upstream fixes. If unsure, keep fork version and leave a FIXME note for follow-up.
- **Generated clients/snapshots**: avoid regenerating unless required by upstream changes; keep fork snapshots unless intentionally refreshed.

# PR checklist
- Merge commit present (no rebase).
- Conflicts resolved per rules above.
- `bun check` passes.
- PR target: `karlorz/cmux:main`. Include a short summary of major upstream changes, conflict choices (especially if keeping fork code over upstream), and any follow-up items.
