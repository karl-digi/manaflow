# Fork Override / Rebrand Audit Reference

Use this after merging upstream and before opening the PR.

Goal: catch upstream rebrand changes that can silently override fork protocol/domains, break GitHub PR comment update matching, or drift Electron runtime constants.

## Comparison range

```bash
RANGE="origin/main...HEAD"
```

## Hotspot map (rebrand/fork override)

| Area | Hotspot files | What to check |
| --- | --- | --- |
| PR comment update matching | `packages/convex/convex/github_pr_comments.ts` | `COMMENT_SIGNATURE_MATCHERS` includes legacy signatures (including UTM variants) so existing comments are updated instead of duplicated. Prefer making the signature base URL/bot name configurable so forks are not pinned to cmux.dev or manaflow.com. |
| Proxy hostname parsing | `packages/shared/src/components/environment/utils.ts` `apps/www/components/preview/preview-configure-client.tsx` | Proxy hostname regex supports `.manaflow.com` style hostnames (ensure `com` is included in the TLD segment). Keep regex consistent across both locations. |
| Preview/workspace URLs | `packages/convex/convex/preview_jobs_http.ts` `packages/convex/convex/previewScreenshots.ts` | Avoid hardcoding `www.manaflow.com` if fork deploys under a custom domain; prefer `BASE_APP_URL` from env. |
| Deep link scheme/protocol | `apps/client/src/routes/_layout.$teamSlugOrId.connect-complete.tsx` `apps/www/app/(home)/connect-complete/page.tsx` `packages/convex/convex/github_setup.ts` | Avoid hardcoding `manaflow://`; prefer `env.NEXT_PUBLIC_CMUX_PROTOCOL` (fork-controlled). |
| Electron host/partition drift | `apps/client/electron/main/index.ts` `apps/client/electron/main/bootstrap.ts` `apps/client/src/components/cmux-comments.tsx` | `PARTITION` strings match; `APP_HOST` and renderer-side Electron detection are aligned (`cmux.local` vs `manaflow.local`). |
| Electron build config | `apps/client/electron-builder.fork.json` `apps/client/electron-builder.fork.local.json` `scripts/build-electron-local.sh` `scripts/build-prod-mac-arm64-no-notarize-or-sign.sh` | Fork packaging continues to use fork builder configs for `appId`/`productName`/protocol. Verify build scripts still point at fork configs (or set `ELECTRON_BUILDER_CONFIG=...` when using generic publish scripts). |
| Branch prefix hardcoding | `apps/server/src/utils/branchNameGenerator.ts` `apps/www/lib/utils/branch-name-generator.ts` `apps/www/lib/routes/branch.route.ts` | Avoid hardcoding `manaflow/` prefix; keep fork prefix behavior (typically via `DEFAULT_BRANCH_PREFIX` or a parameter). |
| devsh package metadata | `packages/devsh/go.mod` `packages/devsh/npm/*/package.json` `packages/devsh/Makefile` | Go module must stay `github.com/karlorz/devsh`; npm packages `devsh`/`devsh-*` with author `karlorz`; homepage `github.com/karlorz/cmux`. |

## Audit command

Preferred helper (prints report skeleton + greps hotspots):

```bash
./.agents/skills/upstream-sync/scripts/audit-fork-overrides.sh origin/main...HEAD
```

## Common fixes (keep fork configurable)

Keep these changes small and fork-focused (avoid hardcoding upstream domains/protocols).

- PR comment signatures:
  - Ensure `COMMENT_SIGNATURE_MATCHERS` covers legacy signatures (including UTM variants) so bots update existing comments instead of duplicating.
  - Prefer making the signature base URL and bot name configurable via env (for example `CMUX_BASE_URL`, `CMUX_BOT_NAME`) rather than hardcoding cmux.dev or manaflow.com.
- Proxy hostname regex:
  - Ensure the TLD segment includes `com` (for example `(?:app|com|dev|sh|local|localhost)`).
  - Keep the regex consistent across `packages/shared/.../utils.ts` and `apps/www/.../preview-configure-client.tsx`.
- Preview/workspace URLs:
  - Replace `www.manaflow.com` literals with `BASE_APP_URL` from env (fall back to upstream default only when unset).
- Electron drift:
  - Keep `PARTITION` consistent across Electron entrypoints.
  - Align renderer-side Electron detection with the actual `APP_HOST` (`cmux.local` vs `manaflow.local`).
- Branch prefix:
  - Avoid hardcoding `manaflow/`; keep prefixing behavior driven by `DEFAULT_BRANCH_PREFIX` or a parameter.

## Manual commands (when digging deeper)

```bash
RANGE="origin/main...HEAD"
git diff --name-only "$RANGE" > /tmp/upstream-sync-files.txt
```

Search for common rebrand overrides:

```bash
rg -n "manaflow://|persist:manaflow|manaflow\\.local|www\\.manaflow\\.com|https://manaflow\\.com" /tmp/upstream-sync-files.txt || true
```

Verify proxy regex includes `com`:

```bash
git diff "$RANGE" -- packages/shared/src/components/environment/utils.ts
git diff "$RANGE" -- apps/www/components/preview/preview-configure-client.tsx
```

## Report template (copy into PR description)

```markdown
## Fork override / rebrand audit (`origin/main...HEAD`)

### Findings
- <P2/P3 items with file+evidence>

### Follow-up checklist
- [ ] <item 1>
```
