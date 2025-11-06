import type { BrowserWindow } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";

export interface ShortcutConfig {
  shortcutId: string;
  displayName: string;
  description?: string;
  keybinding: string;
  defaultKeybinding: string;
}

interface ParsedShortcut {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}

// Default shortcuts
export const DEFAULT_SHORTCUTS: Record<string, ShortcutConfig> = {
  command_palette: {
    shortcutId: "command_palette",
    displayName: "Command Palette",
    description: "Open command palette",
    keybinding: "Cmd+K",
    defaultKeybinding: "Cmd+K",
  },
  sidebar_toggle: {
    shortcutId: "sidebar_toggle",
    displayName: "Toggle Sidebar",
    description: "Show or hide the sidebar",
    keybinding: "Ctrl+Shift+S",
    defaultKeybinding: "Ctrl+Shift+S",
  },
};

let cachedShortcuts: Record<string, ShortcutConfig> = { ...DEFAULT_SHORTCUTS };

// Parse a keybinding string like "Cmd+K" or "Ctrl+Shift+S"
export function parseKeybinding(keybinding: string): ParsedShortcut {
  const parts = keybinding.split("+").map((p) => p.trim());
  const result: ParsedShortcut = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    key: "",
  };

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") {
      result.ctrl = true;
    } else if (lower === "shift") {
      result.shift = true;
    } else if (lower === "alt" || lower === "option") {
      result.alt = true;
    } else if (lower === "cmd" || lower === "meta" || lower === "command") {
      result.meta = true;
    } else {
      result.key = lower;
    }
  }

  return result;
}

// Check if input matches a parsed shortcut
export function matchesShortcut(
  input: {
    key: string;
    control?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  },
  shortcut: ParsedShortcut
): boolean {
  if (input.key.toLowerCase() !== shortcut.key) return false;
  if (Boolean(input.control) !== shortcut.ctrl) return false;
  if (Boolean(input.shift) !== shortcut.shift) return false;
  if (Boolean(input.alt) !== shortcut.alt) return false;
  if (Boolean(input.meta) !== shortcut.meta) return false;
  return true;
}

// Load shortcuts from userData directory
function loadShortcutsFromFile(): Record<string, ShortcutConfig> | null {
  try {
    const userDataPath = app.getPath("userData");
    const shortcutsFilePath = path.join(userDataPath, "keyboard-shortcuts.json");

    if (fs.existsSync(shortcutsFilePath)) {
      const data = fs.readFileSync(shortcutsFilePath, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Failed to load shortcuts from file:", error);
  }
  return null;
}

// Save shortcuts to userData directory
export function saveShortcutsToFile(shortcuts: Record<string, ShortcutConfig>): void {
  try {
    const userDataPath = app.getPath("userData");
    const shortcutsFilePath = path.join(userDataPath, "keyboard-shortcuts.json");

    fs.writeFileSync(shortcutsFilePath, JSON.stringify(shortcuts, null, 2), "utf-8");
    cachedShortcuts = shortcuts;
  } catch (error) {
    console.error("Failed to save shortcuts to file:", error);
  }
}

// Initialize shortcuts (called on app start)
export function initShortcuts(): void {
  const loaded = loadShortcutsFromFile();
  if (loaded) {
    cachedShortcuts = { ...DEFAULT_SHORTCUTS, ...loaded };
  }
}

// Get current shortcuts
export function getShortcuts(): Record<string, ShortcutConfig> {
  return cachedShortcuts;
}

// Get a specific shortcut
export function getShortcut(shortcutId: string): ShortcutConfig {
  return cachedShortcuts[shortcutId] || DEFAULT_SHORTCUTS[shortcutId];
}

// Update shortcuts (called when user changes settings)
export function updateShortcuts(shortcuts: Record<string, ShortcutConfig>): void {
  cachedShortcuts = { ...DEFAULT_SHORTCUTS, ...shortcuts };
  saveShortcutsToFile(cachedShortcuts);
}

// Get parsed shortcut for matching
export function getParsedShortcut(shortcutId: string): ParsedShortcut | null {
  const shortcut = getShortcut(shortcutId);
  if (!shortcut) return null;

  // On macOS, convert Cmd to Meta, on other platforms use Ctrl
  const isMac = process.platform === "darwin";
  let keybinding = shortcut.keybinding;

  // Normalize keybinding for platform
  if (isMac) {
    // On Mac, if keybinding has Ctrl, interpret it as Meta
    keybinding = keybinding.replace(/Ctrl/gi, "Cmd");
  } else {
    // On other platforms, if keybinding has Cmd, interpret it as Ctrl
    keybinding = keybinding.replace(/Cmd|Command/gi, "Ctrl");
  }

  return parseKeybinding(keybinding);
}
