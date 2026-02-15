#!/usr/bin/env bash
set -euo pipefail

RANGE="${1:-main...HEAD}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: run this script inside a git repository." >&2
  exit 1
fi

if ! git diff --name-only "$RANGE" -- >/dev/null 2>&1; then
  echo "Error: invalid git range '$RANGE'." >&2
  echo "Usage: $0 [<range>]  # example: $0 main...HEAD" >&2
  exit 1
fi

pair_rows() {
  cat <<'EOF'
scripts/snapshot.py|scripts/snapshot-pvelxc.py
packages/shared/src/morph-snapshots.json|packages/shared/src/pve-lxc-snapshots.json
apps/www/lib/routes/morph.route.ts|apps/www/lib/routes/pve-lxc.route.ts
apps/www/lib/utils/morph-defaults.ts|apps/www/lib/utils/pve-lxc-defaults.ts
apps/client/src/hooks/useMorphWorkspace.ts|apps/client/src/hooks/usePveLxcWorkspace.ts
packages/convex/convex/preview_jobs_worker.ts|packages/convex/convex/preview_jobs_worker.ts
packages/convex/convex/sandboxInstanceMaintenance.ts|packages/convex/convex/sandboxInstanceMaintenance.ts
EOF
}

morph_hotspots_changed=0
pve_hotspots_changed=0
reviewed_pairs=0
morph_only_alerts=()

while IFS='|' read -r morph_path pve_path; do
  morph_diff="$(git diff --name-only "$RANGE" -- "$morph_path")"
  pve_diff="$(git diff --name-only "$RANGE" -- "$pve_path")"

  morph_changed=0
  pve_changed=0

  if [ -n "$morph_diff" ]; then
    morph_changed=1
    morph_hotspots_changed=$((morph_hotspots_changed + 1))
  fi

  if [ -n "$pve_diff" ]; then
    pve_changed=1
    pve_hotspots_changed=$((pve_hotspots_changed + 1))
  fi

  if [ "$morph_changed" -eq 1 ] || [ "$pve_changed" -eq 1 ]; then
    reviewed_pairs=$((reviewed_pairs + 1))
    if [ "$morph_changed" -eq 1 ] && [ "$pve_changed" -eq 0 ]; then
      morph_only_alerts+=("$morph_path|$pve_path")
    fi
  fi
done < <(pair_rows)

echo "## Morph -> PVE-LXC parity report (\`$RANGE\`)"
echo
echo "- Morph hotspot files changed: $morph_hotspots_changed"
echo "- PVE-LXC hotspot files changed: $pve_hotspots_changed"
echo
echo "### Reviewed pairs"

if [ "$reviewed_pairs" -eq 0 ]; then
  echo "- No mapped hotspot pairs changed in this range."
else
  while IFS='|' read -r morph_path pve_path; do
    morph_diff="$(git diff --name-only "$RANGE" -- "$morph_path")"
    pve_diff="$(git diff --name-only "$RANGE" -- "$pve_path")"

    morph_state="not changed"
    pve_state="not changed"

    if [ -n "$morph_diff" ]; then
      morph_state="changed"
    fi

    if [ -n "$pve_diff" ]; then
      pve_state="changed"
    fi

    if [ "$morph_state" = "not changed" ] && [ "$pve_state" = "not changed" ]; then
      continue
    fi

    echo "- \`$morph_path\` -> \`$pve_path\`"
    echo "  - Change summary: Morph=\`$morph_state\`, PVE-LXC=\`$pve_state\`"
    echo "  - Decision: \`mirror now\` | \`safe to defer\` | \`not applicable\`"
    echo "  - Evidence: \`git diff $RANGE -- $morph_path $pve_path\`"
    echo "  - Suggestion/follow-up: TODO"
  done < <(pair_rows)
fi

echo
echo "### Morph-only alerts"

if [ "${#morph_only_alerts[@]}" -eq 0 ]; then
  echo "- None."
else
  for entry in "${morph_only_alerts[@]}"; do
    morph_path="${entry%%|*}"
    pve_path="${entry##*|}"
    echo "- \`$morph_path\` changed while \`$pve_path\` did not."
  done
fi

echo
echo "### Follow-up checklist"
echo "- [ ] Add follow-up items for every Morph-only alert, or mark each as not applicable with reason."
