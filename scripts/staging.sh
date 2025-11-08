#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/apps/client"
APP_BUNDLE_ID="com.cmux.app"
APP_BASE_NAME="cmux-staging"

get_current_branch_name() {
  local branch
  branch="$(cd "$ROOT_DIR" && git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [[ -z "$branch" ]]; then
    branch="unknown"
  elif [[ "$branch" == "HEAD" ]]; then
    local sha
    sha="$(cd "$ROOT_DIR" && git rev-parse --short HEAD 2>/dev/null || true)"
    branch="detached-${sha:-unknown}"
  fi
  echo "$branch"
}

sanitize_branch_component() {
  local raw="$1"
  local sanitized="${raw//[^a-zA-Z0-9]/-}"
  sanitized="${sanitized,,}"
  while [[ "$sanitized" == *--* ]]; do
    sanitized="${sanitized//--/-}"
  done
  while [[ "$sanitized" == -* ]]; do
    sanitized="${sanitized#-}"
  done
  while [[ "$sanitized" == *- ]]; do
    sanitized="${sanitized%-}"
  done
  if [[ -z "$sanitized" ]]; then
    sanitized="unknown"
  fi
  echo "$sanitized"
}

determine_max_app_name_length() {
  local kernel
  kernel="$(uname -s 2>/dev/null || echo "")"
  case "$kernel" in
    Darwin)
      # CFBundleName is limited to 63 characters.
      echo 63
      ;;
    Linux)
      # Ext-family filesystems limit a path component to 255 bytes.
      echo 255
      ;;
    CYGWIN*|MINGW*|MSYS*|Windows_NT)
      # NTFS path components are limited to 255 characters.
      echo 255
      ;;
    *)
      echo 255
      ;;
  esac
}

build_staging_app_name() {
  local branch sanitized_branch max_length candidate usable_suffix_length
  branch="$(get_current_branch_name)"
  sanitized_branch="$(sanitize_branch_component "$branch")"
  max_length="$(determine_max_app_name_length)"

  candidate="$APP_BASE_NAME"
  if [[ -n "$sanitized_branch" ]]; then
    usable_suffix_length=$((max_length - ${#APP_BASE_NAME} - 1))
    if (( usable_suffix_length > 0 )); then
      if (( ${#sanitized_branch} > usable_suffix_length )); then
        sanitized_branch="${sanitized_branch:0:usable_suffix_length}"
      fi
      candidate="${APP_BASE_NAME}-${sanitized_branch}"
    fi
  fi

  if (( ${#candidate} > max_length )); then
    candidate="${candidate:0:max_length}"
    while [[ "$candidate" == *- ]]; do
      candidate="${candidate::-1}"
    done
  fi

  if [[ -z "$candidate" ]]; then
    candidate="$APP_BASE_NAME"
  fi

  echo "$candidate"
}

STAGING_APP_NAME="$(build_staging_app_name)"
APP_PROCESS_PATTERN="$STAGING_APP_NAME"

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

echo "==> Building $STAGING_APP_NAME with env file: $ENV_FILE"
(cd "$CLIENT_DIR" && CMUX_APP_NAME="$STAGING_APP_NAME" bun run --env-file "$ENV_FILE" build:mac:workaround)
