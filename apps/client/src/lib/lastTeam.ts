const LAST_TEAM_STORAGE_KEY = "cmux:lastTeamSlugOrId" as const;

function safeLocalStorage<T>(
  operation: () => T,
  fallback: T
): T {
  try {
    if (typeof window === "undefined") return fallback;
    return operation();
  } catch (error) {
    console.debug("[lastTeam] localStorage error (e.g., privacy mode):", error);
    return fallback;
  }
}

export function getLastTeamSlugOrId(): string | null {
  return safeLocalStorage(() => {
    const v = window.localStorage.getItem(LAST_TEAM_STORAGE_KEY);
    return v && v.trim().length > 0 ? v : null;
  }, null);
}

export function setLastTeamSlugOrId(value: string): void {
  safeLocalStorage(() => {
    window.localStorage.setItem(LAST_TEAM_STORAGE_KEY, value);
  }, undefined);
}

export function clearLastTeamSlugOrId(): void {
  safeLocalStorage(() => {
    window.localStorage.removeItem(LAST_TEAM_STORAGE_KEY);
  }, undefined);
}

export const LAST_TEAM_KEY = LAST_TEAM_STORAGE_KEY;

