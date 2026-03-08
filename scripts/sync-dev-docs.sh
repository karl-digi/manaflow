#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_DOCS_DIR="$REPO_ROOT/dev-docs"
SOURCE_REPO="https://github.com/karlorz/dev-docs-cmux.git"

echo "Syncing dev-docs from karlorz/dev-docs-cmux..."

rm -rf "$DEV_DOCS_DIR"
git clone --depth 1 "$SOURCE_REPO" "$DEV_DOCS_DIR"
rm -rf "$DEV_DOCS_DIR/.git" "$DEV_DOCS_DIR/.github"

echo "Done. dev-docs synced successfully."
