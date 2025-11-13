export const getIsElectron = () => {
  // Prefer explicit bridges exposed by preload
  if (typeof window !== "undefined") {
    const w = window as unknown as { cmux?: unknown; electron?: unknown; process?: { type?: string } };
    if (w.cmux || w.electron) return true;
    // Fallbacks
    if (typeof w.process === "object" && w.process?.type === "renderer") return true;
  }

  if (
    typeof navigator !== "undefined" &&
    typeof navigator.userAgent === "string" &&
    navigator.userAgent.includes("Electron")
  ) {
    return true;
  }

  return false;
};
export const isElectron = getIsElectron();
