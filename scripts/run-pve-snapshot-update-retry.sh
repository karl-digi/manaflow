#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-3}"
SLEEP_SECONDS="${SLEEP_SECONDS:-30}"

VMID="${1:-}"
if [[ -z "$VMID" ]]; then
  echo "Usage: $0 <vmid> [extra args]" >&2
  echo "Example: $0 9003 --no-use-git-diff" >&2
  exit 1
fi
shift || true

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  echo "Attempt $attempt of $MAX_ATTEMPTS"
  if uv run --env-file "$ENV_FILE" ./scripts/snapshot-pvelxc.py --update --update-vmid "$VMID" "$@"; then
    echo "Snapshot update completed successfully"
    exit 0
  fi
  echo "Attempt $attempt failed"
  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    echo "Waiting ${SLEEP_SECONDS}s before retry..."
    sleep "$SLEEP_SECONDS"
  fi
  attempt=$((attempt + 1))
done

echo "All $MAX_ATTEMPTS attempts failed"
exit 1
