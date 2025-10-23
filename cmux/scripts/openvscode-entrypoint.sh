#!/usr/bin/env bash
set -euo pipefail

HOME_DIR="${HOME:-/root}"
SEED="${CMUX_VSCODE_SEED:-/cmux/vscode}"
VSCODE_BIN_DEFAULT="/app/openvscode-server/bin/openvscode-server"
if [ -x "${CMUX_OPENVSCODE_BIN:-}" ]; then
  VSCODE_BIN="${CMUX_OPENVSCODE_BIN}"
elif [ -x "$VSCODE_BIN_DEFAULT" ]; then
  VSCODE_BIN="$VSCODE_BIN_DEFAULT"
elif [ -x "/opt/cmux/openvscode-server/bin/openvscode-server" ]; then
  VSCODE_BIN="/opt/cmux/openvscode-server/bin/openvscode-server"
else
  echo "openvscode-server binary not found" >&2
  exit 1
fi

if [ -d "$HOME_DIR/.vscode-remote" ]; then
  REMOTE_ROOT="$HOME_DIR/.vscode-remote"
elif [ -d "$HOME_DIR/.vscode-server" ]; then
  REMOTE_ROOT="$HOME_DIR/.vscode-server"
else
  REMOTE_ROOT="$HOME_DIR/.vscode-remote"
fi

USER_DATA="$REMOTE_ROOT/data"
MACHINE_DIR="$USER_DATA/Machine"
USER_DIR="$USER_DATA/User"
mkdir -p "$MACHINE_DIR" "$USER_DIR"

EXT_DIR_CANDIDATES=(
  "$HOME_DIR/.openvscode-server/extensions"
  "$HOME_DIR/.vscode-server/extensions"
  "$HOME_DIR/.vscode-remote/extensions"
)
EXT_DIR=""
for candidate in "${EXT_DIR_CANDIDATES[@]}"; do
  base_dir=$(dirname "$candidate")
  if [ -z "$EXT_DIR" ] && [ -d "$base_dir" ]; then
    EXT_DIR="$candidate"
  fi
done
if [ -z "$EXT_DIR" ]; then
  EXT_DIR="${EXT_DIR_CANDIDATES[0]}"
fi
mkdir -p "$EXT_DIR"

copy_tree() {
  local src="$1"
  local dest="$2"
  mkdir -p "$dest"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$src/" "$dest/"
  else
    find "$dest" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
    cp -a "$src/." "$dest/"
  fi
}

if [ -f "$SEED/settings.json" ]; then
  install -m 0644 "$SEED/settings.json" "$MACHINE_DIR/settings.json"
fi

if [ -f "$SEED/keybindings.json" ]; then
  mkdir -p "$USER_DIR"
  install -m 0644 "$SEED/keybindings.json" "$USER_DIR/keybindings.json" || true
fi

if [ -d "$SEED/snippets" ]; then
  copy_tree "$SEED/snippets" "$USER_DIR/snippets"
fi

if [ -d "$SEED/extensions" ]; then
  copy_tree "$SEED/extensions" "$EXT_DIR"
fi

exec "$VSCODE_BIN" \
  --host 0.0.0.0 \
  --user-data-dir "$REMOTE_ROOT" \
  --extensions-dir "$EXT_DIR" \
  "$@"
