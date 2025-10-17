import { TaskTree } from "@/components/TaskTree";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { isElectron } from "@/lib/electron";
import clsx from "clsx";
import { api } from "@cmux/convex/api";
import { type Doc } from "@cmux/convex/dataModel";
import { useQuery as useConvexQuery } from "convex/react";
import type { LinkProps } from "@tanstack/react-router";
import { Link, useLocation } from "@tanstack/react-router";
import {
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Header,
  type Key,
  type ListBoxItemRenderProps,
  type PressEvent,
} from "react-aria-components";
import { Home, Plus, Server, Settings } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
} from "react";
import CmuxLogo from "./logo/cmux-logo";
import { SidebarNavLink } from "./sidebar/SidebarNavLink";
import {
  SidebarPullRequestListItem,
  SidebarPullRequestSkeletonRow,
} from "./sidebar/SidebarPullRequestList";
import { SidebarSectionLink } from "./sidebar/SidebarSectionLink";
import { SIDEBAR_PRS_DEFAULT_LIMIT } from "./sidebar/const";

interface SidebarProps {
  tasks: Doc<"tasks">[] | undefined;
  teamSlugOrId: string;
}

interface SidebarNavItem {
  label: string;
  to: LinkProps["to"];
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  search?: LinkProps["search"];
  exact?: boolean;
}
const navItems: SidebarNavItem[] = [
  {
    label: "Home",
    to: "/$teamSlugOrId/dashboard",
    exact: true,
    icon: Home,
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
  },
  {
    label: "Settings",
    to: "/$teamSlugOrId/settings",
    exact: true,
    icon: Settings,
  },
];

const WORKSPACE_SKELETON_COUNT = 5;

function getPullRequestItemKey(pr: Doc<"pullRequests">) {
  return `pr:${pr.repoFullName ?? ""}#${pr.number}`;
}

function getWorkspaceItemKey(task: Doc<"tasks">) {
  return `workspace:${task._id}`;
}

function getListBoxItemClassName(
  states: ListBoxItemRenderProps,
  options: { isActive?: boolean } = {}
) {
  const { isFocusVisible, isFocused, isSelected } = states;
  const isHighlighted = options.isActive || isSelected;

  return clsx(
    "rounded-sm outline-none transition-colors",
    isHighlighted
      ? "bg-neutral-200/75 dark:bg-neutral-800/65"
      : isFocused
        ? "bg-neutral-200/45 dark:bg-neutral-800/45"
        : null,
    isFocusVisible
      ? "ring-2 ring-neutral-400 dark:ring-neutral-500"
      : null
  );
}

interface SidebarPullRequestListBoxItemProps {
  itemKey: string;
  pr: Doc<"pullRequests">;
  teamSlugOrId: string;
  isExpanded: boolean;
  onToggle: (key: string) => void;
  isActive: boolean;
}

function SidebarPullRequestListBoxItem({
  itemKey,
  pr,
  teamSlugOrId,
  isExpanded,
  onToggle,
  isActive,
}: SidebarPullRequestListBoxItemProps) {
  const itemRef = useRef<HTMLDivElement | null>(null);

  const handlePress = useCallback((event: PressEvent) => {
    if (event.pointerType === "keyboard" || event.pointerType === "virtual") {
      const anchor = itemRef.current?.querySelector<HTMLAnchorElement>(
        '[data-sidebar-pr-link="true"]'
      );
      anchor?.click();
    }
  }, []);

  const textValue = pr.title || `${pr.repoFullName ?? ""} #${String(pr.number)}`;

  return (
    <ListBoxItem
      id={itemKey}
      textValue={textValue}
      ref={itemRef}
      onPress={handlePress}
      data-active={isActive || undefined}
      className={(states) =>
        clsx(getListBoxItemClassName(states, { isActive }), "px-0 py-0")
      }
    >
      <SidebarPullRequestListItem
        pr={pr}
        teamSlugOrId={teamSlugOrId}
        isExpanded={isExpanded}
        onToggle={() => onToggle(itemKey)}
        isActive={isActive}
      />
    </ListBoxItem>
  );
}

interface SidebarWorkspaceListBoxItemProps {
  itemKey: string;
  task: Doc<"tasks">;
  teamSlugOrId: string;
  defaultExpanded: boolean;
  isActive: boolean;
}

