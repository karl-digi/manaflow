# VS Code Settings Sync

This document explains how to sync your local VS Code settings, keybindings, snippets, and extensions to cmux's OpenVSCode instances.

## Overview

When you run coding tasks with cmux, each task gets an isolated OpenVSCode instance in a Docker container. By default, these instances use basic settings. With VS Code settings sync, your personal configuration (themes, extensions, keybindings, etc.) is automatically loaded into each new instance.

## Quick Start

### 1. Sync Your Settings

Run the sync script to copy your local VS Code configuration:

```bash
./scripts/sync-vscode-settings.sh
```

This creates a "seed bundle" at `~/.cmux/vscode-seed/` containing:
- `settings.json` - Your VS Code settings
- `keybindings.json` - Your custom keybindings
- `snippets/` - Your code snippets
- `extensions/` - Your installed extensions
- `extensions.txt` - List of extension IDs (fallback)

### 2. Start a Task

The next time you start a cmux task, your settings will be automatically loaded into the OpenVSCode instance. No additional configuration needed!

## What Gets Synced

### Settings
Your entire `settings.json` is synced, including:
- Theme (color theme and icon theme)
- Editor preferences (font, tab size, etc.)
- Language-specific settings
- Extension configurations

### Keybindings
All your custom keyboard shortcuts from `keybindings.json`.

### Snippets
All your custom code snippets from the `snippets/` directory.

### Extensions
All extensions from your `~/.vscode/extensions` directory, including:
- Themes
- Language support
- Linters and formatters
- Any other installed extensions

## Platform Support

The sync script automatically detects your operating system:

- **macOS**: `~/Library/Application Support/Code/User`
- **Linux**: `~/.config/Code/User`
- **Windows**: `%APPDATA%\Code\User`

## Updating Your Settings

To update the synced settings (e.g., after installing new extensions or changing your theme):

```bash
./scripts/sync-vscode-settings.sh
```

Changes take effect in the next task run.

## How It Works

### Architecture

1. **Seed Directory**: `~/.cmux/vscode-seed/` on your host machine
2. **Container Mount**: Mounted as `/cmux/vscode-seed` (read-only) in each container
3. **Bootstrap Script**: `/usr/local/lib/cmux/openvscode-entrypoint.sh` copies files to the right locations
4. **OpenVSCode Paths**:
   - Machine settings: `~/.openvscode-server/data/Machine/settings.json`
   - User directory: `~/.openvscode-server/data/User/`
   - Extensions: `~/.openvscode-server/extensions/`

### Execution Flow

1. Container starts with systemd
2. `configure-openvscode` service runs
3. Detects `/cmux/vscode-seed` mount
4. Calls `openvscode-entrypoint.sh` to sync settings
5. OpenVSCode server starts with your configuration

### Why Machine Settings?

OpenVSCode stores "User" settings in browser LocalStorage, which can't be preseeded from files. Instead, we use "Machine" settings, which are stored on the server and work identically for remote sessions.

## Troubleshooting

### Settings Not Loading

Check the container logs to verify the sync ran:

```bash
docker logs cmux-<taskRunId>
```

Look for messages like:
```
Found VS Code seed directory, syncing settings...
Synced settings.json from seed to /root/.openvscode-server/data/Machine/settings.json
```

### Extensions Not Appearing

Extensions may take a moment to load after OpenVSCode starts. If they still don't appear:

1. Check that the extensions directory exists: `ls ~/.cmux/vscode-seed/extensions`
2. Verify extensions were copied: Run sync script again with verbose output
3. Check OpenVSCode extension logs in the built-in terminal

### Theme Not Applied

Make sure your theme extension is included in the synced extensions, and that your `settings.json` includes:

```json
{
  "workbench.colorTheme": "Your Theme Name",
  "workbench.iconTheme": "your-icon-theme"
}
```

### Permissions Issues

The seed directory is mounted read-only. If you see permission errors:

```bash
chmod -R u+r ~/.cmux/vscode-seed
```

## Advanced Configuration

### Excluding Extensions

To exclude specific extensions from syncing, remove them from `~/.cmux/vscode-seed/extensions/` after running the sync script.

### Custom Seed Location

To use a different seed location, modify `apps/server/src/vscode/DockerVSCodeInstance.ts`:

```typescript
const vscodeSeedDir = path.join(homeDir, ".cmux", "vscode-seed");
// Change to your preferred location
```

### Profiles

If you use VS Code Profiles, note that only default settings are currently synced. To use a specific profile's settings:

1. Export the profile settings: `code --export-profile ProfileName`
2. Copy the settings to `~/.cmux/vscode-seed/settings.json`
3. Run the sync script

## Files Modified

This feature required changes to:

- `Dockerfile` - Added rsync package, copied entrypoint script
- `configs/systemd/bin/openvscode-entrypoint.sh` - New bootstrap script
- `configs/systemd/bin/configure-openvscode` - Calls entrypoint if seed exists
- `apps/server/src/vscode/DockerVSCodeInstance.ts` - Mounts seed directory
- `scripts/sync-vscode-settings.sh` - User-facing sync script

## References

- [OpenVSCode Server](https://github.com/gitpod-io/openvscode-server)
- [VS Code Settings Sync](https://code.visualstudio.com/docs/editor/settings-sync)
- [VS Code User Directory](https://code.visualstudio.com/docs/getstarted/settings#_settings-file-locations)
