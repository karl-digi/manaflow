---
name: cmux-upstream-sync
description: Merge upstream manaflow-ai/manaflow into fork karlorz/cmux using merge commits (no rebases) while preserving fork-only behavior. Use when syncing upstream into branches like codex/sync/upstream-main-YYYYMMDD, resolving conflicts with .gitattributes rules, running bun check, auditing fork config overrides from upstream rebrand changes (protocol/domains/PR comment signature matchers/Electron partition), generating a Morph-to-PVE-LXC parity report, and preparing a PR to karlorz/cmux:main.
---

# Purpose
- Keep fork custom work while pulling new fixes/features from upstream.
- Detect Morph-only upstream changes that may require matching PVE-LXC changes in the fork.
- Catch upstream rebrand changes that can silently override fork protocol/base URLs or break PR comment update matching.
- Use merges (not rebases) into `codex/sync/upstream-main-YYYYMMDD` then open PR to `karlorz/cmux:main`.

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
BRANCH="codex/sync/upstream-main-$(date +%Y%m%d)"
git switch -C "$BRANCH" origin/main
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
6) Run fork override / rebrand audit (treat P2 findings as merge gates):
- Read `.codex/skills/upstream-sync/references/fork-override-audit.md`.
- Generate a report skeleton:
```bash
./.codex/skills/upstream-sync/scripts/audit-fork-overrides.sh origin/main...HEAD
```
7) Run Morph -> PVE-LXC parity audit:
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
8) Push + PR:
```bash
git push -u origin "$BRANCH"
gh pr create --repo karlorz/cmux --base main --head "$BRANCH" --fill
```
9) Summarize changes for reviewers:
- Note notable upstream changes pulled in, key conflicts and decisions, and any follow-up fixes needed (e.g., TODOs you left to keep fork behavior).
- Include the Morph -> PVE-LXC parity report summary in the PR description.
- Include the fork override / rebrand audit summary in the PR description (or explicitly state no findings).
- If follow-ups are required, add a short checklist in the PR description.

# Conflict rules
- **Honor .gitattributes merge drivers first**:
  - `.beads/**` (auto-generated) => use theirs (upstream) via merge driver.
  - `packages/shared/src/morph-snapshots.json`, `configs/ide-deps.json`, `packages/www-openapi-client/src/client/types.gen.ts` => keep ours.
- **.gitattributes conflicts**: preserve all existing fork-specific merge rules; append any new upstream entries. Ensure `merge=theirs`/`merge=ours` settings stay intact.
- **Fork-only features**: when upstream touches forked areas, prefer keeping fork behavior and selectively pull upstream fixes. If unsure, keep fork version and leave a FIXME note for follow-up.
- **Rebrand/fork override hotspots** (review carefully when changed upstream):
  - PR comment update matching: `packages/convex/convex/github_pr_comments.ts` should keep legacy signature matchers to avoid duplicate comments. Prefer making the signature base URL/bot name configurable (forks should not be pinned to cmux.dev or manaflow.com).
  - Proxy hostname parsing: keep `.manaflow.com`-style host parsing working by ensuring `com` is included in the proxy hostname regex in both `packages/shared/src/components/environment/utils.ts` and `apps/www/components/preview/preview-configure-client.tsx`.
  - Preview/workspace URLs: avoid hardcoding `www.manaflow.com` in Convex preview URLs; prefer `BASE_APP_URL` from env.
  - Electron consistency: keep `PARTITION`, `APP_HOST`, and protocol/deep-link scheme consistent across `apps/client/electron/main/bootstrap.ts`, `apps/client/electron/main/index.ts`, and renderer-side Electron checks.
  - Electron build configs: fork packaging should continue to use `apps/client/electron-builder.fork.json` / `apps/client/electron-builder.fork.local.json` (not upstream `electron-builder.json`) for `appId`, `productName`, and `protocol`.
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
- Fork override / rebrand audit included (or explicitly no findings with evidence).
- Morph -> PVE-LXC parity report included (or explicitly marked no-impact with evidence).
- PR target: `karlorz/cmux:main`. Include a short summary of major upstream changes, conflict choices (especially if keeping fork code over upstream), and any follow-up items.

# References
- `.codex/skills/upstream-sync/references/fork-override-audit.md`
- `.codex/skills/upstream-sync/references/morph-pve-parity.md`
- `.codex/skills/upstream-sync/scripts/audit-package-repo-links.sh`
- `.codex/skills/upstream-sync/scripts/audit-fork-overrides.sh`
- `.codex/skills/upstream-sync/scripts/print-parity-report.sh`
