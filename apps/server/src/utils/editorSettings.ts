import type { AuthFile } from "@cmux/shared/worker-schemas";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { type EditorId, macAppBin, pathExists } from "./editorDetection";
import { serverLogger } from "./fileLogger";

const execFileAsync = promisify(execFile);

export type { EditorId };

interface EditorDef {
  id: EditorId;
  labels: string[];
  cliCandidates: string[];
  extDirs: string[];
}

interface FileExport {
  path: string;
  content: string;
  mtimeMs?: number;
}

/**
 * Represents an extension entry that may optionally include a version.
 * Format: `publisher.name` or `publisher.name@version`
 */
export interface ExtensionSpec {
  id: string;
  version?: string;
}

interface EditorExport {
  id: EditorId;
  userDir: string;
  settings?: FileExport;
  keybindings?: FileExport;
  snippets: FileExport[];
  extensions?: string[];
  settingsMtimeMs?: number;
}

export interface EditorSettingsUpload {
  authFiles: AuthFile[];
  startupCommands: string[];
  sourceEditor: EditorId;
  settingsPath?: string;
}

// User-uploaded settings from Convex (web UI)
export interface UserUploadedEditorSettings {
  settingsJson?: string;
  keybindingsJson?: string;
  snippets?: Array<{ name: string; content: string }>;
  extensions?: string; // newline-separated extension IDs
}

export interface LocalVSCodeSettingsSnapshot {
  settingsJson?: string;
  keybindingsJson?: string;
  snippets: Array<{ name: string; content: string }>;
  settingsPath?: string;
}

const homeDir = os.homedir();
const posix = path.posix;

// IDE Provider path configurations
type IdeProvider = "coder" | "openvscode" | "cmux-code";

interface IdePaths {
  userDir: string;
  profileDir: string | null;
  machineDir: string;
  snippetsDir: string;
  extensionsDir: string;
  binaryPath: string;
}

const IDE_PATHS: Record<IdeProvider, IdePaths> = {
  coder: {
    userDir: "/root/.code-server/User",
    profileDir: null, // Coder doesn't use profiles
    machineDir: "/root/.code-server/Machine",
    snippetsDir: "/root/.code-server/User/snippets",
    extensionsDir: "/root/.code-server/extensions",
    binaryPath: "/app/code-server/bin/code-server",
  },
  openvscode: {
    userDir: "/root/.openvscode-server/data/User",
    profileDir: "/root/.openvscode-server/data/User/profiles/default-profile",
    machineDir: "/root/.openvscode-server/data/Machine",
    snippetsDir: "/root/.openvscode-server/data/User/snippets",
    extensionsDir: "/root/.openvscode-server/extensions",
    binaryPath: "/app/openvscode-server/bin/openvscode-server",
  },
  "cmux-code": {
    userDir: "/root/.vscode-server-oss/data/User",
    profileDir: "/root/.vscode-server-oss/data/User/profiles/default-profile",
    machineDir: "/root/.vscode-server-oss/data/Machine",
    snippetsDir: "/root/.vscode-server-oss/data/User/snippets",
    extensionsDir: "/root/.vscode-server-oss/extensions",
    binaryPath: "/app/cmux-code/bin/code-server-oss",
  },
};

const CMUX_INTERNAL_DIR = "/root/.cmux";
const EXTENSION_LIST_PATH = posix.join(CMUX_INTERNAL_DIR, "user-extensions.txt");

/**
 * Parse an extension entry into its ID and optional version.
 * Supports formats: `publisher.name` or `publisher.name@version`
 */
export function parseExtensionSpec(entry: string): ExtensionSpec {
  const atIndex = entry.lastIndexOf("@");
  // Only treat as versioned if @ is not at start and there's something after it
  if (atIndex > 0 && atIndex < entry.length - 1) {
    return {
      id: entry.slice(0, atIndex),
      version: entry.slice(atIndex + 1),
    };
  }
  return { id: entry };
}

/**
 * Format an ExtensionSpec back to string format.
 */
export function formatExtensionSpec(spec: ExtensionSpec): string {
  return spec.version ? `${spec.id}@${spec.version}` : spec.id;
}

/**
 * Deduplicate extension entries with version-aware precedence.
 * Rules:
 * - Key by extension ID (case-insensitive)
 * - If both versioned and unversioned exist for same ID, keep versioned
 * - If multiple versioned entries exist for same ID, keep first encountered
 */
