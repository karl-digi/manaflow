#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/apps/client"

# Get the current git branch name
get_branch_name() {
  local branch_name
  branch_name=$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  echo "$branch_name"
}

# Sanitize branch name for use in app name (remove special chars, replace slashes with dashes)
sanitize_branch_name() {
  local branch="$1"
  # Replace slashes with dashes, remove special characters except alphanumeric, dash, and underscore
  echo "$branch" | sed 's/\//-/g' | sed 's/[^a-zA-Z0-9_-]//g'
}

# Truncate string to max length, preserving readability
truncate_string() {
  local str="$1"
  local max_len="$2"
  if [ ${#str} -le "$max_len" ]; then
    echo "$str"
  else
    # Truncate and add a hash of the full string for uniqueness
    local hash=$(echo -n "$str" | shasum -a 256 | cut -c1-6)
    local truncate_len=$((max_len - 7))  # Leave room for -hash
    echo "${str:0:$truncate_len}-$hash"
  fi
}

# Build app name with branch
build_app_name() {
  local base_name="cmux-staging"
  local branch_name=$(get_branch_name)
  local sanitized_branch=$(sanitize_branch_name "$branch_name")

  # macOS app name limits:
  # - CFBundleName: 16 chars recommended, 255 max (but shorter is better for UI)
  # - Process name: 255 chars max but typically much shorter in practice
  # Windows has 260 char path limit, Linux is more flexible
  # We'll use a conservative 40 char limit for the full app name to ensure good UX
  local max_app_name_length=40
  local full_name="${base_name}-${sanitized_branch}"

  # If the full name is too long, truncate the branch part
  if [ ${#full_name} -gt "$max_app_name_length" ]; then
    local base_len=${#base_name}
    local max_branch_len=$((max_app_name_length - base_len - 1))  # -1 for the dash
    sanitized_branch=$(truncate_string "$sanitized_branch" "$max_branch_len")
    full_name="${base_name}-${sanitized_branch}"
  fi

  echo "$full_name"
}

APP_NAME=$(build_app_name)
APP_PROCESS_PATTERN="$APP_NAME"
APP_BUNDLE_ID="com.cmux.app"

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
