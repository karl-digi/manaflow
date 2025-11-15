import { TaskTree } from "@/components/TaskTree";
import { TaskTreeSkeleton } from "@/components/TaskTreeSkeleton";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { isElectron } from "@/lib/electron";
import {
  areWorkspaceOrdersEqual,
  reorderWorkspaceOrder,
  sortTasksByWorkspaceOrder,
  type DropPosition,
} from "@/lib/workspaceOrdering";
import { api } from "@cmux/convex/api";
import { type Doc, type Id } from "@cmux/convex/dataModel";
import { useMutation, useQuery } from "convex/react";
import type { LinkProps } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Home, Plus, Server, Settings } from "lucide-react";
import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type DragEvent,
} from "react";
import { toast } from "sonner";
import CmuxLogo from "./logo/cmux-logo";
import { SidebarNavLink } from "./sidebar/SidebarNavLink";
import { SidebarPullRequestList } from "./sidebar/SidebarPullRequestList";
import { SidebarSectionLink } from "./sidebar/SidebarSectionLink";

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

const EMPTY_PINNED_SET: ReadonlySet<Id<"tasks">> = new Set();

export function Sidebar({ tasks, teamSlugOrId }: SidebarProps) {
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
  const [isHidden, setIsHidden] = useState(() => {
    const stored = localStorage.getItem("sidebarHidden");
    return stored === "true";
  });

  const { expandTaskIds } = useExpandTasks();

  const pinnedData = useQuery(api.tasks.getPinned, { teamSlugOrId });
  const workspaceSettings = useQuery(api.workspaceSettings.get, {
    teamSlugOrId,
  });
  const serverWorkspaceOrder = workspaceSettings?.workspaceOrder ?? null;
  const [pendingWorkspaceOrder, setPendingWorkspaceOrder] = useState<
    Id<"tasks">[] | null
  >(null);
  useEffect(() => {
    if (!pendingWorkspaceOrder) {
      return;
    }
    if (areWorkspaceOrdersEqual(serverWorkspaceOrder, pendingWorkspaceOrder)) {
      setPendingWorkspaceOrder(null);
    }
  }, [pendingWorkspaceOrder, serverWorkspaceOrder]);
  const effectiveWorkspaceOrder =
    pendingWorkspaceOrder ?? serverWorkspaceOrder;
  const updateWorkspaceSettings = useMutation(api.workspaceSettings.update);
  const sortedTasks = useMemo(() => {
    if (tasks === undefined) {
      return undefined;
    }
    return sortTasksByWorkspaceOrder(tasks, effectiveWorkspaceOrder);
  }, [tasks, effectiveWorkspaceOrder]);
  const pinnedTaskIds = useMemo(() => {
    if (!pinnedData) {
      return EMPTY_PINNED_SET;
    }
    return new Set(pinnedData.map((task) => task._id));
  }, [pinnedData]);
  const unpinnedTasks = useMemo(() => {
    if (sortedTasks === undefined) {
      return undefined;
    }
    return sortedTasks.filter(
      (task) => !task.pinned && !pinnedTaskIds.has(task._id)
    );
  }, [sortedTasks, pinnedTaskIds]);
  const [draggingTaskId, setDraggingTaskId] = useState<Id<"tasks"> | null>(
    null
  );
  const [dropPreview, setDropPreview] = useState<{
    taskId: Id<"tasks">;
    position: DropPosition;
  } | null>(null);
  const showDropPreview = useCallback(
    (taskId: Id<"tasks">, position: DropPosition) => {
      setDropPreview((prev) => {
        if (prev?.taskId === taskId && prev.position === position) {
          return prev;
        }
        return { taskId, position };
      });
    },
    []
  );
  const clearDropPreview = useCallback((taskId?: Id<"tasks">) => {
    setDropPreview((prev) => {
      if (!prev) {
        return prev;
      }
      if (taskId === undefined || prev.taskId === taskId) {
        return null;
      }
      return prev;
    });
  }, []);

  const handleWorkspaceDrop = useCallback(
    (sourceId: Id<"tasks">, targetId: Id<"tasks">, position: DropPosition) => {
      if (!sortedTasks || sortedTasks.length === 0) {
        return;
      }
      const nextOrder = reorderWorkspaceOrder({
        currentOrder: effectiveWorkspaceOrder,
        sourceId,
        targetId,
        position,
        tasks: sortedTasks,
      });
      if (areWorkspaceOrdersEqual(nextOrder, effectiveWorkspaceOrder)) {
        return;
      }
      setPendingWorkspaceOrder(nextOrder);
      updateWorkspaceSettings({
        teamSlugOrId,
        workspaceOrder: nextOrder,
      }).catch((error) => {
        console.error(error);
        toast.error("Failed to save workspace order");
        setPendingWorkspaceOrder(null);
      });
    },
    [
      sortedTasks,
      effectiveWorkspaceOrder,
      teamSlugOrId,
      updateWorkspaceSettings,
    ]
  );

  useEffect(() => {
    localStorage.setItem("sidebarWidth", String(width));
  }, [width]);

  useEffect(() => {
    localStorage.setItem("sidebarHidden", String(isHidden));
  }, [isHidden]);

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

  // Listen for storage events from command bar (sidebar visibility sync)
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
            <SidebarSectionLink
              to="/$teamSlugOrId/prs"
              params={{ teamSlugOrId }}
              exact
            >
              Pull requests
            </SidebarSectionLink>
            <div className="ml-2 pt-px">
              <SidebarPullRequestList teamSlugOrId={teamSlugOrId} />
            </div>
          </div>

          <div className="mt-2 flex flex-col gap-0.5">
            <SidebarSectionLink
              to="/$teamSlugOrId/workspaces"
              params={{ teamSlugOrId }}
              exact
            >
              Workspaces
            </SidebarSectionLink>
          </div>

          <div className="ml-2 pt-px">
            <div className="space-y-px">
              {sortedTasks === undefined ? (
                <TaskTreeSkeleton count={5} />
              ) : sortedTasks.length > 0 ? (
                <>
                  {/* Pinned items at the top */}
                  {pinnedData && pinnedData.length > 0 && (
                    <>
                      {pinnedData.map((task) => (
                        <TaskTree
                          key={task._id}
                          task={task}
                          defaultExpanded={expandTaskIds?.includes(task._id) ?? false}
                          teamSlugOrId={teamSlugOrId}
                        />
                      ))}
                      {/* Horizontal divider after pinned items */}
                      <hr className="mx-2 border-t border-neutral-200 dark:border-neutral-800" />
                    </>
                  )}
                  {/* Regular (non-pinned) tasks */}
                  {unpinnedTasks?.map((task) => (
                    <SidebarWorkspaceItem
                      key={task._id}
                      task={task}
                      teamSlugOrId={teamSlugOrId}
                      expandTaskIds={expandTaskIds}
                      draggingTaskId={draggingTaskId}
                      setDraggingTaskId={setDraggingTaskId}
                      dropPreview={dropPreview}
                      showDropPreview={showDropPreview}
                      clearDropPreview={clearDropPreview}
                      onReorder={handleWorkspaceDrop}
                    />
                  ))}
                </>
              ) : (
                <p className="pl-2 pr-3 py-1.5 text-xs text-neutral-500 dark:text-neutral-400 select-none">
                  No recent tasks
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

interface SidebarWorkspaceItemProps {
  task: Doc<"tasks">;
  teamSlugOrId: string;
  expandTaskIds?: string[];
  draggingTaskId: Id<"tasks"> | null;
  setDraggingTaskId: (taskId: Id<"tasks"> | null) => void;
  dropPreview: { taskId: Id<"tasks">; position: DropPosition } | null;
  showDropPreview: (taskId: Id<"tasks">, position: DropPosition) => void;
  clearDropPreview: (taskId?: Id<"tasks">) => void;
  onReorder: (
    sourceId: Id<"tasks">,
    targetId: Id<"tasks">,
    position: DropPosition
  ) => void;
}

function SidebarWorkspaceItem({
  task,
  teamSlugOrId,
  expandTaskIds,
  draggingTaskId,
  setDraggingTaskId,
  dropPreview,
  showDropPreview,
  clearDropPreview,
  onReorder,
}: SidebarWorkspaceItemProps) {
  const isDragging = draggingTaskId === task._id;
  const showTopIndicator =
    dropPreview?.taskId === task._id && dropPreview.position === "above";
  const showBottomIndicator =
    dropPreview?.taskId === task._id && dropPreview.position === "below";

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", task._id);
      setDraggingTaskId(task._id);
    },
    [setDraggingTaskId, task._id]
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!draggingTaskId || draggingTaskId === task._id) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const position = getDropPosition(event);
      showDropPreview(task._id, position);
    },
    [draggingTaskId, showDropPreview, task._id]
  );

  const handleDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget as Node | null;
      if (nextTarget && event.currentTarget.contains(nextTarget)) {
        return;
      }
      clearDropPreview(task._id);
    },
    [clearDropPreview, task._id]
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!draggingTaskId || draggingTaskId === task._id) {
        return;
      }
      event.preventDefault();
      const position = getDropPosition(event);
      clearDropPreview();
      onReorder(draggingTaskId, task._id, position);
      setDraggingTaskId(null);
    },
    [clearDropPreview, draggingTaskId, onReorder, setDraggingTaskId, task._id]
  );

  const handleDragEnd = useCallback(() => {
    clearDropPreview();
    setDraggingTaskId(null);
  }, [clearDropPreview, setDraggingTaskId]);

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
      className={clsx(
        "rounded-sm",
        isDragging && "opacity-60",
        (showTopIndicator || showBottomIndicator) && "py-0.5"
      )}
    >
      {showTopIndicator ? <SidebarDropIndicator /> : null}
      <TaskTree
        task={task}
        defaultExpanded={expandTaskIds?.includes(task._id) ?? false}
        teamSlugOrId={teamSlugOrId}
      />
      {showBottomIndicator ? <SidebarDropIndicator /> : null}
    </div>
  );
}

const getDropPosition = (event: DragEvent<HTMLElement>): DropPosition => {
  const rect = event.currentTarget.getBoundingClientRect();
  const offset = event.clientY - rect.top;
  return offset < rect.height / 2 ? "above" : "below";
};

function SidebarDropIndicator() {
  return (
    <div className="mx-2 mb-0.5 mt-0.5 h-0.5 rounded-full bg-blue-500 dark:bg-blue-400" />
  );
}