export function deduplicateExtensions(entries: string[]): string[] {
  // Store both spec and pre-computed lowercase key to avoid redundant toLowerCase() calls
  const seen = new Map<string, { spec: ExtensionSpec; lowerKey: string }>();

  for (const entry of entries) {
    const spec = parseExtensionSpec(entry);
    const lowerKey = spec.id.toLowerCase();
    const existing = seen.get(lowerKey);

    if (!existing) {
      // First occurrence - keep it
      seen.set(lowerKey, { spec, lowerKey });
    } else if (spec.version && !existing.spec.version) {
      // New entry has version, existing doesn't - prefer versioned
      seen.set(lowerKey, { spec, lowerKey });
    }
    // Otherwise: keep existing (first versioned wins, or first unversioned if no version)
  }

  // Sort using pre-computed lowercase keys for performance
  const sortedEntries = Array.from(seen.values()).sort((a, b) =>
    a.lowerKey.localeCompare(b.lowerKey)
  );
  return sortedEntries.map(({ spec }) => formatExtensionSpec(spec));
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedResult:
  | {
      timestamp: number;
      value: EditorSettingsUpload | null;
    }
  | null = null;
let inflightPromise: Promise<EditorSettingsUpload | null> | null = null;

const editors: EditorDef[] = [
  {
    id: "vscode",
    labels: ["Code", "Code - Insiders", "VSCodium"],
    cliCandidates: [
      "code",
      "code-insiders",
      "codium",
      macAppBin("Visual Studio Code", "code"),
      macAppBin("Visual Studio Code - Insiders", "code-insiders"),
      macAppBin("VSCodium", "codium"),
    ],
    extDirs: [
      path.join(homeDir, ".vscode", "extensions"),
      path.join(homeDir, ".vscode-insiders", "extensions"),
      path.join(homeDir, ".vscodium", "extensions"),
    ],
  },
  {
    id: "cursor",
    labels: ["Cursor"],
    cliCandidates: ["cursor", macAppBin("Cursor", "cursor")],
    extDirs: [path.join(homeDir, ".cursor", "extensions")],
  },
  {
    id: "windsurf",
    labels: ["Windsurf"],
    cliCandidates: ["windsurf", macAppBin("Windsurf", "windsurf")],
    extDirs: [path.join(homeDir, ".windsurf", "extensions")],
  },
];

function candidateUserDir(appFolderName: string): string {
  if (process.platform === "darwin") {
    return path.join(
      homeDir,
      "Library",
      "Application Support",
      appFolderName,
      "User"
    );
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
    return path.join(appData, appFolderName, "User");
  }
  return path.join(homeDir, ".config", appFolderName, "User");
}


async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => path.join(dir, entry.name));
  } catch (error) {
    serverLogger.debug(`[EditorSettings] Failed to list JSON files in ${dir}:`, error);
    return [];
  }
}

/**
 * TOCTOU-safe file reading: directly attempts to read instead of checking existence first.
 * Returns null if the file doesn't exist or isn't accessible.
 */
async function tryReadFileWithStats(
  filePath: string
): Promise<{ content: string; mtimeMs: number } | null> {
  try {
    const [content, stats] = await Promise.all([
      fs.readFile(filePath, "utf8"),
      fs.stat(filePath),
    ]);
    return { content, mtimeMs: stats.mtimeMs };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT" && err.code !== "EACCES") {
      serverLogger.debug(`[EditorSettings] Unexpected error reading ${filePath}:`, error);
    }
    return null;
  }
}

/**
 * TOCTOU-safe file reading: directly attempts to read instead of checking existence first.
 * Returns null if the file doesn't exist or isn't accessible.
 */
async function tryReadFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT" && err.code !== "EACCES") {
      serverLogger.debug(`[EditorSettings] Unexpected error reading ${filePath}:`, error);
    }
    return null;
  }
}

