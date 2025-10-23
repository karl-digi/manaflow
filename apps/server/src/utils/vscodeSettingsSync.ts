/**
 * VSCode Settings Sync Utility
 *
 * This module provides functionality to sync VSCode/Cursor settings from the user's
 * local machine to openvscode instances running in Docker containers.
 *
 * Features:
 * - Detects VSCode/Cursor settings from standard locations (macOS, Linux, Windows)
 * - Reads and parses settings.json and keybindings.json
 * - Filters out platform-specific or container-incompatible settings
 * - Prepares settings for mounting into Docker containers
 * - Supports settings merging with container defaults via configure-openvscode script
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { dockerLogger } from "./fileLogger";

/**
 * VSCode/Cursor settings directory locations for different platforms
 */
function getVSCodeSettingsPaths(): string[] {
  const homeDir = os.homedir();
  const platform = os.platform();

  const paths: string[] = [];

  if (platform === "darwin") {
    // macOS paths
    paths.push(
      path.join(homeDir, "Library/Application Support/Code/User"),
      path.join(homeDir, "Library/Application Support/Cursor/User"),
      path.join(homeDir, "Library/Application Support/Code - Insiders/User")
    );
  } else if (platform === "linux") {
    // Linux paths
    paths.push(
      path.join(homeDir, ".config/Code/User"),
      path.join(homeDir, ".config/Cursor/User"),
      path.join(homeDir, ".config/Code - Insiders/User")
    );
  } else if (platform === "win32") {
    // Windows paths
    paths.push(
      path.join(homeDir, "AppData/Roaming/Code/User"),
      path.join(homeDir, "AppData/Roaming/Cursor/User"),
      path.join(homeDir, "AppData/Roaming/Code - Insiders/User")
    );
  }

  return paths;
}

/**
 * Finds the first existing VSCode settings directory
 */
export async function findVSCodeSettingsDir(): Promise<string | null> {
  const paths = getVSCodeSettingsPaths();

  for (const settingsPath of paths) {
    try {
      const settingsFile = path.join(settingsPath, "settings.json");
      await fs.promises.access(settingsFile, fs.constants.R_OK);
      dockerLogger.info(`Found VSCode settings at: ${settingsPath}`);
      return settingsPath;
    } catch {
      // Try next path
    }
  }

  dockerLogger.warn(
    "No VSCode/Cursor settings found in standard locations. Checked:",
    paths
  );
  return null;
}

/**
 * Reads and parses VSCode settings.json
 */
export async function readVSCodeSettings(
  settingsDir: string
): Promise<Record<string, unknown> | null> {
  try {
    const settingsFile = path.join(settingsDir, "settings.json");
    const content = await fs.promises.readFile(settingsFile, "utf8");

    // VSCode settings.json can have comments, but JSON.parse doesn't support them
    // We'll use a simple approach to strip comments
    const strippedContent = stripJsonComments(content);
    return JSON.parse(strippedContent) as Record<string, unknown>;
  } catch (error) {
    dockerLogger.error(`Failed to read VSCode settings from ${settingsDir}:`, error);
    return null;
  }
}

/**
 * Simple JSON comment stripper for VSCode settings
 * Handles // and /* comments
 */
function stripJsonComments(jsonString: string): string {
  // Remove single-line comments
  let result = jsonString.replace(/\/\/.*$/gm, "");
  // Remove multi-line comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, "");
  return result;
}

/**
 * Reads keybindings from VSCode settings directory
 */
export async function readVSCodeKeybindings(
  settingsDir: string
): Promise<unknown[] | null> {
  try {
    const keybindingsFile = path.join(settingsDir, "keybindings.json");
    await fs.promises.access(keybindingsFile, fs.constants.R_OK);
    const content = await fs.promises.readFile(keybindingsFile, "utf8");
    const strippedContent = stripJsonComments(content);
    return JSON.parse(strippedContent) as unknown[];
  } catch {
    // Keybindings file doesn't exist or can't be read
    return null;
  }
}

/**
 * Prepares VSCode settings for sync to container
 * Filters out settings that may not work in the container environment
 */
export async function prepareSettingsForContainer(
  settingsDir: string
): Promise<{
  settings: Record<string, unknown>;
  keybindings: unknown[] | null;
} | null> {
  const settings = await readVSCodeSettings(settingsDir);
  if (!settings) {
    return null;
  }

  // Filter out settings that don't work in a container/remote environment
  const filteredSettings = { ...settings };

  // Settings to remove (platform-specific or not applicable in container)
  const keysToRemove = [
    // macOS specific
    "terminal.integrated.macOptionClickForcesSelection",
    "terminal.integrated.macOptionIsMeta",
    // Windows specific
    "terminal.integrated.windowsEnableConpty",
    // Telemetry
    "telemetry.enableTelemetry",
    "telemetry.enableCrashReporter",
    // Update settings
    "update.mode",
    "update.channel",
    // Local file paths that won't exist in container
    "git.path",
    "terminal.integrated.shell.windows",
    "terminal.integrated.shell.osx",
  ];

  for (const key of keysToRemove) {
    delete filteredSettings[key];
  }

  // Read keybindings
  const keybindings = await readVSCodeKeybindings(settingsDir);

  return {
    settings: filteredSettings,
    keybindings,
  };
}

/**
 * Writes settings and keybindings to a temporary directory for mounting
 */
export async function writeSettingsToTempDir(
  instanceId: string,
  settings: Record<string, unknown>,
  keybindings: unknown[] | null
): Promise<string> {
  const tempDir = path.join(os.tmpdir(), "cmux-vscode-settings");
  await fs.promises.mkdir(tempDir, { recursive: true });

  const instanceSettingsDir = path.join(tempDir, instanceId);
  await fs.promises.mkdir(instanceSettingsDir, { recursive: true });

  // Write settings.json
  const settingsFile = path.join(instanceSettingsDir, "settings.json");
  await fs.promises.writeFile(
    settingsFile,
    JSON.stringify(settings, null, 2),
    "utf8"
  );

  // Write keybindings.json if available
  if (keybindings) {
    const keybindingsFile = path.join(instanceSettingsDir, "keybindings.json");
    await fs.promises.writeFile(
      keybindingsFile,
      JSON.stringify(keybindings, null, 2),
      "utf8"
    );
  }

  dockerLogger.info(
    `Wrote VSCode settings to temp directory: ${instanceSettingsDir}`
  );
  return instanceSettingsDir;
}

/**
 * Main function to get VSCode settings ready for container mounting
 * Returns the path to a temporary directory containing settings files
 */
export async function getVSCodeSettingsForContainer(
  instanceId: string
): Promise<string | null> {
  const settingsDir = await findVSCodeSettingsDir();
  if (!settingsDir) {
    dockerLogger.info("No local VSCode settings found, using container defaults");
    return null;
  }

  const prepared = await prepareSettingsForContainer(settingsDir);
  if (!prepared) {
    dockerLogger.warn("Failed to prepare VSCode settings for container");
    return null;
  }

  const tempDir = await writeSettingsToTempDir(
    instanceId,
    prepared.settings,
    prepared.keybindings
  );

  return tempDir;
}
