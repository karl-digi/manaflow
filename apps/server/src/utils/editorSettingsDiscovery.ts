import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface VSCodeSettings {
  settingsJson?: string;
  keybindingsJson?: string;
  snippetsDir?: string;
  extensionsJson?: string;
}

/**
 * Discover VSCode settings from the user's local machine
 */
export async function discoverVSCodeSettings(): Promise<VSCodeSettings> {
  const homeDir = os.homedir();
  const platform = os.platform();

  // Determine VSCode settings directory based on platform
  const settingsPaths = getVSCodeSettingsPaths(homeDir, platform);

  const result: VSCodeSettings = {};

  for (const settingsPath of settingsPaths) {
    try {
      await fs.promises.access(settingsPath, fs.constants.F_OK);

      // Read settings.json
      const settingsFile = path.join(settingsPath, "settings.json");
      try {
        const settingsContent = await fs.promises.readFile(settingsFile, "utf8");
        result.settingsJson = settingsContent;
      } catch {
        // settings.json doesn't exist, skip
      }

      // Read keybindings.json
      const keybindingsFile = path.join(settingsPath, "keybindings.json");
      try {
        const keybindingsContent = await fs.promises.readFile(
          keybindingsFile,
          "utf8"
        );
        result.keybindingsJson = keybindingsContent;
      } catch {
        // keybindings.json doesn't exist, skip
      }

      // Read extensions.json (for extension recommendations)
      const extensionsFile = path.join(settingsPath, "extensions.json");
      try {
        const extensionsContent = await fs.promises.readFile(
          extensionsFile,
          "utf8"
        );
        result.extensionsJson = extensionsContent;
      } catch {
        // extensions.json doesn't exist, skip
      }

      // Note snippets directory location
      const snippetsDir = path.join(settingsPath, "snippets");
      try {
        await fs.promises.access(snippetsDir, fs.constants.F_OK);
        result.snippetsDir = snippetsDir;
      } catch {
        // snippets directory doesn't exist, skip
      }

      // If we found settings, return them
      if (result.settingsJson) {
        return result;
      }
    } catch {
      // This path doesn't exist, try next one
      continue;
    }
  }

  return result;
}

/**
 * Get possible VSCode settings paths based on platform
 */
function getVSCodeSettingsPaths(
  homeDir: string,
  platform: NodeJS.Platform
): string[] {
  const paths: string[] = [];

  switch (platform) {
    case "darwin": // macOS
      paths.push(
        path.join(homeDir, "Library", "Application Support", "Code", "User")
      );
      paths.push(
        path.join(
          homeDir,
          "Library",
          "Application Support",
          "Code - Insiders",
          "User"
        )
      );
      paths.push(
        path.join(
          homeDir,
          "Library",
          "Application Support",
          "VSCodium",
          "User"
        )
      );
      break;

    case "win32": // Windows
      paths.push(path.join(homeDir, "AppData", "Roaming", "Code", "User"));
      paths.push(
        path.join(homeDir, "AppData", "Roaming", "Code - Insiders", "User")
      );
      paths.push(path.join(homeDir, "AppData", "Roaming", "VSCodium", "User"));
      break;

    case "linux": // Linux
      paths.push(path.join(homeDir, ".config", "Code", "User"));
      paths.push(path.join(homeDir, ".config", "Code - Insiders", "User"));
      paths.push(path.join(homeDir, ".config", "VSCodium", "User"));
      // Also check legacy location
      paths.push(path.join(homeDir, ".vscode", "User"));
      break;

    default:
      // Fallback to common Linux path
      paths.push(path.join(homeDir, ".config", "Code", "User"));
      break;
  }

  return paths;
}

/**
 * Filter VSCode settings to remove host-specific or problematic configurations
 */
export function filterVSCodeSettings(settingsJson: string): string {
  try {
    const settings = JSON.parse(settingsJson);

    // Remove or modify settings that don't work well in containers
    const filteredSettings = { ...settings };

    // Remove window-related settings that might not apply
    delete filteredSettings["window.titleBarStyle"];
    delete filteredSettings["window.nativeTabs"];
    delete filteredSettings["window.nativeFullScreen"];

    // Remove update-related settings (updates disabled in containers)
    delete filteredSettings["update.mode"];
    delete filteredSettings["update.enableWindowsBackgroundUpdates"];

    // Remove telemetry settings (telemetry disabled in containers)
    delete filteredSettings["telemetry.enableCrashReporter"];
    delete filteredSettings["telemetry.enableTelemetry"];

    // Remove hardware acceleration settings
    delete filteredSettings["window.enableMenuBarMnemonics"];

    // Remove macOS-specific settings
    delete filteredSettings["terminal.integrated.macOptionIsMeta"];
    delete filteredSettings["terminal.integrated.macOptionClickForcesSelection"];

    // Remove Windows-specific settings
    delete filteredSettings["terminal.integrated.windowsEnableConpty"];

    // Adjust terminal shell paths that might not exist in container
    if (filteredSettings["terminal.integrated.shell.linux"]) {
      // Keep it, but we'll override in configure-openvscode if needed
    }

    // Remove absolute paths that won't exist in container
    if (filteredSettings["git.path"] && path.isAbsolute(filteredSettings["git.path"])) {
      delete filteredSettings["git.path"];
    }

    return JSON.stringify(filteredSettings, null, 2);
  } catch (error) {
    // If parsing fails, return original
    return settingsJson;
  }
}

/**
 * Merge user settings with default container settings
 */
export function mergeVSCodeSettings(
  userSettings: string,
  defaultSettings: string
): string {
  try {
    const user = JSON.parse(userSettings);
    const defaults = JSON.parse(defaultSettings);

    // Default settings take precedence for critical container functionality
    const merged = {
      ...user,
      ...defaults,
    };

    return JSON.stringify(merged, null, 2);
  } catch (error) {
    // If parsing fails, return default settings
    return defaultSettings;
  }
}