async function runCliListExtensions(
  cliCandidates: string[]
): Promise<string[] | undefined> {
  for (const cli of cliCandidates) {
    try {
      if (!cli) continue;
      if (path.isAbsolute(cli) && !(await pathExists(cli))) {
        continue;
      }
      const { stdout } = await execFileAsync(
        cli,
        ["--list-extensions", "--show-versions"],
        {
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
          timeout: 5000,
        }
      );
      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      // Preserve version info - use deduplication to handle duplicates properly
      if (lines.length > 0) {
        return deduplicateExtensions(lines);
      }
    } catch (error) {
      serverLogger.debug(`[EditorSettings] CLI ${cli} failed to list extensions:`, error);
    }
  }
  return undefined;
}

async function listExtensionsFromDirs(
  dirs: string[]
): Promise<string[] | undefined> {
  const identifiers = new Set<string>();

  // Process all directories in parallel
  const processDir = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // Directory doesn't exist or isn't readable - skip silently
      return;
    }

    // Process all package.json files in parallel within each directory
    const extensionEntries = entries.filter(
      (entry) => entry.isDirectory() || entry.isSymbolicLink()
    );

    await Promise.all(
      extensionEntries.map(async (entry) => {
        const packageJsonPath = path.join(dir, entry.name, "package.json");
        const content = await tryReadFile(packageJsonPath);
        if (content) {
          try {
            const pkg = JSON.parse(content) as { publisher?: string; name?: string };
            if (pkg.publisher && pkg.name) {
              identifiers.add(`${pkg.publisher}.${pkg.name}`);
            }
          } catch {
            // Invalid JSON - skip silently
          }
        }
      })
    );
  };

  await Promise.all(dirs.map(processDir));

  if (identifiers.size === 0) {
    return undefined;
  }
  return Array.from(identifiers).sort();
}

async function exportEditor(def: EditorDef): Promise<EditorExport | null> {
  // Check all candidate user directories in parallel
  const candidates = def.labels.map((label) => candidateUserDir(label));
  const existenceResults = await Promise.all(candidates.map(pathExists));
  const userDirIndex = existenceResults.findIndex((exists) => exists);

  if (userDirIndex < 0) {
    return null;
  }
  const userDir = candidates[userDirIndex]!;

  const result: EditorExport = {
    id: def.id,
    userDir,
    snippets: [],
  };

  const settingsPath = path.join(userDir, "settings.json");
  const keybindingsPath = path.join(userDir, "keybindings.json");
  const snippetsDir = path.join(userDir, "snippets");

  // Read settings, keybindings, and list snippets in parallel (TOCTOU-safe)
  const [settingsResult, keybindingsContent, snippetFiles] = await Promise.all([
    tryReadFileWithStats(settingsPath),
    tryReadFile(keybindingsPath),
    listJsonFiles(snippetsDir),
  ]);

  if (settingsResult) {
    result.settings = {
      path: settingsPath,
      content: settingsResult.content,
      mtimeMs: settingsResult.mtimeMs,
    };
    result.settingsMtimeMs = settingsResult.mtimeMs;
  }

  if (keybindingsContent) {
    result.keybindings = {
      path: keybindingsPath,
      content: keybindingsContent,
    };
  }

  // Read all snippet files in parallel
  if (snippetFiles.length > 0) {
    const snippetContents = await Promise.all(
      snippetFiles.map(async (snippetFile) => {
        const content = await tryReadFile(snippetFile);
        return content ? { path: snippetFile, content } : null;
      })
    );
    result.snippets = snippetContents.filter(
      (s): s is FileExport => s !== null
    );
  }

  let extensions = await runCliListExtensions(def.cliCandidates);
  if (!extensions) {
    extensions = await listExtensionsFromDirs(def.extDirs);
  }
  if (extensions && extensions.length > 0) {
    result.extensions = extensions;
  }

  if (
    !result.settings &&
    !result.keybindings &&
    result.snippets.length === 0 &&
    !result.extensions
  ) {
    return null;
  }

  return result;
}

function encode(content: string): string {
  return Buffer.from(content).toString("base64");
}

