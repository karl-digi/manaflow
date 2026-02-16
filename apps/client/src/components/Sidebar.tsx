import { env } from "@/client-env";
import { TaskTree } from "@/components/TaskTree";
import { TaskTreeSkeleton } from "@/components/TaskTreeSkeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { useWarmLocalWorkspaces } from "@/hooks/useWarmLocalWorkspaces";
import {
  disableDragPointerEvents,
  restoreDragPointerEvents,
} from "@/lib/drag-pointer-events";
import { isElectron } from "@/lib/electron";
import { type Doc } from "@cmux/convex/dataModel";
import { api } from "@cmux/convex/api";
import { useQuery } from "convex/react";
import type { LinkProps } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Bell, ChevronLeft, Home, Plus, Server, Settings } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
} from "react";
import CmuxLogoMark from "./logo/cmux-logo-mark";
import { SidebarNavLink } from "./sidebar/SidebarNavLink";
import { SidebarProjectGroup } from "./sidebar/SidebarProjectGroup";
import { SidebarPullRequestList } from "./sidebar/SidebarPullRequestList";
import { SidebarSectionHeader } from "./sidebar/SidebarSectionHeader";
import { SidebarWorkspacesSection } from "./sidebar/SidebarWorkspacesSection";
import type { SidebarPreferenceHandlers } from "./sidebar/sidebar-types";
import {
  SIDEBAR_PR_PREFS_KEY,
  SIDEBAR_WS_PREFS_KEY,
} from "./sidebar/sidebar-types";
import { useSidebarPreferences } from "./sidebar/useSidebarPreferences";
import {
  filterRelevant,
  getGroupDisplayName,
  groupItemsByProject,
  sortItems,
} from "./sidebar/sidebar-utils";

// Tasks with hasUnread indicator from the query
type TaskWithUnread = Doc<"tasks"> & { hasUnread: boolean };
const RELEVANT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CHRONOLOGICAL_LIST_KEY = "__cmux_chronological_list__";
const CHRONOLOGICAL_INITIAL_DISPLAY_COUNT = 5;

interface SidebarProps {
  tasks: TaskWithUnread[] | undefined;
  teamSlugOrId: string;
  onToggleHidden: () => void;
}

interface SidebarNavItem {
  label: string;
  to: LinkProps["to"];
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  search?: LinkProps["search"];
  exact?: boolean;
}
interface SidebarNavItemWithBadge extends SidebarNavItem {
  showBadge?: boolean;
  hidden?: boolean;
  onboardingKey?: string;
}

const navItems: SidebarNavItemWithBadge[] = [
  {
    label: "Home",
    to: "/$teamSlugOrId/dashboard",
    exact: true,
    icon: Home,
  },
  {
    label: "Notifications",
    to: "/$teamSlugOrId/notifications",
    exact: true,
    icon: Bell,
    showBadge: true,
    hidden: true,
  },
  {
    label: "Environments",
    to: "/$teamSlugOrId/environments",
    search: {
      step: undefined,
      selectedRepos: undefined,
      connectionLogin: undefined,
      repoSearch: undefined,
      instanceId: undefined,
    },
    exact: true,
    icon: Server,
    onboardingKey: "environments-link",
  },
  {
    label: "Settings",
    to: "/$teamSlugOrId/settings",
    exact: true,
    icon: Settings,
    onboardingKey: "settings-link",
  },
];

