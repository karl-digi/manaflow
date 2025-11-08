#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/apps/client"
APP_PROCESS_PATTERN="cmux-staging"
APP_BUNDLE_ID="com.cmux.app"

get_current_branch_name() {
  local branch
  if branch=$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null) && [[ "$branch" != "HEAD" ]]; then
    echo "$branch"
    return
  fi

  if branch=$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null); then
    echo "$branch"
    return
  fi

  echo "unknown"
}

sanitize_branch_name() {
  local name="${1:-unknown}"
  local normalized
  normalized="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]-' '-')"
  normalized="$(printf '%s\n' "$normalized" | sed -E 's/-+/-/g; s/^-//; s/-$//')"
  if [[ -z "$normalized" ]]; then
    normalized="unknown"
  fi
  echo "$normalized"
}

get_app_name_limit() {
  # Desktop filesystems (APFS, ext4, NTFS) cap individual path components at 255 bytes.
  case "$(uname -s)" in
    Darwin|Linux) echo 255 ;;
    CYGWIN*|MINGW*|MSYS*|Windows_NT) echo 255 ;;
    *) echo 255 ;;
  esac
}

build_app_name() {
  local base="$1"
  local branch_suffix="$2"
  local limit
  limit="$(get_app_name_limit)"

  local candidate="$base"
  if [[ -n "$branch_suffix" ]]; then
    candidate="$base-$branch_suffix"
  fi

  if (( ${#candidate} <= limit )); then
    echo "$candidate"
    return
  fi

  if [[ -n "$branch_suffix" ]]; then
    local available=$((limit - ${#base} - 1))
    if (( available > 0 )); then
      local trimmed_branch="${branch_suffix:0:available}"
      trimmed_branch="$(printf '%s\n' "$trimmed_branch" | sed -E 's/-+$//')"
      if [[ -n "$trimmed_branch" ]]; then
        echo "${base}-${trimmed_branch}"
        return
      fi
    fi
  fi

  echo "${base:0:limit}"
}

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

CURRENT_BRANCH="$(get_current_branch_name)"
SANITIZED_BRANCH="$(sanitize_branch_name "$CURRENT_BRANCH")"
APP_NAME="$(build_app_name "cmux-staging" "$SANITIZED_BRANCH")"

stop_staging_app_instances "$APP_PROCESS_PATTERN" "$APP_BUNDLE_ID"

echo "==> Building $APP_NAME with env file: $ENV_FILE"
(cd "$CLIENT_DIR" && CMUX_APP_NAME="$APP_NAME" bun run --env-file "$ENV_FILE" build:mac:workaround)