function buildExtensionInstallCommand(listPath: string): string {
  // Build a script that auto-detects IDE provider from /etc/cmux/ide.env
  // Version-aware installation:
  // - For id@version: install exact version with --force
  // - For id without version: skip if already installed, install if missing
  const scriptBody = [
    "set -euo pipefail",
    `EXT_LIST="${listPath}"`,
    "mkdir -p /root/.cmux",
    'LOG_FILE="/root/.cmux/install-extensions.log"',
    'touch "$LOG_FILE"',
    'if [ ! -s "$EXT_LIST" ]; then echo "No extensions to install (list empty)" >>"$LOG_FILE"; exit 0; fi',
    "",
    "# Detect IDE provider from env file",
    'IDE_PROVIDER="openvscode"',
    'if [ -f /etc/cmux/ide.env ]; then',
    '  . /etc/cmux/ide.env',
    "fi",
    "",
    '# Set paths based on IDE provider',
    'if [ "$IDE_PROVIDER" = "coder" ]; then',
    '  EXT_DIR="/root/.code-server/extensions"',
    '  USER_DIR="/root/.code-server"',
    '  CLI_PATH="/app/code-server/bin/code-server"',
    'elif [ "$IDE_PROVIDER" = "cmux-code" ]; then',
    '  EXT_DIR="/root/.vscode-server-oss/extensions"',
    '  USER_DIR="/root/.vscode-server-oss/data"',
    '  CLI_PATH="/app/cmux-code/bin/code-server-oss"',
    "else",
    '  EXT_DIR="/root/.openvscode-server/extensions"',
    '  USER_DIR="/root/.openvscode-server/data"',
    '  CLI_PATH="/app/openvscode-server/bin/openvscode-server"',
    "fi",
    "",
    '# Fallback CLI detection',
    'if [ ! -x "$CLI_PATH" ]; then',
    '  if [ -x /app/cmux-code/bin/code-server-oss ]; then',
    '    CLI_PATH="/app/cmux-code/bin/code-server-oss"',
    '    EXT_DIR="/root/.vscode-server-oss/extensions"',
    '    USER_DIR="/root/.vscode-server-oss/data"',
    '  elif [ -x /app/code-server/bin/code-server ]; then',
    '    CLI_PATH="/app/code-server/bin/code-server"',
    '    EXT_DIR="/root/.code-server/extensions"',
    '    USER_DIR="/root/.code-server"',
    '  elif [ -x /app/openvscode-server/bin/openvscode-server ]; then',
    '    CLI_PATH="/app/openvscode-server/bin/openvscode-server"',
    '    EXT_DIR="/root/.openvscode-server/extensions"',
    '    USER_DIR="/root/.openvscode-server/data"',
    "  fi",
    "fi",
    "",
    'if [ ! -x "$CLI_PATH" ]; then',
    '  echo "No IDE CLI found in standard locations" >>"$LOG_FILE"',
    "  exit 0",
    "fi",
    "",
    'echo "Installing extensions with $CLI_PATH (provider: $IDE_PROVIDER)" >>"$LOG_FILE"',
    'chmod +x "$CLI_PATH" || true',
    'mkdir -p "$EXT_DIR" "$USER_DIR"',
    "",
    "# Get list of currently installed extensions (id@version format)",
    'INSTALLED_CACHE="$("$CLI_PATH" --list-extensions --show-versions --extensions-dir "$EXT_DIR" --user-data-dir "$USER_DIR" 2>/dev/null || true)"',
    "",
    "# Function to check if extension is installed (case-insensitive ID match)",
    "is_installed() {",
    '  local ext_id="$1"',
    '  echo "$INSTALLED_CACHE" | grep -qi "^${ext_id}@" || echo "$INSTALLED_CACHE" | grep -qi "^${ext_id}$"',
    "}",
    "",
    "# Function to get installed version of an extension",
    "get_installed_version() {",
    '  local ext_id="$1"',
    '  echo "$INSTALLED_CACHE" | grep -i "^${ext_id}@" | head -1 | sed "s/^[^@]*@//"',
    "}",
    "",
    'ext=""',
    'processed_any=0',
    'had_failure=0',
    "",
    "# Process extensions sequentially to avoid race conditions on extension metadata",
    'while IFS= read -r ext; do',
    '  [ -z "$ext" ] && continue',
    '  processed_any=1',
    "",
    "  # Parse extension entry: id or id@version",
    '  if [[ "$ext" == *@* ]]; then',
    '    ext_id="${ext%@*}"',
    '    ext_version="${ext##*@}"',
    '    has_version=1',
    "  else",
    '    ext_id="$ext"',
    '    ext_version=""',
    '    has_version=0',
    "  fi",
    "",
    '  if [ "$has_version" -eq 1 ]; then',
    "    # Versioned entry: install exact version with --force (PIN behavior)",
    '    current_ver=$(get_installed_version "$ext_id" || true)',
    '    if [ "$current_ver" = "$ext_version" ]; then',
    '      echo "SKIP $ext_id@$ext_version (already pinned)" >>"$LOG_FILE"',
    "    else",
    '      echo "PIN $ext_id@$ext_version (was: ${current_ver:-not installed})" >>"$LOG_FILE"',
    '      if ! "$CLI_PATH" --install-extension "$ext" --force --extensions-dir "$EXT_DIR" --user-data-dir "$USER_DIR" >>"$LOG_FILE" 2>&1; then',
    '        echo "FAILED to pin $ext" >>"$LOG_FILE"',
    '        had_failure=1',
    "      fi",
    "    fi",
    "  else",
    "    # Unversioned entry: skip if any version is installed, install if missing",
    '    if is_installed "$ext_id"; then',
    '      current_ver=$(get_installed_version "$ext_id" || true)',
    '      echo "SKIP $ext_id (installed: ${current_ver:-unknown})" >>"$LOG_FILE"',
    "    else",
    '      echo "INSTALL $ext_id (missing)" >>"$LOG_FILE"',
    '      if ! "$CLI_PATH" --install-extension "$ext_id" --extensions-dir "$EXT_DIR" --user-data-dir "$USER_DIR" >>"$LOG_FILE" 2>&1; then',
    '        echo "FAILED to install $ext_id" >>"$LOG_FILE"',
    '        had_failure=1',
    "      fi",
    "    fi",
    "  fi",
    'done < "$EXT_LIST"',
    "",
    'if [ "$processed_any" -eq 0 ]; then',
    '  echo "No valid extension identifiers found" >>"$LOG_FILE"',
    "fi",
    'if [ "$had_failure" -ne 0 ]; then',
    '  echo "One or more extensions failed to install" >>"$LOG_FILE"',
    "fi",
  ].join("\n");

  return [
    "set -euo pipefail",
    'INSTALL_SCRIPT="$(mktemp /tmp/cmux-install-extensions-XXXXXX.sh)"',
    'trap \'rm -f "$INSTALL_SCRIPT"\' EXIT',
    'cat <<\'EOF\' >"$INSTALL_SCRIPT"',
    scriptBody,
    "EOF",
    'bash "$INSTALL_SCRIPT"',
  ].join("\n");
}

