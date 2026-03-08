#!/usr/bin/env bash
set -euo pipefail

# Usage: ./clean-node-modules.sh [-n|--dry-run] [path]
DRY_RUN=0
TARGET="."
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--dry-run) DRY_RUN=1; shift ;;
    -h|--help) echo "Usage: $0 [-n|--dry-run] [path]"; exit 0 ;;
    *) TARGET="$1"; shift ;;
  esac
done

# Parallelism
CORES=1
if command -v nproc >/dev/null 2>&1; then CORES="$(nproc)"; elif command -v sysctl >/dev/null 2>&1; then CORES="$(sysctl -n hw.ncpu)"; fi

# Prefer fd (much faster); fall back to find. Both avoid descending into node_modules.
# Exclude dev-docs/ which contains synced documentation snapshots.
if command -v fd >/dev/null 2>&1; then
  FIND_CMD=(fd -HI -t d -0 --exclude 'dev-docs' '^node_modules$' "$TARGET")
else
  FIND_CMD=(find "$TARGET" -path './dev-docs' -prune -o -type d -name node_modules -prune -print0)
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  "${FIND_CMD[@]}" | tr '\0' '\n'
else
  "${FIND_CMD[@]}" | xargs -0 -n 1 -P "$CORES" rm -rf --
fi
