import { api } from "@cmux/convex/api";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export interface ShortcutConfig {
  shortcutId: string;
  displayName: string;
  description?: string;
  keybinding: string;
  defaultKeybinding: string;
}

// Default shortcuts as fallback
const DEFAULT_SHORTCUTS: Record<string, ShortcutConfig> = {
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

const SHORTCUTS_STORAGE_KEY = "cmux:keyboard-shortcuts";

export function useKeyboardShortcuts() {
  const params = useParams({ strict: false }) as { teamSlugOrId?: string };
  const teamSlugOrId = params?.teamSlugOrId;

  const [shortcuts, setShortcuts] = useState<Record<string, ShortcutConfig>>(() => {
    // Try to load from localStorage first
    try {
      const stored = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error("Failed to load shortcuts from localStorage:", e);
    }
    return DEFAULT_SHORTCUTS;
  });

  // Query shortcuts from server if we have a team
  const { data: serverShortcuts } = useQuery(
    teamSlugOrId
      ? convexQuery(api.keyboardShortcuts.getAll, { teamSlugOrId })
      : { enabled: false }
  );

  // Update shortcuts when server data changes
  useEffect(() => {
    if (serverShortcuts) {
      const shortcutsMap: Record<string, ShortcutConfig> = {};
      for (const shortcut of serverShortcuts) {
        shortcutsMap[shortcut.shortcutId] = {
          shortcutId: shortcut.shortcutId,
          displayName: shortcut.displayName,
          description: shortcut.description,
          keybinding: shortcut.keybinding,
          defaultKeybinding: shortcut.defaultKeybinding,
        };
      }

      // Save to localStorage
      try {
        localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(shortcutsMap));
      } catch (e) {
        console.error("Failed to save shortcuts to localStorage:", e);
      }

      setShortcuts(shortcutsMap);

      // Notify Electron main process of shortcut changes
      if (typeof window !== "undefined" && (window as { cmux?: { shortcuts?: { update: (shortcuts: Record<string, ShortcutConfig>) => Promise<{ ok: boolean; error?: string }> } } }).cmux?.shortcuts?.update) {
        (window as { cmux: { shortcuts: { update: (shortcuts: Record<string, ShortcutConfig>) => Promise<{ ok: boolean; error?: string }> } } }).cmux.shortcuts.update(shortcutsMap).catch((err) => {
          console.error("Failed to update Electron shortcuts:", err);
        });
      }
    }
  }, [serverShortcuts]);

  const getShortcut = (shortcutId: string): ShortcutConfig => {
    return shortcuts[shortcutId] || DEFAULT_SHORTCUTS[shortcutId];
  };

  return {
    shortcuts,
    getShortcut,
  };
}

// Parse a keybinding string like "Cmd+K" or "Ctrl+Shift+S" into key parts
export function parseKeybinding(keybinding: string) {
  const parts = keybinding.split("+").map((p) => p.trim());
  const result = {
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

// Check if a keyboard event matches a keybinding
export function matchesKeybinding(event: KeyboardEvent, keybinding: string): boolean {
  const parsed = parseKeybinding(keybinding);
  const eventKey = event.key.toLowerCase();
  const eventCode = event.code.toLowerCase();

  // Check modifiers
  if (parsed.ctrl !== event.ctrlKey) return false;
  if (parsed.shift !== event.shiftKey) return false;
  if (parsed.alt !== event.altKey) return false;
  if (parsed.meta !== event.metaKey) return false;

  // Check key - support both event.key and event.code
  const keyMatches =
    eventKey === parsed.key ||
    eventCode === `key${parsed.key}` ||
    (parsed.key === "k" && eventKey === "k");

  return keyMatches;
}