// Helper: Get all settings.json target paths across IDE providers
function getSettingsTargetPaths(): string[] {
  return [
    // cmux-code paths
    posix.join(IDE_PATHS["cmux-code"].userDir, "settings.json"),
    posix.join(
      IDE_PATHS["cmux-code"].profileDir ?? IDE_PATHS["cmux-code"].userDir,
      "settings.json"
    ),
    posix.join(IDE_PATHS["cmux-code"].machineDir, "settings.json"),
    // OpenVSCode paths
    posix.join(IDE_PATHS.openvscode.userDir, "settings.json"),
    posix.join(
      IDE_PATHS.openvscode.profileDir ?? IDE_PATHS.openvscode.userDir,
      "settings.json"
    ),
    posix.join(IDE_PATHS.openvscode.machineDir, "settings.json"),
    // Coder paths
    posix.join(IDE_PATHS.coder.userDir, "settings.json"),
    posix.join(IDE_PATHS.coder.machineDir, "settings.json"),
  ];
}

// Helper: Add settings.json auth files for all IDE providers
function addSettingsAuthFiles(authFiles: AuthFile[], settingsContent: string): void {
  const encodedSettings = encode(settingsContent);
  for (const destinationPath of getSettingsTargetPaths()) {
    authFiles.push({
      destinationPath,
      contentBase64: encodedSettings,
      mode: "644",
    });
  }
}

// Helper: Add keybindings.json auth files for all IDE providers
function addKeybindingsAuthFiles(authFiles: AuthFile[], keybindingsContent: string): void {
  const encodedKeybindings = encode(keybindingsContent);
  const userDirs = [
    IDE_PATHS["cmux-code"].userDir,
    IDE_PATHS.openvscode.userDir,
    IDE_PATHS.coder.userDir,
  ];
  for (const userDir of userDirs) {
    authFiles.push({
      destinationPath: posix.join(userDir, "keybindings.json"),
      contentBase64: encodedKeybindings,
      mode: "644",
    });
  }
}

