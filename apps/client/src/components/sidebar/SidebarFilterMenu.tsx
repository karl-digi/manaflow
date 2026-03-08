import { Dropdown } from "@/components/ui/dropdown";
import { Check } from "lucide-react";
import type {
  OrganizeMode,
  SectionPreferences,
  ShowFilter,
  SortBy,
} from "./sidebar-types";

type SidebarFilterMenuMode = "full" | "show-only" | "organize-only";

interface SidebarFilterMenuProps {
  preferences: SectionPreferences;
  onOrganizeModeChange: (mode: OrganizeMode) => void;
  onSortByChange: (sort: SortBy) => void;
  onShowFilterChange: (filter: ShowFilter) => void;
  mode?: SidebarFilterMenuMode;
}

function Label({ children }: { children: string }) {
  return (
    <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
      {children}
    </div>
  );
}

function Option({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Dropdown.Item
      onClick={onClick}
      className="grid grid-cols-[0.75rem_1fr] items-center gap-2 py-1.5 pr-8 pl-2.5 text-xs"
    >
      <span className="flex items-center justify-center">
        {selected ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
      </span>
      <span>{label}</span>
    </Dropdown.Item>
  );
}

export function SidebarFilterMenu({
  preferences,
  onOrganizeModeChange,
  onSortByChange,
  onShowFilterChange,
  mode = "full",
}: SidebarFilterMenuProps) {
  const showOrganize = mode === "full" || mode === "organize-only";
  const showFilter = mode === "full" || mode === "show-only";

  return (
    <Dropdown.Popup className="min-w-[190px]">
      {showOrganize ? (
        <>
          <Label>Organize</Label>
          <Option
            label="By project"
            selected={preferences.organizeMode === "by-project"}
            onClick={() => onOrganizeModeChange("by-project")}
          />
          <Option
            label="Chronological list"
            selected={preferences.organizeMode === "chronological"}
            onClick={() => onOrganizeModeChange("chronological")}
          />

          <Label>Sort by</Label>
          <Option
            label="Created"
            selected={preferences.sortBy === "created"}
            onClick={() => onSortByChange("created")}
          />
          <Option
            label="Updated"
            selected={preferences.sortBy === "updated"}
            onClick={() => onSortByChange("updated")}
          />
        </>
      ) : null}

      {showFilter ? (
        <>
          {showOrganize ? (
            <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
          ) : null}
          <Label>Show</Label>
          <Option
            label="All threads"
            selected={preferences.showFilter === "all"}
            onClick={() => onShowFilterChange("all")}
          />
          <Option
            label="Relevant"
            selected={preferences.showFilter === "relevant"}
            onClick={() => onShowFilterChange("relevant")}
          />
        </>
      ) : null}
    </Dropdown.Popup>
  );
}
