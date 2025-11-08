#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/apps/client"

# Use production env variables for staging build
ENV_FILE="$ROOT_DIR/.env.production"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env.production file not found at $ENV_FILE"
  echo "Please create .env.production with your production environment variables"
  exit 1
fi

echo "==> Building staging version with production env: $ENV_FILE"

# Build using staging electron-builder config
(cd "$CLIENT_DIR" && bun run --env-file "$ENV_FILE" build:staging)