// Helper: Add a snippet auth file for all IDE providers
function addSnippetAuthFiles(authFiles: AuthFile[], name: string, content: string): void {
  const encodedSnippet = encode(content);
  const snippetsDirs = [
    IDE_PATHS["cmux-code"].snippetsDir,
    IDE_PATHS.openvscode.snippetsDir,
    IDE_PATHS.coder.snippetsDir,
  ];
  for (const snippetsDir of snippetsDirs) {
    authFiles.push({
      destinationPath: posix.join(snippetsDir, name),
      contentBase64: encodedSnippet,
      mode: "644",
    });
  }
}

// Helper: Build the background extension installer wrapper script
function buildBackgroundInstallerWrapper(installScript: string): string {
  return `#!/bin/bash
# Background extension installer - runs once per container

LOCK_FILE="/root/.cmux/extensions-install.lock"
DONE_FILE="/root/.cmux/extensions-installed"

# Skip if already done
[ -f "$DONE_FILE" ] && exit 0

# Skip if already running
[ -f "$LOCK_FILE" ] && exit 0

# Create lock file
touch "$LOCK_FILE"

# Run installation in detached background
(
  ${installScript}
  touch "$DONE_FILE"
  rm -f "$LOCK_FILE"
) > /root/.cmux/install-extensions-background.log 2>&1 &
`;
}

// Helper: Build the profile.d hook for auto-triggering extension installation
function buildProfileHook(installScriptPath: string): string {
  return `# cmux: Auto-trigger extension installation in background (non-blocking)
(
  if [ -f "${installScriptPath}" ]; then
    nohup "${installScriptPath}" >/dev/null 2>&1 &
  fi
) >/dev/null 2>&1 &
`;
}

// Helper: Add extension installation auth files and startup commands
function addExtensionInstallationFiles(
  authFiles: AuthFile[],
  startupCommands: string[],
  extensionList: string[]
): void {
  const uniqueExtensions = deduplicateExtensions(extensionList);
  const extensionContent = `${uniqueExtensions.join("\n")}\n`;
  authFiles.push({
    destinationPath: EXTENSION_LIST_PATH,
    contentBase64: encode(extensionContent),
    mode: "644",
  });

  const installScriptPath = "/root/.cmux/install-extensions-background.sh";
  const installScript = buildExtensionInstallCommand(EXTENSION_LIST_PATH);
  const backgroundWrapper = buildBackgroundInstallerWrapper(installScript);

  authFiles.push({
    destinationPath: installScriptPath,
    contentBase64: encode(backgroundWrapper),
    mode: "755",
  });

  authFiles.push({
    destinationPath: "/etc/profile.d/cmux-extensions.sh",
    contentBase64: encode(buildProfileHook(installScriptPath)),
    mode: "644",
  });

  startupCommands.push(`bash "${installScriptPath}" || true`);
}

/**
 * Build EditorSettingsUpload from user-uploaded settings (web UI)
 * This converts user-provided JSON strings into authFiles for the sandbox
 */
function buildUploadFromUserSettings(
  userSettings: UserUploadedEditorSettings
): EditorSettingsUpload | null {
  const authFiles: AuthFile[] = [];
  const startupCommands: string[] = [];

  if (userSettings.settingsJson) {
    addSettingsAuthFiles(authFiles, userSettings.settingsJson);
  }

  if (userSettings.keybindingsJson) {
    addKeybindingsAuthFiles(authFiles, userSettings.keybindingsJson);
  }

  if (userSettings.snippets && userSettings.snippets.length > 0) {
    for (const snippet of userSettings.snippets) {
      if (!snippet.name || !snippet.content) continue;
      // Sanitize filename to prevent path traversal attacks
      const sanitizedName = posix.basename(snippet.name);
      if (!sanitizedName) continue;
      addSnippetAuthFiles(authFiles, sanitizedName, snippet.content);
    }
  }

  if (userSettings.extensions) {
    const extensionList = userSettings.extensions
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (extensionList.length > 0) {
      addExtensionInstallationFiles(authFiles, startupCommands, extensionList);
    }
  }

  if (authFiles.length === 0 && startupCommands.length === 0) {
    return null;
  }

  return {
    authFiles,
    startupCommands,
    sourceEditor: "vscode" as EditorId, // User-uploaded settings don't have a specific source
    settingsPath: undefined,
  };
}