export function Sidebar({ tasks, teamSlugOrId, onToggleHidden }: SidebarProps) {
  const DEFAULT_WIDTH = 256;
  const MIN_WIDTH = 240;
  const MAX_WIDTH = 600;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const containerLeftRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const [width, setWidth] = useState<number>(() => {
    const stored = localStorage.getItem("sidebarWidth");
    const parsed = stored ? Number.parseInt(stored, 10) : DEFAULT_WIDTH;
    if (Number.isNaN(parsed)) return DEFAULT_WIDTH;
    return Math.min(Math.max(parsed, MIN_WIDTH), MAX_WIDTH);
  });
  const [isResizing, setIsResizing] = useState(false);

  const { expandTaskIds } = useExpandTasks();
  const prPreferenceState = useSidebarPreferences(SIDEBAR_PR_PREFS_KEY);
  const workspacePreferenceState = useSidebarPreferences(SIDEBAR_WS_PREFS_KEY);

  // Fetch pinned items (exclude local workspaces in web mode)
  const excludeLocalWorkspaces = env.NEXT_PUBLIC_WEB_MODE || undefined;
  const pinnedData = useQuery(api.tasks.getPinned, {
    teamSlugOrId,
    excludeLocalWorkspaces,
  });

  useWarmLocalWorkspaces({
    teamSlugOrId,
    tasks,
    pinnedTasks: pinnedData,
    enabled: !env.NEXT_PUBLIC_WEB_MODE,
  });

  // Fetch unread notification count
  const unreadCount = useQuery(api.taskNotifications.getUnreadCount, {
    teamSlugOrId,
  });

  useEffect(() => {
    localStorage.setItem("sidebarWidth", String(width));
  }, [width]);

  const prPreferences = prPreferenceState.preferences;
  const workspacePreferences = workspacePreferenceState.preferences;

  const prPreferenceHandlers: SidebarPreferenceHandlers = {
    setOrganizeMode: prPreferenceState.setOrganizeMode,
    setSortBy: prPreferenceState.setSortBy,
    setShowFilter: prPreferenceState.setShowFilter,
    toggleGroupCollapsed: prPreferenceState.toggleGroupCollapsed,
    toggleGroupExpanded: prPreferenceState.toggleGroupExpanded,
  };

  const workspacePreferenceHandlers: SidebarPreferenceHandlers = {
    setOrganizeMode: workspacePreferenceState.setOrganizeMode,
    setSortBy: workspacePreferenceState.setSortBy,
    setShowFilter: workspacePreferenceState.setShowFilter,
    toggleGroupCollapsed: workspacePreferenceState.toggleGroupCollapsed,
    toggleGroupExpanded: workspacePreferenceState.toggleGroupExpanded,
  };

  const visiblePinnedTasks = useMemo(() => {
    const relevanceCutoff = Date.now() - RELEVANT_WINDOW_MS;
    const pinned = (pinnedData ?? []).filter((task) => !task.isArchived);
    const filtered = filterRelevant(pinned, workspacePreferences.showFilter, (task) => {
      if (task.hasUnread) return true;
      const activityAt = task.lastActivityAt ?? task.updatedAt ?? task.createdAt ?? 0;
      return activityAt >= relevanceCutoff;
    });

    return sortItems(filtered, (task) =>
      workspacePreferences.sortBy === "updated"
        ? (task.lastActivityAt ?? task.updatedAt ?? task.createdAt ?? 0)
        : (task.createdAt ?? task.updatedAt ?? task.lastActivityAt ?? 0)
    );
  }, [pinnedData, workspacePreferences.showFilter, workspacePreferences.sortBy]);

  const visibleWorkspaceTasks = useMemo(() => {
    const relevanceCutoff = Date.now() - RELEVANT_WINDOW_MS;
    const list = (tasks ?? []).filter((task) => !task.pinned && !task.isArchived);
    const filtered = filterRelevant(list, workspacePreferences.showFilter, (task) => {
      if (task.hasUnread) return true;
      const activityAt = task.lastActivityAt ?? task.updatedAt ?? task.createdAt ?? 0;
      return activityAt >= relevanceCutoff;
    });

    return sortItems(filtered, (task) =>
      workspacePreferences.sortBy === "updated"
        ? (task.lastActivityAt ?? task.updatedAt ?? task.createdAt ?? 0)
        : (task.createdAt ?? task.updatedAt ?? task.lastActivityAt ?? 0)
    );
  }, [tasks, workspacePreferences.showFilter, workspacePreferences.sortBy]);

  const workspaceGroups = useMemo(
    () =>
      Array.from(
        groupItemsByProject(visibleWorkspaceTasks, (task) => task.projectFullName).entries()
      ),
    [visibleWorkspaceTasks]
  );

  const isWorkspaceChronologicalExpanded =
    workspacePreferences.expandedGroups[CHRONOLOGICAL_LIST_KEY] ?? false;
  const hasWorkspaceChronologicalOverflow =
    visibleWorkspaceTasks.length > CHRONOLOGICAL_INITIAL_DISPLAY_COUNT;
  const visibleChronologicalWorkspaceTasks =
    hasWorkspaceChronologicalOverflow && !isWorkspaceChronologicalExpanded
      ? visibleWorkspaceTasks.slice(0, CHRONOLOGICAL_INITIAL_DISPLAY_COUNT)
      : visibleWorkspaceTasks;
  const workspaceChronologicalRemainingCount = Math.max(
    0,
    visibleWorkspaceTasks.length - visibleChronologicalWorkspaceTasks.length
  );

  const onMouseMove = useCallback((e: MouseEvent) => {
    // Batch width updates to once per animation frame to reduce layout thrash
    if (rafIdRef.current != null) return;
    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      const containerLeft = containerLeftRef.current;
      const clientX = e.clientX;
      const newWidth = Math.min(
        Math.max(clientX - containerLeft, MIN_WIDTH),
        MAX_WIDTH
      );
      setWidth(newWidth);
    });
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.classList.remove("select-none");
    document.body.classList.remove("cmux-sidebar-resizing");
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    restoreDragPointerEvents();
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", stopResizing);
  }, [onMouseMove]);

  const startResizing = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.classList.add("select-none");
      document.body.classList.add("cmux-sidebar-resizing");
      // Snapshot the container's left position so we don't force layout on every move
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        containerLeftRef.current = rect.left;
      }
      disableDragPointerEvents();
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", stopResizing);
    },
    [onMouseMove, stopResizing]
  );

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [onMouseMove, stopResizing]);

  const resetWidth = useCallback(() => setWidth(DEFAULT_WIDTH), []);

  return (
    <div
      ref={containerRef}
      data-onboarding="sidebar"
      className="relative bg-neutral-50 dark:bg-black flex flex-col shrink-0 h-dvh grow pr-1 pt-1.5 w-[75vw] snap-start snap-always md:w-auto md:snap-align-none"
      style={
        {
          width: undefined,
          minWidth: undefined,
          maxWidth: undefined,
          userSelect: isResizing ? ("none" as const) : undefined,
          "--sidebar-width": `${width}px`,
        } as CSSProperties
      }
    >
      <div
        className={`h-[38px] border-b border-neutral-200/70 dark:border-neutral-800/50 flex items-center pr-0.5 shrink-0 ${isElectron ? "" : "pl-3"}`}
        style={{ WebkitAppRegion: "drag" } as CSSProperties}
      >
        {isElectron && <div className="w-[80px]"></div>}
        <Link
          to="/$teamSlugOrId/dashboard"
          params={{ teamSlugOrId }}
          activeOptions={{ exact: true }}
          className="flex items-center gap-1.5 select-none cursor-pointer whitespace-nowrap"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          {/* <Terminals */}
          <CmuxLogoMark height={20} label="cmux-next" />
          <span className="text-xs font-semibold tracking-wide text-neutral-900 dark:text-neutral-100 whitespace-nowrap">
            cmux-next
          </span>
        </Link>
        {/* Icons immediately after title - fixed X position */}
        <div
          className="flex items-center gap-1 ml-2"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleHidden}
                className="w-[25px] h-[25px] border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-lg flex items-center justify-center transition-colors cursor-default"
                aria-label="Toggle sidebar"
              >
                <ChevronLeft
                  className="w-4 h-4 text-neutral-700 dark:text-neutral-300"
                  aria-hidden="true"
                />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              showArrow={false}
              className="bg-neutral-200 text-neutral-700 border border-neutral-300 shadow-sm px-2 py-1 dark:bg-neutral-700 dark:text-neutral-100 dark:border-neutral-600"
            >
              Toggle sidebar Ctrl+Shift+S
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Link
                to="/$teamSlugOrId/dashboard"
                params={{ teamSlugOrId }}
                activeOptions={{ exact: true }}
                className="w-[25px] h-[25px] border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-lg flex items-center justify-center transition-colors cursor-default"
                aria-label="New task"
              >
                <Plus
                  className="w-4 h-4 text-neutral-700 dark:text-neutral-300"
                  aria-hidden="true"
                />
              </Link>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              showArrow={false}
              className="bg-neutral-200 text-neutral-700 border border-neutral-300 shadow-sm px-2 py-1 dark:bg-neutral-700 dark:text-neutral-100 dark:border-neutral-600"
            >
              New task
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <nav className="grow flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto pb-8">
          <ul className="flex flex-col gap-px">
            {navItems
              .filter((item) => !item.hidden)
              .map((item) => (
              <li
                key={item.label}
                {...(item.onboardingKey && { "data-onboarding": item.onboardingKey })}
              >
                <SidebarNavLink
                  to={item.to}
                  params={{ teamSlugOrId }}
                  search={item.search}
                  icon={item.icon}
                  exact={item.exact}
                  label={item.label}
                  badgeCount={item.showBadge ? unreadCount : undefined}
                />
              </li>
            ))}
          </ul>

          {isElectron && (
            <div className="mt-4 flex flex-col">
              <SidebarSectionHeader
                title="Pull requests"
                to="/$teamSlugOrId/prs"
                params={{ teamSlugOrId }}
                preferences={prPreferences}
                onPreferencesChange={prPreferenceHandlers}
              />
              <div className="ml-2 pt-px">
                <SidebarPullRequestList
                  teamSlugOrId={teamSlugOrId}
                  preferences={prPreferences}
                  onPreferencesChange={prPreferenceHandlers}
                />
              </div>
            </div>
          )}

          <div className="mt-2 flex flex-col gap-0.5">
            <SidebarWorkspacesSection
              teamSlugOrId={teamSlugOrId}
              preferences={workspacePreferences}
              onPreferencesChange={workspacePreferenceHandlers}
            />
          </div>

          <div className="ml-2 pt-px">
            <div className="space-y-px">
              {tasks === undefined ? (
                <TaskTreeSkeleton count={5} />
              ) : visiblePinnedTasks.length > 0 || visibleWorkspaceTasks.length > 0 ? (
                <>
                  {visiblePinnedTasks.length > 0 ? (
                    <>
                      {visiblePinnedTasks.map((task) => (
                        <TaskTree
                          key={task._id}
                          task={task}
                          defaultExpanded={
                            expandTaskIds?.includes(task._id) ?? false
                          }
                          teamSlugOrId={teamSlugOrId}
                          hasUnreadNotification={task.hasUnread}
                        />
                      ))}

                      {visibleWorkspaceTasks.length > 0 ? (
                        <hr className="mx-2 border-t border-neutral-200 dark:border-neutral-800" />
                      ) : null}
                    </>
                  ) : null}

                  {workspacePreferences.organizeMode === "chronological" ? (
                    <>
                      {visibleChronologicalWorkspaceTasks.map((task) => (
                        <TaskTree
                          key={task._id}
                          task={task}
                          defaultExpanded={
                            expandTaskIds?.includes(task._id) ?? false
                          }
                          teamSlugOrId={teamSlugOrId}
                          hasUnreadNotification={task.hasUnread}
                        />
                      ))}

                      {hasWorkspaceChronologicalOverflow ? (
                        <button
                          type="button"
                          onClick={() =>
                            workspacePreferenceHandlers.toggleGroupExpanded(
                              CHRONOLOGICAL_LIST_KEY
                            )
                          }
                          className="ml-2 w-[calc(100%-8px)] rounded-sm px-2 py-0.5 text-left text-[11px] text-neutral-500 hover:bg-neutral-200/45 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800/45 dark:hover:text-neutral-200"
                        >
                          {isWorkspaceChronologicalExpanded
                            ? "Show less"
                            : `Show more (${workspaceChronologicalRemainingCount})`}
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {workspaceGroups.map(([groupKey, groupItems]) => (
                        <SidebarProjectGroup
                          key={groupKey}
                          groupKey={groupKey}
                          displayName={getGroupDisplayName(groupKey)}
                          items={groupItems}
                          isCollapsed={
                            workspacePreferences.collapsedGroups[groupKey] ?? false
                          }
                          onToggleCollapse={() =>
                            workspacePreferenceHandlers.toggleGroupCollapsed(groupKey)
                          }
                          isExpanded={
                            workspacePreferences.expandedGroups[groupKey] ?? false
                          }
                          onToggleExpand={() =>
                            workspacePreferenceHandlers.toggleGroupExpanded(groupKey)
                          }
                          getItemKey={(task) => task._id}
                          renderItem={(task) => (
                            <TaskTree
                              task={task}
                              defaultExpanded={
                                expandTaskIds?.includes(task._id) ?? false
                              }
                              teamSlugOrId={teamSlugOrId}
                              hasUnreadNotification={task.hasUnread}
                            />
                          )}
                        />
                      ))}
                    </>
                  )}
                </>
              ) : (
                <p className="pl-2 pr-3 py-1.5 text-xs text-neutral-500 dark:text-neutral-400 select-none">
                  {workspacePreferences.showFilter === "relevant"
                    ? "No relevant workspaces"
                    : "No recent tasks"}
                </p>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Resize handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
        onMouseDown={startResizing}
        onDoubleClick={resetWidth}
        className="absolute top-0 right-0 h-full cursor-col-resize"
        style={
          {
            // Invisible, but with a comfortable hit area
            width: "14px",
            transform: "translateX(7px)",
            // marginRight: "-5px",
            background: "transparent",
            // background: "red",
            zIndex: "var(--z-sidebar-resize-handle)",
          } as CSSProperties
        }
      />
    </div>
  );
}