function SidebarWorkspaceListBoxItem({
  itemKey,
  task,
  teamSlugOrId,
  defaultExpanded,
  isActive,
}: SidebarWorkspaceListBoxItemProps) {
  const itemRef = useRef<HTMLDivElement | null>(null);

  const handlePress = useCallback((event: PressEvent) => {
    if (event.pointerType === "keyboard" || event.pointerType === "virtual") {
      const anchor = itemRef.current?.querySelector<HTMLAnchorElement>(
        '[data-sidebar-workspace-link="true"]'
      );
      anchor?.click();
    }
  }, []);

  return (
    <ListBoxItem
      id={itemKey}
      textValue={task.text}
      ref={itemRef}
      onPress={handlePress}
      data-active={isActive || undefined}
      className={(states) =>
        clsx(getListBoxItemClassName(states, { isActive }), "px-0 py-0")
      }
    >
      <TaskTree
        task={task}
        defaultExpanded={defaultExpanded}
        teamSlugOrId={teamSlugOrId}
      />
    </ListBoxItem>
  );
}

function SidebarWorkspaceSkeletonRow() {
  return (
    <div className="pl-2 pr-3 py-1.5">
      <div className="h-3 rounded bg-neutral-200 dark:bg-neutral-800 animate-pulse" />
    </div>
  );
}

