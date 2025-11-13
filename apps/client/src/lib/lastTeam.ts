const LAST_TEAM_STORAGE_KEY = "cmux:lastTeamSlugOrId" as const;

export function getLastTeamSlugOrId(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const v = window.localStorage.getItem(LAST_TEAM_STORAGE_KEY);
    return v && v.trim().length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function setLastTeamSlugOrId(value: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LAST_TEAM_STORAGE_KEY, value);
  } catch {
    // ignore storage errors (e.g., privacy mode)
  }
}

export function clearLastTeamSlugOrId(): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(LAST_TEAM_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export const LAST_TEAM_KEY = LAST_TEAM_STORAGE_KEY;

