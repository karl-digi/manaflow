export type OrganizeMode = "by-project" | "chronological";
export type SortBy = "created" | "updated";
export type ShowFilter = "all" | "relevant";

export interface SidebarPreferences {
  organizeMode: OrganizeMode;
  sortBy: SortBy;
  showFilter: ShowFilter;
}

export interface SectionPreferences extends SidebarPreferences {
  collapsedGroups: Record<string, boolean>;
  expandedGroups: Record<string, boolean>;
}

export interface SidebarPreferenceHandlers {
  setOrganizeMode: (mode: OrganizeMode) => void;
  setSortBy: (sortBy: SortBy) => void;
  setShowFilter: (showFilter: ShowFilter) => void;
  toggleGroupCollapsed: (groupKey: string) => void;
  toggleGroupExpanded: (groupKey: string) => void;
}

export const SIDEBAR_PR_PREFS_KEY = "cmux:sidebar-pr-preferences";
export const SIDEBAR_WS_PREFS_KEY = "cmux:sidebar-ws-preferences";

export const DEFAULT_SECTION_PREFERENCES: SectionPreferences = {
  organizeMode: "by-project",
  sortBy: "created",
  showFilter: "relevant",
  collapsedGroups: {},
  expandedGroups: {},
};