export function Sidebar({ tasks, teamSlugOrId }: SidebarProps) {
  const DEFAULT_WIDTH = 256;
  const MIN_WIDTH = 240;
  const MAX_WIDTH = 600;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const listBoxRef = useRef<HTMLDivElement | null>(null);
  const containerLeftRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const [width, setWidth] = useState<number>(() => {
    const stored = localStorage.getItem("sidebarWidth");
    const parsed = stored ? Number.parseInt(stored, 10) : DEFAULT_WIDTH;
    if (Number.isNaN(parsed)) return DEFAULT_WIDTH;
    return Math.min(Math.max(parsed, MIN_WIDTH), MAX_WIDTH);
  });
  const [isResizing, setIsResizing] = useState(false);
  const [isHidden, setIsHidden] = useState(() => {
    const stored = localStorage.getItem("sidebarHidden");
    return stored === "true";
  });
  const [expandedPullRequests, setExpandedPullRequests] = useState<
    Record<string, boolean>
  >({});

  const { expandTaskIds } = useExpandTasks();
  const location = useLocation();
  const pullRequests = useConvexQuery(api.github_prs.listPullRequests, {
    teamSlugOrId,
    state: "open",
    limit: SIDEBAR_PRS_DEFAULT_LIMIT,
  });
  const isPullRequestsLoading = pullRequests === undefined;
  const pullRequestList = useMemo(
    () => pullRequests ?? [],
    [pullRequests]
  );

  useEffect(() => {
    localStorage.setItem("sidebarWidth", String(width));
  }, [width]);

  useEffect(() => {
    localStorage.setItem("sidebarHidden", String(isHidden));
  }, [isHidden]);

  useEffect(() => {
    setExpandedPullRequests((prev) => {
      const next: Record<string, boolean> = {};
      for (const pr of pullRequestList) {
        const key = getPullRequestItemKey(pr);
        if (prev[key]) {
          next[key] = prev[key];
        }
      }

      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length) {
        const unchanged = prevKeys.every((key) => prev[key] === next[key]);
        if (unchanged) {
          return prev;
        }
      }

      return next;
    });
  }, [pullRequestList]);

  const pullRequestItems = useMemo(
    () =>
      pullRequestList.map((pr) => {
        const key = getPullRequestItemKey(pr);
        const [owner = "", repo = ""] = pr.repoFullName?.split("/", 2) ?? ["", ""];
        const detailPath = `/${teamSlugOrId}/prs-only/${owner}/${repo}/${pr.number}`;
        const drawerPath = `/${teamSlugOrId}/prs/${owner}/${repo}/${pr.number}`;
        const isActive =
          location.pathname.includes(detailPath) ||
          location.pathname.includes(drawerPath);
        return {
          key,
          pr,
          isExpanded: expandedPullRequests[key] ?? false,
          isActive,
        };
      }),
    [
      expandedPullRequests,
      location.pathname,
      pullRequestList,
      teamSlugOrId,
    ]
  );

  const pullRequestSkeletonKeys = useMemo<Key[]>(() => {
    if (!isPullRequestsLoading) {
      return [];
    }
    return Array.from({ length: SIDEBAR_PRS_DEFAULT_LIMIT }, (_, index) =>
      `pr-loading-${index}`
    );
  }, [isPullRequestsLoading]);

  const workspaceSkeletonKeys = useMemo<Key[]>(() => {
    if (tasks !== undefined) {
      return [];
    }
    return Array.from({ length: WORKSPACE_SKELETON_COUNT }, (_, index) =>
      `workspace-loading-${index}`
    );
  }, [tasks]);

  const disabledKeys = useMemo(() => {
    const keys: Key[] = [];
    if (isPullRequestsLoading) {
      keys.push(...pullRequestSkeletonKeys);
    } else if (pullRequestList.length === 0) {
      keys.push("pr-empty");
    }

    if (tasks === undefined) {
      keys.push(...workspaceSkeletonKeys);
    } else if (tasks.length === 0) {
      keys.push("workspace-empty");
    }

    return new Set<Key>(keys);
  }, [
    isPullRequestsLoading,
    pullRequestList.length,
    pullRequestSkeletonKeys,
    tasks,
    workspaceSkeletonKeys,
  ]);

  const togglePullRequestExpansion = useCallback((key: string) => {
    setExpandedPullRequests((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const focusListBox = useCallback(() => {
    const element = listBoxRef.current;
    if (!element) {
      return;
    }
    element.focus({ preventScroll: false });
    const activeOption =
      element.querySelector<HTMLElement>('[role="option"][data-active="true"]') ??
      element.querySelector<HTMLElement>(
        '[role="option"]:not([data-disabled="true"])'
      );
    if (activeOption) {
      activeOption.scrollIntoView({ block: "nearest" });
    }
  }, []);

  useEffect(() => {
    const handleShortcut = () => {
      focusListBox();
    };

    let off: (() => void) | undefined;
    if (isElectron && window.cmux?.on) {
      off = window.cmux.on("shortcut:sidebar-focus", handleShortcut);
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.ctrlKey &&
        event.shiftKey &&
        (event.code === "KeyE" || event.key.toLowerCase() === "e")
      ) {
        event.preventDefault();
        focusListBox();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (typeof off === "function") {
        off();
      }
    };
  }, [focusListBox]);

  // Keyboard shortcut to toggle sidebar (Ctrl+Shift+S)
  useEffect(() => {
    if (isElectron && window.cmux?.on) {
      const off = window.cmux.on("shortcut:sidebar-toggle", () => {
        setIsHidden((prev) => !prev);
      });
      return () => {
        if (typeof off === "function") off();
      };
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.ctrlKey &&
        e.shiftKey &&
        (e.code === "KeyS" || e.key.toLowerCase() === "s")
      ) {
        e.preventDefault();
        setIsHidden((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Listen for storage events from command bar
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "sidebarHidden" && e.newValue !== null) {
        setIsHidden(e.newValue === "true");
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

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
    // Restore iframe pointer events
    const iframes = Array.from(document.querySelectorAll("iframe"));
    for (const el of iframes) {
      if (el instanceof HTMLIFrameElement) {
        const prev = el.dataset.prevPointerEvents;
        if (prev !== undefined) {
          if (prev === "__unset__") {
            el.style.removeProperty("pointer-events");
          } else {
            el.style.pointerEvents = prev;
          }
          delete el.dataset.prevPointerEvents;
        } else {
          // Fallback to clearing
          el.style.removeProperty("pointer-events");
        }
      }
    }
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
      // Disable pointer events on all iframes so dragging works over them
      const iframes = Array.from(document.querySelectorAll("iframe"));
      for (const el of iframes) {
        if (el instanceof HTMLIFrameElement) {
          const current = el.style.pointerEvents;
          el.dataset.prevPointerEvents = current ? current : "__unset__";
          el.style.pointerEvents = "none";
        }
      }
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
      className="relative bg-neutral-50 dark:bg-black flex flex-col shrink-0 h-dvh grow pr-1"
      style={{
        display: isHidden ? "none" : "flex",
        width: `${width}px`,
        minWidth: `${width}px`,
        maxWidth: `${width}px`,
        userSelect: isResizing ? ("none" as const) : undefined,
      }}
    >
      <div
        className={`h-[38px] flex items-center pr-1.5 shrink-0 ${isElectron ? "" : "pl-3"}`}
        style={{ WebkitAppRegion: "drag" } as CSSProperties}
      >
        {isElectron && <div className="w-[80px]"></div>}
        <Link
          to="/$teamSlugOrId/dashboard"
          params={{ teamSlugOrId }}
          activeOptions={{ exact: true }}
          className="flex items-center gap-2 select-none cursor-pointer"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          {/* <Terminals */}
          <CmuxLogo height={32} />
        </Link>
        <div className="grow"></div>
        <Link
          to="/$teamSlugOrId/dashboard"
          params={{ teamSlugOrId }}
          activeOptions={{ exact: true }}
          className="w-[25px] h-[25px] border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-lg flex items-center justify-center transition-colors cursor-default"
          title="New task"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <Plus
            className="w-4 h-4 text-neutral-700 dark:text-neutral-300"
            aria-hidden="true"
          />
        </Link>
      </div>
      <nav className="grow flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto pb-8">
          <ul className="flex flex-col gap-px">
            {navItems.map((item) => (
              <li key={item.label}>
                <SidebarNavLink
                  to={item.to}
                  params={{ teamSlugOrId }}
                  search={item.search}
                  icon={item.icon}
                  exact={item.exact}
                  label={item.label}
                />
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-col">
            <ListBox
              ref={listBoxRef}
              aria-label="Sidebar resources"
              selectionMode="single"
              disallowEmptySelection={false}
              disabledKeys={disabledKeys}
              className="flex flex-col gap-3 pr-1 focus:outline-none"
            >
              <ListBoxSection
                id="pull-requests"
                className="flex flex-col gap-1 pl-1"
              >
                <Header>
                  <SidebarSectionLink
                    to="/$teamSlugOrId/prs"
                    params={{ teamSlugOrId }}
                    exact
                  >
                    Pull requests
                  </SidebarSectionLink>
                </Header>
                {isPullRequestsLoading ? (
                  pullRequestSkeletonKeys.map((key) => (
                    <ListBoxItem
                      key={key}
                      id={key}
                      textValue="Loading pull request"
                      className={(states) =>
                        clsx(
                          getListBoxItemClassName(states),
                          "pointer-events-none select-none"
                        )
                      }
                    >
                      <SidebarPullRequestSkeletonRow />
                    </ListBoxItem>
                  ))
                ) : pullRequestList.length === 0 ? (
                  <ListBoxItem
                    id="pr-empty"
                    textValue="No pull requests"
                    className={(states) =>
                      clsx(
                        getListBoxItemClassName(states),
                        "pointer-events-none select-none"
                      )
                    }
                  >
                    <p className="pl-2 pr-3 py-1.5 text-xs text-neutral-500 dark:text-neutral-400 select-none">
                      No pull requests
                    </p>
                  </ListBoxItem>
                ) : (
                  pullRequestItems.map((item) => (
                    <SidebarPullRequestListBoxItem
                      key={item.key}
                      itemKey={item.key}
                      pr={item.pr}
                      teamSlugOrId={teamSlugOrId}
                      isExpanded={item.isExpanded}
                      onToggle={togglePullRequestExpansion}
                      isActive={item.isActive}
                    />
                  ))
                )}
              </ListBoxSection>

              <ListBoxSection
                id="workspaces"
                className="flex flex-col gap-1 pl-1"
              >
                <Header>
                  <SidebarSectionLink
                    to="/$teamSlugOrId/workspaces"
                    params={{ teamSlugOrId }}
                    exact
                  >
                    Workspaces
                  </SidebarSectionLink>
                </Header>
                {tasks === undefined ? (
                  workspaceSkeletonKeys.map((key) => (
                    <ListBoxItem
                      key={key}
                      id={key}
                      textValue="Loading workspace"
                      className={(states) =>
                        clsx(
                          getListBoxItemClassName(states),
                          "pointer-events-none select-none"
                        )
                      }
                    >
                      <SidebarWorkspaceSkeletonRow />
                    </ListBoxItem>
                  ))
                ) : tasks.length > 0 ? (
                  tasks.map((task) => (
                    <SidebarWorkspaceListBoxItem
                      key={getWorkspaceItemKey(task)}
                      itemKey={getWorkspaceItemKey(task)}
                      task={task}
                      teamSlugOrId={teamSlugOrId}
                      defaultExpanded={
                        expandTaskIds?.includes(task._id) ?? false
                      }
                      isActive={location.pathname.includes(`/task/${task._id}`)}
                    />
                  ))
                ) : (
                  <ListBoxItem
                    id="workspace-empty"
                    textValue="No recent tasks"
                    className={(states) =>
                      clsx(
                        getListBoxItemClassName(states),
                        "pointer-events-none select-none"
                      )
                    }
                  >
                    <p className="pl-2 pr-3 py-1.5 text-xs text-neutral-500 dark:text-neutral-400 select-none">
                      No recent tasks
                    </p>
                  </ListBoxItem>
                )}
              </ListBoxSection>
            </ListBox>
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
