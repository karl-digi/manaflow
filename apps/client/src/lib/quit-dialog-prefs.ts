const QUIT_DIALOG_STORAGE_KEY = "quitDialogDontShowAgain";

/**
 * Check if the quit confirmation dialog should be shown
 * @returns true if the dialog should be shown, false if user disabled it
 */
export function shouldShowQuitDialog(): boolean {
  try {
    const stored = localStorage.getItem(QUIT_DIALOG_STORAGE_KEY);
    return stored !== "true";
  } catch {
    return true;
  }
}

/**
 * Set the user's preference for showing the quit dialog
 * @param dontShow - If true, dialog will not be shown on Cmd+Q
 */
export function setQuitDialogDontShowAgain(dontShow: boolean): void {
  try {
    if (dontShow) {
      localStorage.setItem(QUIT_DIALOG_STORAGE_KEY, "true");
    } else {
      localStorage.removeItem(QUIT_DIALOG_STORAGE_KEY);
    }
  } catch (error) {
    console.error("Failed to save quit dialog preference:", error);
  }
}
