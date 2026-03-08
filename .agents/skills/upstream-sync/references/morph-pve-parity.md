# Morph -> PVE-LXC Parity Reference

Use this after merging upstream and before opening the PR.

## Comparison range

```bash
RANGE="origin/main...HEAD"
```

Change `RANGE` only when the user asks for a different baseline.

## Hotspot map

Use this map to find where Morph-first upstream changes may need PVE-LXC parity updates.

| Morph-first area | PVE-LXC counterpart area | What to check |
| --- | --- | --- |
| `scripts/snapshot.py` | `scripts/snapshot-pvelxc.py` | Build/setup flow parity, preset knobs, manifest updates |
| `packages/shared/src/morph-snapshots.json` | `packages/shared/src/pve-lxc-snapshots.json` | Snapshot preset/version consistency |
| `apps/www/lib/routes/morph.route.ts` | `apps/www/lib/routes/pve-lxc.route.ts` | API behavior parity for resume/status/setup paths |
| `apps/www/lib/utils/morph-defaults.ts` | `apps/www/lib/utils/pve-lxc-defaults.ts` | Default snapshot and preset alignment |
| `apps/client/src/hooks/useMorphWorkspace.ts` | `apps/client/src/hooks/usePveLxcWorkspace.ts` | Workspace resume/auth UX parity |
| `packages/convex/convex/preview_jobs_worker.ts` | Same file (`pve-lxc` branches) | Provider branching parity in start/exec/stop/read-file paths |
| `packages/convex/convex/sandboxInstanceMaintenance.ts` | Same file (`pve-lxc` provider config) | Lifecycle parity (pause/stop/cleanup safety rules) |

## Audit commands

Preferred helper (auto-prints report skeleton):

```bash
./.agents/skills/upstream-sync/scripts/print-parity-report.sh
```

Default range is `main...HEAD`. Use a custom range if needed:

```bash
./.agents/skills/upstream-sync/scripts/print-parity-report.sh origin/main...HEAD
```

Manual commands (for deeper investigation):

```bash
RANGE="origin/main...HEAD"
git diff --name-only "$RANGE" > /tmp/upstream-sync-files.txt

rg -n "(^|/)morph|morphcloud|morph-snapshots|snapshot\\.py$" /tmp/upstream-sync-files.txt || true
rg -n "(^|/)pve|pve-lxc|snapshot-pvelxc\\.py|pve-lxc-snapshots" /tmp/upstream-sync-files.txt || true
```

```bash
RANGE="origin/main...HEAD"
cat <<'EOF' > /tmp/upstream-sync-parity-pairs.txt
scripts/snapshot.py|scripts/snapshot-pvelxc.py
packages/shared/src/morph-snapshots.json|packages/shared/src/pve-lxc-snapshots.json
apps/www/lib/routes/morph.route.ts|apps/www/lib/routes/pve-lxc.route.ts
apps/www/lib/utils/morph-defaults.ts|apps/www/lib/utils/pve-lxc-defaults.ts
apps/client/src/hooks/useMorphWorkspace.ts|apps/client/src/hooks/usePveLxcWorkspace.ts
EOF

while IFS='|' read -r morph_path pve_path; do
  morph_changed=$(git diff --name-only "$RANGE" -- "$morph_path")
  pve_changed=$(git diff --name-only "$RANGE" -- "$pve_path")
  if [ -n "$morph_changed" ] && [ -z "$pve_changed" ]; then
    echo "NEEDS_REVIEW: $morph_path -> $pve_path"
  fi
done < /tmp/upstream-sync-parity-pairs.txt
```

Use `git diff "$RANGE" -- <file>` for each `NEEDS_REVIEW` pair, then decide whether to mirror now or defer with an explicit reason.

## Report template

Copy this into the PR description or a sync note.

```markdown
## Morph -> PVE-LXC parity report (`origin/main...HEAD`)

- Morph hotspot files changed: <count>
- PVE-LXC hotspot files changed: <count>

### Reviewed pairs
- `<morph-file>` -> `<pve-file>`
  - Decision: `mirrored` | `safe to defer` | `not applicable`
  - Evidence: `git diff origin/main...HEAD -- <file>`
  - Suggestion/follow-up: <short action or reason>

### Follow-up checklist
- [ ] <item 1>
- [ ] <item 2>
```
