#!/usr/bin/env bash
set -euo pipefail

# Local macOS arm64 build for Electron app (DMG only, unsigned, no notarization)
# Builds the app and packages a DMG without any signing or notarization.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/apps/client"
ENTITLEMENTS="$CLIENT_DIR/build/entitlements.mac.plist"
DIST_DIR="$CLIENT_DIR/dist-electron"

ARCH_EXPECTED="arm64"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--env-file path] [--skip-install]

Builds macOS arm64 DMG locally without signing or notarization.

Options:
  --env-file path        Source environment variables from a file before running
  --skip-install         Skip 'bun install --frozen-lockfile'

Notes:
  - Always produces an unsigned DMG (no ZIP, no signing, no notarization).
  - If no --env-file is provided, tries to source '.env.production' from repo root.
EOF
}

ENV_FILE=""
SKIP_INSTALL=false

# --- timing helpers ---
BUILD_START_TS=$(date +%s)
CURRENT_STEP_NAME=""
CURRENT_STEP_START=0
TIMINGS=()

start_step() {
  CURRENT_STEP_NAME="$1"
  CURRENT_STEP_START=$(date +%s)
  echo "==> $CURRENT_STEP_NAME"
}

end_step() {
  local end_ts
  end_ts=$(date +%s)
  local dur=$(( end_ts - CURRENT_STEP_START ))
  TIMINGS+=("$CURRENT_STEP_NAME:$dur")
  echo "-- $CURRENT_STEP_NAME took ${dur}s"
  CURRENT_STEP_NAME=""
  CURRENT_STEP_START=0
}

print_timings() {
  if (( ${#TIMINGS[@]} > 0 )); then
    echo "==> Step timing summary"
    for entry in "${TIMINGS[@]}"; do
      local name=${entry%%:*}
      local dur=${entry##*:}
      printf "  - %-32s %6ss\n" "$name" "$dur"
    done
    local total=$(( $(date +%s) - BUILD_START_TS ))
    printf "  - %-32s %6ss\n" "Total" "$total"
  fi
}

on_exit() {
  local ec=$?
  # If a step was in progress and failed before end_step, capture partial duration
  if [[ -n "$CURRENT_STEP_NAME" && $CURRENT_STEP_START -gt 0 ]]; then
    local now_ts=$(date +%s)
    local dur=$(( now_ts - CURRENT_STEP_START ))
    TIMINGS+=("$CURRENT_STEP_NAME:$dur")
  fi
  if [[ $ec -ne 0 ]]; then
    echo "!! Build failed with exit code $ec"
  fi
  print_timings
}

trap on_exit EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      if [[ -z "$ENV_FILE" ]]; then
        echo "--env-file requires a path" >&2
        exit 1
      fi
      shift 2
      ;;
    --skip-install)
      SKIP_INSTALL=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

# Preconditions
if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script must run on macOS." >&2
  exit 1
fi

HOST_ARCH="$(uname -m)"
if [[ "$HOST_ARCH" != "$ARCH_EXPECTED" ]]; then
  echo "Warning: Host architecture is '$HOST_ARCH', expected '$ARCH_EXPECTED'." >&2
  echo "Continuing anyway..." >&2
fi

command -v bun >/dev/null 2>&1 || { echo "bun is required. Install from https://bun.sh" >&2; exit 1; }

start_step "Load environment"
if [[ -n "$ENV_FILE" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Env file not found: $ENV_FILE" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  # Default to repo root production env if present
  if [[ -f "$ROOT_DIR/.env.production" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env.production"
    set +a
  fi
fi
end_step

start_step "Generate icons"
(cd "$CLIENT_DIR" && bun run ./scripts/generate-icons.mjs)
end_step

# Entitlements are only needed for signing; safe to generate but not required.
start_step "Prepare macOS entitlements"
bash "$ROOT_DIR/scripts/prepare-macos-entitlements.sh" || true
end_step

if [[ "$SKIP_INSTALL" != "true" ]]; then
  start_step "Install dependencies"
  (cd "$ROOT_DIR" && bun install --frozen-lockfile)
  end_step
fi

start_step "Build native addon (release)"
(cd "$ROOT_DIR/apps/server/native/core" && bunx --bun @napi-rs/cli build --platform --release)
end_step

start_step "Build Electron app"
(cd "$CLIENT_DIR" && bunx electron-vite build -c electron.vite.config.ts)
end_step

mkdir -p "$DIST_DIR"

start_step "Package DMG"
export CSC_IDENTITY_AUTO_DISCOVERY=false
(cd "$CLIENT_DIR" && \
  bunx electron-builder \
    --config electron-builder.json \
    --mac dmg --arm64 \
    --publish never \
    --config.mac.identity=null \
    --config.dmg.sign=false \
    --config.mac.notarize=false)
end_step

echo "==> Done. Outputs in: $DIST_DIR"
