import { TaskTree } from "@/components/TaskTree";
import { TaskTreeSkeleton } from "@/components/TaskTreeSkeleton";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { useWorkspaceOrderContext } from "@/contexts/workspace-order/WorkspaceOrderContext";
import { isElectron } from "@/lib/electron";
import {
  applyWorkspaceOrder,
  filterOrderToKnownTasks,
  moveTaskId,
} from "@/lib/workspaceOrder";
import { api } from "@cmux/convex/api";
import { type Doc } from "@cmux/convex/dataModel";
import type { LinkProps } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { GripVertical, Home, Plus, Server, Settings } from "lucide-react";
import { useQuery } from "convex/react";
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

const END_DROP_ID = "__workspace-drop-end";

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
  const { order, setOrder } = useWorkspaceOrderContext();
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverTargetId, setDragOverTargetId] = useState<
    string | typeof END_DROP_ID | null
  >(null);

  const workspaceTasks = useMemo(
    () => (tasks ? tasks.filter((task) => !task.pinned) : []),
    [tasks]
  );
  const orderedWorkspaceTasks = useMemo(() => {
    const sorted = applyWorkspaceOrder(workspaceTasks, order);
    return sorted ?? workspaceTasks;
  }, [order, workspaceTasks]);

  // Fetch pinned items
  const pinnedData = useQuery(api.tasks.getPinned, { teamSlugOrId });

  useEffect(() => {
    if (!tasks) {
      return;
    }
    const validIds = tasks
      .filter((task) => !task.pinned)
      .map((task) => task._id);
    setOrder((prev) => {
      const filtered = filterOrderToKnownTasks(prev, validIds);
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [setOrder, tasks]);

  const commitReorder = useCallback(
    (taskId: string, targetId: string | null) => {
      if (orderedWorkspaceTasks.length === 0) {
        return;
      }
      const currentIds = orderedWorkspaceTasks.map((task) => task._id);
      if (!currentIds.includes(taskId)) {
        return;
      }
      const nextOrder = moveTaskId(currentIds, taskId, targetId);
      setOrder(nextOrder);
    },
    [orderedWorkspaceTasks, setOrder]
  );

  const resetDragState = useCallback(() => {
    setDraggingTaskId(null);
    setDragOverTargetId(null);
  }, []);

  const handleDragStart = useCallback(
    (taskId: string) => (event: DragEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      setDraggingTaskId(taskId);
    },
    []
  );

  const handleDragOverItem = useCallback(
    (taskId: string, event: DragEvent<HTMLDivElement>) => {
      if (!draggingTaskId || draggingTaskId === taskId) {
        return;
      }
      event.preventDefault();
      if (dragOverTargetId !== taskId) {
        setDragOverTargetId(taskId);
      }
    },
    [dragOverTargetId, draggingTaskId]
  );

  const handleDropOnTask = useCallback(
    (taskId: string | null, event: DragEvent<HTMLDivElement>) => {
      if (!draggingTaskId) {
        return;
      }
      event.preventDefault();
      commitReorder(draggingTaskId, taskId);
      resetDragState();
    },
    [commitReorder, draggingTaskId, resetDragState]
  );

  const handleDragLeave = useCallback((taskId: string) => {
    setDragOverTargetId((prev) => (prev === taskId ? null : prev));
  }, []);

  const handleDropZoneDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!draggingTaskId) {
        return;
      }
      event.preventDefault();
      if (dragOverTargetId !== END_DROP_ID) {
        setDragOverTargetId(END_DROP_ID);
      }
    },
    [dragOverTargetId, draggingTaskId]
  );

  const handleDropZoneLeave = useCallback(() => {
    setDragOverTargetId((prev) => (prev === END_DROP_ID ? null : prev));
  }, []);

  const handleDropAtEnd = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!draggingTaskId) {
        return;
      }
      handleDropOnTask(null, event);
    },
    [draggingTaskId, handleDropOnTask]
  );

  const handleDragEnd = useCallback(() => {
    resetDragState();
  }, [resetDragState]);

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
              {tasks === undefined ? (
                <TaskTreeSkeleton count={5} />
              ) : tasks && tasks.length > 0 ? (
                <>
                  {pinnedData && pinnedData.length > 0 && (
                    <>
                      {pinnedData.map((task) => (
                        <TaskTree
                          key={task._id}
                          task={task}
                          defaultExpanded={
                            expandTaskIds?.includes(task._id) ?? false
                          }
                          teamSlugOrId={teamSlugOrId}
                        />
                      ))}
                      <hr className="mx-2 border-t border-neutral-200 dark:border-neutral-800" />
                    </>
                  )}
                  <div className="space-y-px">
                    {orderedWorkspaceTasks.map((task) => (
                      <div
                        key={task._id}
                        className={clsx(
                          "flex items-stretch rounded-md pr-1 transition-colors",
                          dragOverTargetId === task._id &&
                            "bg-neutral-200/60 dark:bg-neutral-900/60",
                          draggingTaskId === task._id && "opacity-60"
                        )}
                        onDragOver={(event) =>
                          handleDragOverItem(task._id, event)
                        }
                        onDrop={(event) => handleDropOnTask(task._id, event)}
                        onDragLeave={() => handleDragLeave(task._id)}
                      >
                        <button
                          type="button"
                          aria-label="Drag workspace to reorder"
                          className="flex items-center px-1 text-neutral-400 hover:text-neutral-700 dark:text-neutral-600 dark:hover:text-neutral-200 cursor-grab active:cursor-grabbing"
                          draggable
                          onDragStart={handleDragStart(task._id)}
                          onDragEnd={handleDragEnd}
                        >
                          <GripVertical className="h-3 w-3" />
                        </button>
                        <div className="flex-1 min-w-0">
                          <TaskTree
                            task={task}
                            defaultExpanded={
                              expandTaskIds?.includes(task._id) ?? false
                            }
                            teamSlugOrId={teamSlugOrId}
                          />
                        </div>
                      </div>
                    ))}
                    {draggingTaskId ? (
                      <div
                        className={clsx(
                          "mt-1 h-4 rounded border border-dashed border-transparent transition-colors",
                          dragOverTargetId === END_DROP_ID &&
                            "border-neutral-400 dark:border-neutral-600 bg-neutral-100/60 dark:bg-neutral-900/40"
                        )}
                        onDragOver={handleDropZoneDragOver}
                        onDrop={handleDropAtEnd}
                        onDragLeave={handleDropZoneLeave}
                      />
                    ) : null}
                  </div>
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
