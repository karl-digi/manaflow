---
name: cmux-upstream-sync
description: Merge upstream manaflow-ai/manaflow into fork karlorz/cmux while keeping fork-only features and reviewing Morph VM upstream changes for required PVE-LXC parity updates. Use when updating branches like sync/upstream-main-YYYYMMDD, resolving conflicts with .gitattributes rules, running bun check, generating a Morph-to-PVE parity report, and preparing a PR to karlorz/cmux:main.
---

# Purpose
- Keep fork custom work while pulling new fixes/features from upstream.
- Detect Morph-only upstream changes that may require matching PVE-LXC changes in the fork.
- Use merges (not rebases) into `sync/upstream-main-YYYYMMDD` then open PR to `karlorz/cmux:main`.

# Remotes
- Require `origin` -> fork and `upstream` -> manaflow-ai/manaflow.
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
# audit repository URLs in all package.json files (fails on upstream monorepo URL)
./.codex/skills/upstream-sync/scripts/audit-package-repo-links.sh
```
6) Run Morph -> PVE-LXC parity audit:
- Read `.codex/skills/upstream-sync/references/morph-pve-parity.md`.
- Generate the report skeleton:
```bash
./.codex/skills/upstream-sync/scripts/print-parity-report.sh
```
- Default range is `main...HEAD`. Pass a custom range when needed, for example:
```bash
./.codex/skills/upstream-sync/scripts/print-parity-report.sh origin/main...HEAD
```
- Produce a short parity report with:
  - Morph hotspot files changed.
  - Matching PVE-LXC counterpart files changed (or not changed).
  - Suggested follow-up for every Morph-only change (`mirror now`, `safe to defer`, or `not applicable` with reason).
- If a Morph hotspot changed and the PVE-LXC counterpart did not, add an explicit follow-up checklist item in the PR.
7) Push + PR:
```bash
git push -u origin sync/upstream-main-$(date +%Y%m%d)
gh pr create --repo karlorz/cmux --base main --head sync/upstream-main-$(date +%Y%m%d) --fill
```
8) Summarize changes for reviewers:
- Note notable upstream changes pulled in, key conflicts and decisions, and any follow-up fixes needed (e.g., TODOs you left to keep fork behavior).
- Include the Morph -> PVE-LXC parity report summary in the PR description.
- If follow-ups are required, add a short checklist in the PR description.

# Conflict rules
- **Honor .gitattributes merge drivers first**:
  - `.beads/**` (auto-generated) => use theirs (upstream) via merge driver.
  - `packages/shared/src/morph-snapshots.json`, `configs/ide-deps.json`, `packages/www-openapi-client/src/client/types.gen.ts` => keep ours.
- **.gitattributes conflicts**: preserve all existing fork-specific merge rules; append any new upstream entries. Ensure `merge=theirs`/`merge=ours` settings stay intact.
- **Fork-only features**: when upstream touches forked areas, prefer keeping fork behavior and selectively pull upstream fixes. If unsure, keep fork version and leave a FIXME note for follow-up.
- **`package.json` metadata conflicts**:
  - Audit all package metadata with `./.codex/skills/upstream-sync/scripts/audit-package-repo-links.sh`.
  - For fork-owned packages/apps, keep `repository.url` on `https://github.com/karlorz/cmux.git` when conflicts include `https://github.com/manaflow-ai/manaflow.git`.
  - Take upstream release progression for `version` unless the fork intentionally pins a different version.
  - Do not mass-rewrite external package repository links (for example `packages/cmux*` and `packages/vscode-extension`) when they intentionally point to `manaflow-ai/cmux` or `lawrencecchen/cmux`.
- **Generated clients/snapshots**: avoid regenerating unless required by upstream changes; keep fork snapshots unless intentionally refreshed.

# Review guidelines
- Read `REVIEW.md` early (before resolving conflicts) and re-scan before opening the PR.
- Apply the relevant sections (TypeScript/Convex/Rust/Swift/general) to any manual edits you make during the merge.
- If you intentionally keep a known issue or defer cleanup, call it out explicitly in the PR description with a short checklist.
- Treat provider parity as a review gate: call out Morph-only changes that could impact PVE-LXC behavior, even when code still compiles.

# PR checklist
- Merge commit present (no rebase).
- Conflicts resolved per rules above.
- `bun check` passes.
- Morph -> PVE-LXC parity report included (or explicitly marked no-impact with evidence).
- PR target: `karlorz/cmux:main`. Include a short summary of major upstream changes, conflict choices (especially if keeping fork code over upstream), and any follow-up items.

# References
- `.codex/skills/upstream-sync/references/morph-pve-parity.md`
- `.codex/skills/upstream-sync/scripts/audit-package-repo-links.sh`
- `.codex/skills/upstream-sync/scripts/print-parity-report.sh`
