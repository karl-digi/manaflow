/**
 * Keyboard shortcut configuration and utilities
 */

export interface ShortcutConfig {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface ShortcutSettings {
  commandPalette: ShortcutConfig;
  sidebarToggle: ShortcutConfig;
}

export const DEFAULT_SHORTCUTS: ShortcutSettings = {
  commandPalette: {
    key: "k",
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  },
  sidebarToggle: {
    key: "s",
    metaKey: false,
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
  },
};

const STORAGE_KEY = "cmux:shortcuts";

/**
 * Load shortcut settings from localStorage
 */
export function loadShortcutSettings(): ShortcutSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return DEFAULT_SHORTCUTS;
    }
    const parsed = JSON.parse(stored) as Partial<ShortcutSettings>;
    return {
      commandPalette: parsed.commandPalette ?? DEFAULT_SHORTCUTS.commandPalette,
      sidebarToggle: parsed.sidebarToggle ?? DEFAULT_SHORTCUTS.sidebarToggle,
    };
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

/**
 * Save shortcut settings to localStorage
 */
export function saveShortcutSettings(settings: ShortcutSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    // Dispatch custom event to notify other components
    window.dispatchEvent(
      new CustomEvent("cmux:shortcuts-changed", { detail: settings })
    );

    // Sync with Electron main process if available
    if (typeof window !== "undefined" && (window as any).cmux?.ui?.updateShortcuts) {
      const electronShortcuts = {
        commandPalette: shortcutConfigToElectronFormat(settings.commandPalette),
        sidebarToggle: shortcutConfigToElectronFormat(settings.sidebarToggle),
      };
      (window as any).cmux.ui.updateShortcuts(electronShortcuts).catch((error: Error) => {
        console.error("Failed to sync shortcuts with Electron:", error);
      });
    }
  } catch (error) {
    console.error("Failed to save shortcut settings:", error);
  }
}

/**
 * Format a shortcut config for display
 */
export function formatShortcut(config: ShortcutConfig): string {
  const parts: string[] = [];
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

  if (config.ctrlKey) parts.push(isMac ? "⌃" : "Ctrl");
  if (config.altKey) parts.push(isMac ? "⌥" : "Alt");
  if (config.shiftKey) parts.push(isMac ? "⇧" : "Shift");
  if (config.metaKey) parts.push(isMac ? "⌘" : "Meta");

  // Capitalize single letter keys
  const displayKey = config.key.length === 1 ? config.key.toUpperCase() : config.key;
  parts.push(displayKey);

  return parts.join(isMac ? "" : "+");
}

/**
 * Check if a keyboard event matches a shortcut config
 */
export function matchesShortcut(
  event: KeyboardEvent,
  config: ShortcutConfig
): boolean {
  return (
    event.key.toLowerCase() === config.key.toLowerCase() &&
    event.metaKey === config.metaKey &&
    event.ctrlKey === config.ctrlKey &&
    event.shiftKey === config.shiftKey &&
    event.altKey === config.altKey
  );
}

/**
 * Validate that a shortcut config is valid and not conflicting with browser defaults
 */
export function validateShortcut(config: ShortcutConfig): {
  valid: boolean;
  error?: string;
} {
  // Check for empty key
  if (!config.key || config.key.trim().length === 0) {
    return { valid: false, error: "Key cannot be empty" };
  }

  // Warn about browser shortcuts (but don't prevent)
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

  // Common browser shortcuts to warn about
  if (config.metaKey && config.key.toLowerCase() === "q") {
    return { valid: false, error: "⌘Q/Ctrl+Q quits the browser" };
  }
  if (config.metaKey && config.key.toLowerCase() === "w") {
    return { valid: false, error: "⌘W/Ctrl+W closes the tab" };
  }
  if (config.metaKey && config.key.toLowerCase() === "t") {
    return { valid: false, error: "⌘T/Ctrl+T opens a new tab" };
  }
  if (config.ctrlKey && config.key.toLowerCase() === "c" && !config.shiftKey && !config.altKey && !config.metaKey) {
    return { valid: false, error: "Ctrl+C is reserved for copy" };
  }
  if (config.ctrlKey && config.key.toLowerCase() === "v" && !config.shiftKey && !config.altKey && !config.metaKey) {
    return { valid: false, error: "Ctrl+V is reserved for paste" };
  }
  if (config.ctrlKey && config.key.toLowerCase() === "x" && !config.shiftKey && !config.altKey && !config.metaKey) {
    return { valid: false, error: "Ctrl+X is reserved for cut" };
  }

  return { valid: true };
}

/**
 * Convert ShortcutConfig to format expected by Electron main process
 */
export function shortcutConfigToElectronFormat(config: ShortcutConfig): {
  key: string;
  meta: boolean;
  control: boolean;
  shift: boolean;
  alt: boolean;
} {
  return {
    key: config.key,
    meta: config.metaKey,
    control: config.ctrlKey,
    shift: config.shiftKey,
    alt: config.altKey,
  };
}
