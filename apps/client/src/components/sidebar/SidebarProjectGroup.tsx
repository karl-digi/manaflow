import clsx from "clsx";
import { Folder, FolderOpen } from "lucide-react";
import type { ReactNode } from "react";

interface SidebarProjectGroupProps<T> {
  groupKey: string;
  displayName: string;
  items: T[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  renderItem: (item: T) => ReactNode;
  getItemKey?: (item: T, index: number) => string;
  initialDisplayCount?: number;
}

export function SidebarProjectGroup<T>({
  groupKey,
  displayName,
  items,
  isCollapsed,
  onToggleCollapse,
  isExpanded,
  onToggleExpand,
  renderItem,
  getItemKey,
  initialDisplayCount = 5,
}: SidebarProjectGroupProps<T>) {
  const hasOverflow = items.length > initialDisplayCount;
  const visibleItems =
    hasOverflow && !isExpanded ? items.slice(0, initialDisplayCount) : items;
  const remainingCount = Math.max(0, items.length - visibleItems.length);

  return (
    <div className="space-y-px" data-group-key={groupKey}>
      <button
        type="button"
        onClick={onToggleCollapse}
        className={clsx(
          "group flex w-full items-center rounded-sm pl-1.5 pr-2 py-[3px] text-left text-sm font-medium leading-5",
          "text-neutral-500 hover:bg-neutral-200/45 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800/45 dark:hover:text-neutral-200"
        )}
      >
        <div className="pr-1 -ml-0.5 relative">
          <span className="grid size-4 place-items-center">
            {isCollapsed ? (
              <Folder
                className="h-3.5 w-3.5 shrink-0 text-neutral-700 group-hover:text-neutral-900 dark:text-neutral-200 dark:group-hover:text-neutral-100"
                aria-hidden="true"
              />
            ) : (
              <FolderOpen
                className="h-3.5 w-3.5 shrink-0 text-neutral-700 group-hover:text-neutral-900 dark:text-neutral-200 dark:group-hover:text-neutral-100"
                aria-hidden="true"
              />
            )}
          </span>
        </div>
        <span className="truncate">{displayName}</span>
      </button>

      {!isCollapsed ? (
        <div className="space-y-px">
          {visibleItems.map((item, index) => (
            <div key={getItemKey ? getItemKey(item, index) : `${groupKey}-${index}`}>
              {renderItem(item)}
            </div>
          ))}

          {hasOverflow ? (
            <button
              type="button"
              onClick={onToggleExpand}
              className="w-full rounded-sm px-2 py-0.5 text-left text-[11px] text-neutral-500 hover:bg-neutral-200/45 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800/45 dark:hover:text-neutral-200"
            >
              {isExpanded ? "Show less" : `Show more (${remainingCount})`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
