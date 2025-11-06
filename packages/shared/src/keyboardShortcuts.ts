export interface KeyboardShortcut {
  key: string;
  label: string;
  description: string;
  defaultValue: string;
  electronOnly?: boolean;
}

export const DEFAULT_SHORTCUTS = {
  commandPalette: "mod+k",
  toggleSidebar: "ctrl+shift+s",
  reloadPreview: "mod+r",
  focusPreviewAddressBar: "mod+l",
  previewBack: "mod+[",
  previewForward: "mod+]",
} as const;

export const SHORTCUTS_CONFIG: Record<
  keyof typeof DEFAULT_SHORTCUTS,
  KeyboardShortcut
> = {
  commandPalette: {
    key: "commandPalette",
    label: "Command Palette",
    description: "Toggle command palette",
    defaultValue: DEFAULT_SHORTCUTS.commandPalette,
  },
  toggleSidebar: {
    key: "toggleSidebar",
    label: "Toggle Sidebar",
    description: "Show/hide sidebar",
    defaultValue: DEFAULT_SHORTCUTS.toggleSidebar,
    electronOnly: true,
  },
  reloadPreview: {
    key: "reloadPreview",
    label: "Reload Preview",
    description: "Reload preview pane",
    defaultValue: DEFAULT_SHORTCUTS.reloadPreview,
    electronOnly: true,
  },
  focusPreviewAddressBar: {
    key: "focusPreviewAddressBar",
    label: "Focus Preview Address Bar",
    description: "Focus preview address bar",
    defaultValue: DEFAULT_SHORTCUTS.focusPreviewAddressBar,
    electronOnly: true,
  },
  previewBack: {
    key: "previewBack",
    label: "Preview Back",
    description: "Navigate back in preview",
    defaultValue: DEFAULT_SHORTCUTS.previewBack,
    electronOnly: true,
  },
  previewForward: {
    key: "previewForward",
    label: "Preview Forward",
    description: "Navigate forward in preview",
    defaultValue: DEFAULT_SHORTCUTS.previewForward,
    electronOnly: true,
  },
};

/**
 * Parse a shortcut string (e.g., "mod+k", "ctrl+shift+s") into its components
 */
export function parseShortcut(shortcut: string): {
  mod: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
} {
  const parts = shortcut.toLowerCase().split("+");
  const key = parts[parts.length - 1] || "";
  const modifiers = parts.slice(0, -1);

  return {
    mod: modifiers.includes("mod"),
    ctrl: modifiers.includes("ctrl"),
    shift: modifiers.includes("shift"),
    alt: modifiers.includes("alt"),
    key,
  };
}

/**
 * Check if a keyboard event matches a shortcut string
 */
export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: string
): boolean {
  const parsed = parseShortcut(shortcut);
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  // "mod" means Meta on Mac, Ctrl on other platforms
  const modPressed = parsed.mod ? (isMac ? event.metaKey : event.ctrlKey) : true;
  const ctrlPressed = parsed.ctrl ? event.ctrlKey : !event.ctrlKey;
  const shiftPressed = parsed.shift ? event.shiftKey : !event.shiftKey;
  const altPressed = parsed.alt ? event.altKey : !event.altKey;

  // Handle special key mappings
  let eventKey = event.key.toLowerCase();
  if (eventKey === "arrowup") eventKey = "up";
  if (eventKey === "arrowdown") eventKey = "down";
  if (eventKey === "arrowleft") eventKey = "left";
  if (eventKey === "arrowright") eventKey = "right";

  return (
    modPressed &&
    ctrlPressed &&
    shiftPressed &&
    altPressed &&
    eventKey === parsed.key
  );
}

/**
 * Format a shortcut for display (e.g., "mod+k" -> "⌘K" on Mac or "Ctrl+K" on others)
 */
export function formatShortcutForDisplay(shortcut: string): string {
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const parsed = parseShortcut(shortcut);

  const parts: string[] = [];
  if (parsed.mod) parts.push(isMac ? "⌘" : "Ctrl");
  if (parsed.ctrl && !parsed.mod) parts.push("Ctrl");
  if (parsed.shift) parts.push(isMac ? "⇧" : "Shift");
  if (parsed.alt) parts.push(isMac ? "⌥" : "Alt");
  parts.push(parsed.key.toUpperCase());

  return parts.join(isMac ? "" : "+");
}
