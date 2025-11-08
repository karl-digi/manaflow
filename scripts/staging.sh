#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/apps/client"

# Use production env variables for the staging build; fall back to .env if missing.
ENV_FILE="$ROOT_DIR/.env.production"
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE="$ROOT_DIR/.env"
fi

echo "==> Building staging Electron app (cmux-staging)"
echo "==> Using env file: $ENV_FILE"

(
  cd "$CLIENT_DIR"
  CMUX_APP_NAME="cmux-staging" bun run --env-file "$ENV_FILE" build:mac:workaround
)
