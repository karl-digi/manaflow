#!/usr/bin/env bash
set -euo pipefail

# Detect the remote root used by this OpenVSCode build.
HOME_DIR="${HOME:-/root}"
if [ -d "$HOME_DIR/.vscode-remote" ]; then
  REMOTE_ROOT="$HOME_DIR/.vscode-remote"
elif [ -d "$HOME_DIR/.vscode-server" ]; then
  REMOTE_ROOT="$HOME_DIR/.vscode-server"
else
  # Fallback for images that only create this on first run
  REMOTE_ROOT="$HOME_DIR/.vscode-remote"
fi

USER_DATA="$REMOTE_ROOT/data"
MACHINE_DIR="$USER_DATA/Machine"
USER_DIR="$USER_DATA/User"

# Preferred extensions dir for OpenVSCode; fall back if absent later.
EXT_DIR="$HOME_DIR/.openvscode-server/extensions"

mkdir -p "$MACHINE_DIR" "$USER_DIR"

# /cmux/vscode-seed is a read-only mount from the host (see Docker container launch).
SEED="/cmux/vscode-seed"

# 1) Settings: prefer machine settings (browser "User" settings aren't file-backed).
if [ -f "$SEED/settings.json" ]; then
  # Overwrite machine settings completely to keep the source of truth local.
  install -m 0644 "$SEED/settings.json" "$MACHINE_DIR/settings.json"
  echo "Synced settings.json from seed to $MACHINE_DIR/settings.json"
fi

# 2) Keybindings / Snippets (best-effort in User dir)
if [ -f "$SEED/keybindings.json" ]; then
  mkdir -p "$USER_DIR"
  install -m 0644 "$SEED/keybindings.json" "$USER_DIR/keybindings.json" || true
  echo "Synced keybindings.json from seed to $USER_DIR/keybindings.json"
fi

if [ -d "$SEED/snippets" ]; then
  mkdir -p "$USER_DIR/snippets"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$SEED/snippets/" "$USER_DIR/snippets/"
    echo "Synced snippets from seed to $USER_DIR/snippets/"
  else
    echo "Warning: rsync not found, skipping snippets sync"
  fi
fi

# 3) Extensions
if [ -d "$EXT_DIR" ] || mkdir -p "$EXT_DIR"; then
  if [ -d "$SEED/extensions" ]; then
    if command -v rsync >/dev/null 2>&1; then
      rsync -a "$SEED/extensions/" "$EXT_DIR/"
      echo "Synced extensions from seed to $EXT_DIR/"
    else
      echo "Warning: rsync not found, skipping extensions sync"
    fi
  fi
fi

# Optional fallback: install from IDs if the image provides a CLI
# (uncomment if your image supports openvscode-server --install-extension).
# if [ -f "$SEED/extensions.txt" ]; then
#   while read -r ext; do
#     [ -z "$ext" ] && continue
#     /app/openvscode-server/bin/openvscode-server --extensions-dir "$EXT_DIR" --install-extension "$ext" || true
#   done < "$SEED/extensions.txt"
# fi

echo "VS Code settings sync completed from /cmux/vscode-seed"
