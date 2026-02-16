import { Dropdown } from "@/components/ui/dropdown";
import { Link, type LinkProps } from "@tanstack/react-router";
import clsx from "clsx";
import { ListFilter } from "lucide-react";
import type { ReactNode } from "react";
import { SidebarFilterMenu } from "./SidebarFilterMenu";
import type {
  SectionPreferences,
  SidebarPreferenceHandlers,
} from "./sidebar-types";

interface SidebarSectionHeaderProps {
  title: string;
  to: LinkProps["to"];
  params?: LinkProps["params"];
  preferences: SectionPreferences;
  onPreferencesChange: SidebarPreferenceHandlers;
  trailing?: ReactNode;
}

function IconTrigger({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Dropdown.Trigger
      className={clsx(
        "flex h-5 w-5 items-center justify-center rounded-sm transition-colors",
        "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200",
        "hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60"
      )}
      title={title}
      aria-label={title}
    >
      {children}
    </Dropdown.Trigger>
  );
}

export function SidebarSectionHeader({
  title,
  to,
  params,
  preferences,
  onPreferencesChange,
  trailing,
}: SidebarSectionHeaderProps) {
  return (
    <div className="ml-2 flex items-center justify-between">
      <Link
        to={to}
        params={params}
        activeOptions={{ exact: true }}
        className={clsx(
          "pointer-default cursor-default flex items-center rounded-sm pl-2 pr-3 py-0.5 text-[12px] font-medium text-neutral-600 select-none hover:bg-neutral-200/45 dark:text-neutral-300 dark:hover:bg-neutral-800/45 data-[active=true]:hover:bg-neutral-200/75 dark:data-[active=true]:hover:bg-neutral-800/65"
        )}
        activeProps={{
          className:
            "bg-neutral-200/75 text-neutral-900 dark:bg-neutral-800/65 dark:text-neutral-100",
          "data-active": "true",
        }}
      >
        {title}
      </Link>

      <div className="mr-[3px] flex items-center gap-0.5">
        {trailing}

        <Dropdown.Root>
          <IconTrigger title={`Filter ${title.toLowerCase()}`}>
            <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
          </IconTrigger>
          <Dropdown.Portal>
            <Dropdown.Positioner sideOffset={4} side="bottom" align="end">
              <SidebarFilterMenu
                mode="full"
                preferences={preferences}
                onOrganizeModeChange={onPreferencesChange.setOrganizeMode}
                onSortByChange={onPreferencesChange.setSortBy}
                onShowFilterChange={onPreferencesChange.setShowFilter}
              />
            </Dropdown.Positioner>
          </Dropdown.Portal>
        </Dropdown.Root>
      </div>
    </div>
  );
}
