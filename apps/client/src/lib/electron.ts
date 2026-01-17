import type { CmuxAPI } from "@/types/electron";

export const getIsElectron = () => {
  // Only return true if running in the cmux Electron app with proper IPC bridge.
  // We explicitly check for the cmux-specific IPC methods to avoid false positives
  // in other Electron apps (like Cursor's embedded browser).
  if (typeof window !== "undefined") {
    const w = window as unknown as {
      cmux?: { register?: unknown; rpc?: unknown; on?: unknown };
    };
    // Check that cmux has the required IPC methods from the preload script
    if (
      w.cmux &&
      typeof w.cmux.register === "function" &&
      typeof w.cmux.rpc === "function" &&
      typeof w.cmux.on === "function"
    ) {
      return true;
    }
  }

  return false;
};
export const isElectron = getIsElectron();

/**
 * Safely access the Electron bridge (window.cmux) in contexts where it may not exist.
 * Returns undefined in non-Electron environments.
 */
export function getElectronBridge(): CmuxAPI | undefined {
  if (!isElectron || !("cmux" in window)) return undefined;
  return window.cmux;
}
