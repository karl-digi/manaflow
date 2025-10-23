#!/usr/bin/env bash
set -euo pipefail

# Script to sync local VS Code settings to cmux OpenVSCode instances
# This creates a seed bundle that will be mounted into containers

SEED_DIR="${HOME}/.cmux/vscode-seed"

echo "Syncing VS Code settings to ${SEED_DIR}..."

# Create seed directory
mkdir -p "${SEED_DIR}"

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  VSCODE_USER_DIR="${HOME}/Library/Application Support/Code/User"
  VSCODE_EXT_DIR="${HOME}/.vscode/extensions"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  # Linux
  VSCODE_USER_DIR="${HOME}/.config/Code/User"
  VSCODE_EXT_DIR="${HOME}/.vscode/extensions"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
  # Windows (Git Bash/Cygwin)
  VSCODE_USER_DIR="${APPDATA}/Code/User"
  VSCODE_EXT_DIR="${USERPROFILE}/.vscode/extensions"
else
  echo "Error: Unsupported OS type: $OSTYPE"
  exit 1
fi

# Copy settings.json
if [ -f "${VSCODE_USER_DIR}/settings.json" ]; then
  cp "${VSCODE_USER_DIR}/settings.json" "${SEED_DIR}/settings.json"
  echo "✓ Copied settings.json"
else
  echo "⚠ No settings.json found at ${VSCODE_USER_DIR}/settings.json"
fi

# Copy keybindings.json
if [ -f "${VSCODE_USER_DIR}/keybindings.json" ]; then
  cp "${VSCODE_USER_DIR}/keybindings.json" "${SEED_DIR}/keybindings.json"
  echo "✓ Copied keybindings.json"
else
  echo "⚠ No keybindings.json found at ${VSCODE_USER_DIR}/keybindings.json"
fi

# Copy snippets directory
if [ -d "${VSCODE_USER_DIR}/snippets" ]; then
  mkdir -p "${SEED_DIR}/snippets"
  rsync -a --delete "${VSCODE_USER_DIR}/snippets/" "${SEED_DIR}/snippets/"
  echo "✓ Copied snippets directory"
else
  echo "⚠ No snippets directory found at ${VSCODE_USER_DIR}/snippets"
fi

# Copy extensions
if [ -d "${VSCODE_EXT_DIR}" ]; then
  echo "Copying extensions (this may take a while)..."
  mkdir -p "${SEED_DIR}/extensions"
  rsync -a "${VSCODE_EXT_DIR}/" "${SEED_DIR}/extensions/"
  echo "✓ Copied extensions directory"
else
  echo "⚠ No extensions directory found at ${VSCODE_EXT_DIR}"
fi

# Export extension list as fallback
if command -v code >/dev/null 2>&1; then
  code --list-extensions > "${SEED_DIR}/extensions.txt"
  echo "✓ Exported extension list to extensions.txt"
fi

# Handle profiles (if any)
if [ -d "${VSCODE_USER_DIR}/profiles" ]; then
  echo "Note: VS Code profiles detected. Currently, only default settings are synced."
  echo "If you use a specific profile, consider manually merging its settings into settings.json"
fi

echo ""
echo "✅ VS Code settings synced successfully to ${SEED_DIR}"
echo ""
echo "Next time you start a cmux task, these settings will be automatically loaded"
echo "into the OpenVSCode instance."
echo ""
echo "To update your settings, run this script again:"
echo "  ./scripts/sync-vscode-settings.sh"
