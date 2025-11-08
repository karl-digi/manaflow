#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/apps/client"

# Get current git branch and sanitize it for use in app name
get_sanitized_branch_name() {
  local branch_name
  branch_name=$(git -C "$ROOT_DIR" branch --show-current 2>/dev/null || echo "unknown")

  # Sanitize: replace invalid characters with hyphens, collapse multiple hyphens
  # Valid characters for app names: letters, numbers, hyphens, spaces (we'll use hyphens)
  branch_name=$(echo "$branch_name" | sed 's/[^a-zA-Z0-9-]/-/g' | sed 's/-\+/-/g' | sed 's/^-//;s/-$//')

  echo "$branch_name"
}

# Truncate app name to meet platform length limits
# macOS: 255 chars for file names (including .app extension)
# Linux: 255 chars for file names
# Windows: 260 chars for full paths, but keep it conservative
# We'll use a max of 80 chars total for the app name to be safe across all platforms
truncate_app_name() {
  local base_name="$1"
  local branch_name="$2"
  local max_length=80

  # Calculate available space: max_length - base_name - hyphen
  local available_for_branch=$((max_length - ${#base_name} - 1))

  if [ ${#branch_name} -gt "$available_for_branch" ]; then
    # Truncate branch name and add ellipsis
    local truncated_length=$((available_for_branch - 3))
    if [ "$truncated_length" -gt 0 ]; then
      branch_name="${branch_name:0:$truncated_length}..."
    else
      # If even truncated name won't fit, skip branch name
      echo "$base_name"
      return
    fi
  fi

  echo "${base_name}-${branch_name}"
}

BRANCH_NAME=$(get_sanitized_branch_name)
BASE_APP_NAME="cmux-staging"
APP_NAME=$(truncate_app_name "$BASE_APP_NAME" "$BRANCH_NAME")
APP_PROCESS_PATTERN="$APP_NAME"
APP_BUNDLE_ID="com.cmux.app"

echo "==> Building staging app with name: $APP_NAME"

wait_for_process_exit() {
  local pattern="$1"
  local timeout="${2:-10}"
  local deadline=$((SECONDS + timeout))

  while pgrep -f "$pattern" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      return 1
    fi
    sleep 0.5
  done

  return 0
}

stop_staging_app_instances() {
  local pattern="$1"
  local bundle_id="$2"

  if ! pgrep -f "$pattern" >/dev/null 2>&1; then
    echo "==> No running $pattern instances detected."
    return 0
  fi

  echo "==> Attempting graceful shutdown for existing $pattern..."
  local graceful_shutdown=0
  if command -v osascript >/dev/null 2>&1; then
    if osascript -e "tell application id \"$bundle_id\" to quit" >/dev/null 2>&1; then
      if wait_for_process_exit "$pattern" 5; then
        echo "==> $pattern exited after AppleScript quit request."
        graceful_shutdown=1
      fi
    fi
  fi

  if (( graceful_shutdown == 0 )); then
    echo "==> Sending SIGTERM to $pattern..."
    pkill -TERM -f "$pattern" >/dev/null 2>&1 || true
    if wait_for_process_exit "$pattern" 10; then
      echo "==> $pattern terminated after SIGTERM."
      graceful_shutdown=1
    fi
  fi

  if (( graceful_shutdown == 0 )); then
    echo "==> Forcing SIGKILL for remaining $pattern processes..." >&2
    pkill -KILL -f "$pattern" >/dev/null 2>&1 || true
    if ! wait_for_process_exit "$pattern" 5; then
      echo "WARNING: $pattern processes still running after SIGKILL." >&2
      return 1
    fi
  fi

  return 0
}

ENV_FILE=""
if [[ -f "$ROOT_DIR/.env" ]]; then
  ENV_FILE="$ROOT_DIR/.env"
elif [[ -f "$ROOT_DIR/.env.production" ]]; then
  ENV_FILE="$ROOT_DIR/.env.production"
else
  echo "ERROR: Expected either $ROOT_DIR/.env or $ROOT_DIR/.env.production to exist so staging uses env vars." >&2
  exit 1
fi

stop_staging_app_instances "$APP_PROCESS_PATTERN" "$APP_BUNDLE_ID"

echo "==> Building $APP_NAME with env file: $ENV_FILE"
(cd "$CLIENT_DIR" && CMUX_APP_NAME="$APP_NAME" bun run --env-file "$ENV_FILE" build:mac:workaround)
