import { useCallback, useEffect, useState } from "react";
import type {
  OrganizeMode,
  SectionPreferences,
  ShowFilter,
  SortBy,
} from "./sidebar-types";
import { DEFAULT_SECTION_PREFERENCES } from "./sidebar-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toBooleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean"
    )
  );
}

function parseStoredPreferences(raw: string | null): SectionPreferences {
  if (!raw) {
    return {
      ...DEFAULT_SECTION_PREFERENCES,
      collapsedGroups: {},
      expandedGroups: {},
    };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("Invalid sidebar preference shape");
    }

    const organizeMode: OrganizeMode =
      parsed.organizeMode === "chronological" ? "chronological" : "by-project";
    const sortBy: SortBy = parsed.sortBy === "updated" ? "updated" : "created";
    const showFilter: ShowFilter = parsed.showFilter === "all" ? "all" : "relevant";

    return {
      organizeMode,
      sortBy,
      showFilter,
      collapsedGroups: toBooleanRecord(parsed.collapsedGroups),
      expandedGroups: toBooleanRecord(parsed.expandedGroups),
    };
  } catch {
    return {
      ...DEFAULT_SECTION_PREFERENCES,
      collapsedGroups: {},
      expandedGroups: {},
    };
  }
}

export function useSidebarPreferences(storageKey: string) {
  const [preferences, setPreferences] = useState<SectionPreferences>(() =>
    parseStoredPreferences(localStorage.getItem(storageKey))
  );

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(preferences));
  }, [preferences, storageKey]);

  const setOrganizeMode = useCallback((mode: OrganizeMode) => {
    setPreferences((prev) => ({ ...prev, organizeMode: mode }));
  }, []);

  const setSortBy = useCallback((sortBy: SortBy) => {
    setPreferences((prev) => ({ ...prev, sortBy }));
  }, []);

  const setShowFilter = useCallback((showFilter: ShowFilter) => {
    setPreferences((prev) => ({ ...prev, showFilter }));
  }, []);

  const toggleGroupCollapsed = useCallback((groupKey: string) => {
    setPreferences((prev) => ({
      ...prev,
      collapsedGroups: {
        ...prev.collapsedGroups,
        [groupKey]: !(prev.collapsedGroups[groupKey] ?? false),
      },
    }));
  }, []);

  const toggleGroupExpanded = useCallback((groupKey: string) => {
    setPreferences((prev) => ({
      ...prev,
      expandedGroups: {
        ...prev.expandedGroups,
        [groupKey]: !(prev.expandedGroups[groupKey] ?? false),
      },
    }));
  }, []);

  return {
    preferences,
    setOrganizeMode,
    setSortBy,
    setShowFilter,
    toggleGroupCollapsed,
    toggleGroupExpanded,
  };
}
