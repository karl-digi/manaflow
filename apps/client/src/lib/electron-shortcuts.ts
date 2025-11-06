/**
 * Utility to notify Electron main process about keyboard shortcut changes
 */
export function notifyElectronShortcutsChanged(
  shortcuts: Record<string, string>
) {
  if (
    typeof window !== "undefined" &&
    "electron" in window &&
    window.electron &&
    typeof window.electron === "object" &&
    "ipcRenderer" in window.electron
  ) {
    // Send shortcuts to Electron main process
    // The main process should listen for this and update its keyboard shortcuts
    const ipcRenderer = (window.electron as { ipcRenderer?: { send: (channel: string, data: unknown) => void } }).ipcRenderer;
    ipcRenderer?.send("shortcuts:update", shortcuts);
  }
}
