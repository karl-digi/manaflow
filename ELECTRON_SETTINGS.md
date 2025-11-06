# Electron Settings System

This document describes the electron settings system implemented in cmux, including the auto-update draft releases feature.

## Overview

The settings system uses `electron-store` to persist user preferences locally. Settings are stored in the user's application data directory and can be accessed from both the main process and renderer process via IPC.

## Architecture

### Main Process (`electron/main/`)

- **`app-settings.ts`**: Core settings module that manages the electron-store instance
  - Defines the `AppSettings` interface
  - Provides functions to get/set settings: `getSettings()`, `getSetting()`, `setSetting()`, `updateSettings()`
  - Settings are encrypted with a key for basic security

- **`index.ts`**: Main electron process file
  - Imports and initializes the settings store on app startup
  - Registers IPC handlers for settings operations:
    - `cmux:settings:get`: Returns all current settings
    - `cmux:settings:update`: Updates one or more settings
  - Wires settings to electron-updater (see Auto-Update Integration below)

### Preload (`electron/preload/index.ts`)

Exposes a safe API to the renderer process:

```typescript
window.cmux.settings = {
  get: () => Promise<{ ok: boolean; settings?: AppSettings }>,
  update: (settings: Partial<AppSettings>) => Promise<{ ok: boolean }>
}
```

### Types (`src/types/electron.d.ts`)

TypeScript definitions for the settings API available in the renderer.

## Available Settings

### `allowDraftReleases` (boolean)

Controls whether the app should auto-update to draft releases on GitHub.

- **Default**: `false`
- **Effect**: When enabled, `autoUpdater.allowPrerelease` is set to `true`, allowing the app to update to draft/pre-release versions
- **When changed**: The updater immediately checks for new updates with the updated setting

## Auto-Update Integration

The settings system is fully integrated with electron-updater:

1. **On app startup** (`setupAutoUpdates()` in `index.ts:528-533`):
   - Reads `allowDraftReleases` from settings store
   - Sets `autoUpdater.allowPrerelease` accordingly
   - Logs the configuration

2. **When setting is changed** (IPC handler in `index.ts:456-470`):
   - Updates `autoUpdater.allowPrerelease` immediately
   - Triggers an update check to apply the new setting
   - Logs the change

## Usage Examples

### From Renderer Process (React Component)

See `src/examples/electron-settings-usage.tsx` for a complete example.

Basic usage:

```typescript
// Get settings
const result = await window.cmux.settings.get();
if (result.ok && result.settings) {
  console.log("Allow draft releases:", result.settings.allowDraftReleases);
}

// Update settings
const updateResult = await window.cmux.settings.update({
  allowDraftReleases: true
});
if (updateResult.ok) {
  console.log("Settings updated successfully");
}
```

### From Main Process

```typescript
import { getSettings, updateSettings, getSetting, setSetting } from "./app-settings";

// Get all settings
const settings = getSettings();

// Get a specific setting
const allowDraft = getSetting("allowDraftReleases");

// Update a specific setting
setSetting("allowDraftReleases", true);

// Update multiple settings
updateSettings({ allowDraftReleases: false });
```

## Storage Location

Settings are stored in:
- **macOS**: `~/Library/Application Support/cmux/app-settings.json`
- **Windows**: `%APPDATA%\cmux\app-settings.json`
- **Linux**: `~/.config/cmux/app-settings.json`

The file is encrypted using electron-store's encryption feature.

## Adding New Settings

To add a new setting:

1. **Update the `AppSettings` interface** in `electron/main/app-settings.ts`:
   ```typescript
   export interface AppSettings {
     allowDraftReleases: boolean;
     myNewSetting: string; // Add your new setting
   }
   ```

2. **Update the default values**:
   ```typescript
   const DEFAULT_SETTINGS: AppSettings = {
     allowDraftReleases: false,
     myNewSetting: "default value",
   };
   ```

3. **Update TypeScript types** in `src/types/electron.d.ts`:
   ```typescript
   settings: {
     get: () =>
       Promise<{
         ok: boolean;
         settings?: {
           allowDraftReleases: boolean;
           myNewSetting: string; // Add here
         };
       }>;
     update: (settings: {
       allowDraftReleases?: boolean;
       myNewSetting?: string; // And here
     }) => Promise<{ ok: boolean; reason?: string }>;
   };
   ```

4. **Update the preload API** in `electron/preload/index.ts` to match the types.

5. **(Optional)** Add logic in the IPC handler to respond to the setting change if needed.

## Testing

The implementation has been type-checked and all checks pass. To verify:

```bash
cd /root/workspace/cmux
bun run check
```

## Implementation Notes

- Settings are initialized **before** the auto-updater setup to ensure the correct value is available
- IPC handlers are registered during app initialization
- Changes to `allowDraftReleases` trigger an immediate update check (only in packaged apps)
- All setting operations are logged for debugging
- Errors are caught and returned as `{ ok: false, reason: string }` responses