function buildUpload(editor: EditorExport): EditorSettingsUpload | null {
  const authFiles: AuthFile[] = [];
  const startupCommands: string[] = [];

  if (editor.settings) {
    addSettingsAuthFiles(authFiles, editor.settings.content);
  }

  if (editor.keybindings) {
    addKeybindingsAuthFiles(authFiles, editor.keybindings.content);
  }

  if (editor.snippets.length > 0) {
    for (const snippet of editor.snippets) {
      const name = posix.basename(snippet.path);
      if (!name) continue;
      addSnippetAuthFiles(authFiles, name, snippet.content);
    }
  }

  if (editor.extensions && editor.extensions.length > 0) {
    addExtensionInstallationFiles(authFiles, startupCommands, editor.extensions);
  }

  if (authFiles.length === 0 && startupCommands.length === 0) {
    return null;
  }

  return {
    authFiles,
    startupCommands,
    sourceEditor: editor.id,
    settingsPath: editor.settings?.path,
  };
}

async function collectEditorSettings(): Promise<EditorSettingsUpload | null> {
  const results = await Promise.all(editors.map((def) => exportEditor(def)));
  const available = results.filter(
    (result): result is EditorExport => result !== null
  );

  if (available.length === 0) {
    return null;
  }

  available.sort(
    (a, b) => (b.settingsMtimeMs ?? -Infinity) - (a.settingsMtimeMs ?? -Infinity)
  );
  const selected =
    available.find((editor) => editor.settings) ?? available[0] ?? null;

  if (!selected) {
    return null;
  }

  const upload = buildUpload(selected);
  if (!upload) {
    return null;
  }

  serverLogger.info(
    `[EditorSettings] Selected ${upload.sourceEditor} settings${
      upload.settingsPath ? ` from ${upload.settingsPath}` : ""
    }`
  );

  return upload;
}

/**
 * Get editor settings upload.
 * If userUploadedSettings is provided, it overrides auto-detected settings.
 * Otherwise, auto-detection is used (with caching).
 */
export async function getEditorSettingsUpload(
  userUploadedSettings?: UserUploadedEditorSettings | null
): Promise<EditorSettingsUpload | null> {
  // If user uploaded settings are provided, use them (no caching - they come from DB)
  if (userUploadedSettings) {
    const hasAnySettings =
      userUploadedSettings.settingsJson ||
      userUploadedSettings.keybindingsJson ||
      (userUploadedSettings.snippets && userUploadedSettings.snippets.length > 0) ||
      userUploadedSettings.extensions;

    if (hasAnySettings) {
      serverLogger.info("[EditorSettings] Using user-uploaded settings from web UI");
      return buildUploadFromUserSettings(userUploadedSettings);
    }
  }

  // Fall back to auto-detection (with caching)
  if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL_MS) {
    return cachedResult.value;
  }
  if (!inflightPromise) {
    inflightPromise = collectEditorSettings()
      .then((value) => {
        cachedResult = { timestamp: Date.now(), value };
        inflightPromise = null;
        return value;
      })
      .catch((error) => {
        inflightPromise = null;
        serverLogger.warn(
          "[EditorSettings] Failed to collect editor settings",
          error
        );
        cachedResult = { timestamp: Date.now(), value: null };
        return null;
      });
  }
  return inflightPromise;
}

export async function getLocalVSCodeSettingsSnapshot(): Promise<LocalVSCodeSettingsSnapshot | null> {
  const vscodeDef = editors.find((editor) => editor.id === "vscode");
  if (!vscodeDef) {
    return null;
  }

  const exported = await exportEditor(vscodeDef);
  if (!exported) {
    return null;
  }

  const snippets = exported.snippets
    .map((snippet) => {
      const name = posix.basename(snippet.path);
      if (!name) {
        return null;
      }
      return { name, content: snippet.content };
    })
    .filter(
      (snippet): snippet is { name: string; content: string } =>
        snippet !== null
    );

  const settingsJson = exported.settings?.content;
  const keybindingsJson = exported.keybindings?.content;

  if (!settingsJson && !keybindingsJson && snippets.length === 0) {
    return null;
  }

  return {
    settingsJson,
    keybindingsJson,
    snippets,
    settingsPath: exported.settings?.path,
  };
}
