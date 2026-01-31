import clsx from "clsx";
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  disableDragPointerEvents,
  restoreDragPointerEvents,
} from "@/lib/drag-pointer-events";
import {
  DEFAULT_WORKSPACE_TAB_STYLE,
  WORKSPACE_TAB_STYLE_CLASSES,
  type WorkspaceTabStyle,
} from "./workspace-tab-styles";
import {
  findWorkspaceTab,
  findWorkspacePanel,
  insertWorkspaceTab,
  removeWorkspaceTab,
  splitWorkspacePanel,
  updateWorkspacePanel,
  type WorkspaceNode,
  type WorkspacePanelNode,
  type WorkspaceSplitNode,
  type WorkspaceTab,
} from "./workspace-layout-model";

type WorkspaceLayoutProps = {
  root: WorkspaceNode;
  onChange: (next: WorkspaceNode) => void;
  renderTabContent: (tab: WorkspaceTab, panelId: string) => ReactNode;
  renderEmptyPanel?: (panelId: string) => ReactNode;
  renderPanelActions?: (panel: WorkspacePanelNode) => ReactNode;
  onTabClose?: (tab: WorkspaceTab, panelId: string) => void;
  canCloseTab?: (tab: WorkspaceTab, panelId: string) => boolean;
  tabStyle?: WorkspaceTabStyle;
  className?: string;
};

type DragTabPayload = {
  tabId: string;
  panelId: string;
};

type DraggingTab = DragTabPayload | null;

type DropZone = "left" | "right" | "top" | "bottom" | "center" | null;

const dragTabPayloadSchema = z.object({
  tabId: z.string(),
  panelId: z.string(),
});

const TAB_DRAG_MIME = "application/x-cmux-workspace-tab";
const TAB_DRAG_FALLBACK_MIME = "text/plain";
const MIN_PANEL_SIZE_PX = 160;
const SPLIT_HANDLE_SIZE = 6;

function safeParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch (error) {
    console.error("Failed to parse drag payload", error);
    return null;
  }
}

function parseDragPayload(value: string): DragTabPayload | null {
  const parsed = safeParseJson(value);
  if (!parsed) return null;
  const result = dragTabPayloadSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function hasTabPayload(
  event: ReactDragEvent<HTMLElement>
): boolean {
  const types = Array.from(event.dataTransfer.types ?? []);
  if (types.length === 0) return true;
  return types.includes(TAB_DRAG_MIME) || types.includes(TAB_DRAG_FALLBACK_MIME);
}

function getDragPayload(
  event: ReactDragEvent<HTMLElement>,
  fallback?: DragTabPayload | null
): DragTabPayload | null {
  const primary = event.dataTransfer.getData(TAB_DRAG_MIME);
  const fallbackData = event.dataTransfer.getData(TAB_DRAG_FALLBACK_MIME);
  const parsed = parseDragPayload(primary || fallbackData);
  if (parsed) return parsed;
  return fallback ?? null;
}

function getDropZone(
  rect: DOMRect,
  clientX: number,
  clientY: number
): DropZone {
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  const edgeThreshold = 0.22;
  if (x <= edgeThreshold) return "left";
  if (x >= 1 - edgeThreshold) return "right";
  if (y <= edgeThreshold) return "top";
  if (y >= 1 - edgeThreshold) return "bottom";
  return "center";
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  if (!item) return items;
  next.splice(toIndex, 0, item);
  return next;
}

function reorderTabs(
  tabs: WorkspaceTab[],
  tabId: string,
  targetIndex: number
): WorkspaceTab[] {
  const fromIndex = tabs.findIndex((tab) => tab.id === tabId);
  if (fromIndex === -1) return tabs;
  const clampedIndex = clamp(targetIndex, 0, tabs.length - 1);
  const adjustedIndex =
    fromIndex < clampedIndex ? Math.max(clampedIndex - 1, 0) : clampedIndex;
  if (fromIndex === adjustedIndex) return tabs;
  return moveItem(tabs, fromIndex, adjustedIndex);
}

function getPanelActiveTab(panel: WorkspacePanelNode): WorkspaceTab | null {
  if (panel.tabs.length === 0) return null;
  const active = panel.tabs.find((tab) => tab.id === panel.activeTabId);
  return active ?? panel.tabs[0] ?? null;
}

export function WorkspaceLayout({
  root,
  onChange,
  renderTabContent,
  renderEmptyPanel,
  renderPanelActions,
  onTabClose,
  canCloseTab,
  tabStyle = DEFAULT_WORKSPACE_TAB_STYLE,
  className,
}: WorkspaceLayoutProps) {
  const [draggingTab, setDraggingTab] = useState<DraggingTab>(null);
  const draggingTabRef = useRef<DraggingTab>(null);
  const dragDropHandledRef = useRef(false);
  const lastHoverRef = useRef<{ panelId: string; dropZone: DropZone } | null>(
    null
  );
  const lastDragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const handleTabSelect = useCallback(
    (panelId: string, tabId: string) => {
      onChange(
        updateWorkspacePanel(root, panelId, (panel) => ({
          ...panel,
          activeTabId: tabId,
        }))
      );
    },
    [onChange, root]
  );

  const applyPanelDrop = useCallback(
    (panelId: string, dropZone: DropZone, payload: DragTabPayload) => {
      const targetPanel = findWorkspacePanel(root, panelId);
      const targetIsEmpty = targetPanel ? targetPanel.tabs.length === 0 : false;
      const effectiveDropZone = targetIsEmpty ? "center" : dropZone;
      const removal = removeWorkspaceTab(root, payload.tabId);
      const draggedTab =
        removal.removedTab ?? findWorkspaceTab(root, payload.tabId);
      if (!draggedTab) return;

      if (effectiveDropZone === "center" || effectiveDropZone === null) {
        const nextRoot = insertWorkspaceTab(removal.node, panelId, draggedTab);
        onChange(nextRoot);
        return;
      }

      const direction = effectiveDropZone === "left" || effectiveDropZone === "right"
        ? "row"
        : "column";
      const insertBefore = effectiveDropZone === "left" || effectiveDropZone === "top";
      const newPanel: WorkspacePanelNode = {
        type: "panel",
        id: crypto.randomUUID(),
        tabs: [draggedTab],
        activeTabId: draggedTab.id,
      };
      const nextRoot = splitWorkspacePanel(
        removal.node,
        panelId,
        direction,
        newPanel,
        insertBefore
      );
      onChange(nextRoot);
    },
    [onChange, root]
  );

  const handleTabDrop = useCallback(
    (panelId: string, targetIndex: number, payload: DragTabPayload) => {
      dragDropHandledRef.current = true;
      if (payload.panelId === panelId) {
        onChange(
          updateWorkspacePanel(root, panelId, (panel) => ({
            ...panel,
            tabs: reorderTabs(panel.tabs, payload.tabId, targetIndex),
            activeTabId: payload.tabId,
          }))
        );
        return;
      }
      const removal = removeWorkspaceTab(root, payload.tabId);
      if (!removal.removedTab) return;
      const nextRoot = insertWorkspaceTab(
        removal.node,
        panelId,
        removal.removedTab,
        targetIndex
      );
      onChange(nextRoot);
    },
    [onChange, root]
  );

  const handlePanelDrop = useCallback(
    (panelId: string, dropZone: DropZone, payload: DragTabPayload) => {
      dragDropHandledRef.current = true;
      applyPanelDrop(panelId, dropZone, payload);
    },
    [applyPanelDrop]
  );

  const handleResizeSplit = useCallback(
    (splitId: string, sizes: number[]) => {
      function updateSplit(node: WorkspaceNode): WorkspaceNode {
        if (node.type === "split") {
          if (node.id === splitId) {
            return { ...node, sizes };
          }
          const nextChildren = node.children.map(updateSplit);
          const changed = nextChildren.some(
            (child, index) => child !== node.children[index]
          );
          if (!changed) return node;
          return { ...node, children: nextChildren };
        }
        return node;
      }
      onChange(updateSplit(root));
    },
    [onChange, root]
  );

  const handleTabDragStart = useCallback(
    (tabId: string, panelId: string) => {
      dragDropHandledRef.current = false;
      lastHoverRef.current = null;
      lastDragPositionRef.current = null;
      const next = { tabId, panelId };
      draggingTabRef.current = next;
      setDraggingTab(next);
    },
    []
  );

  const handleTabDragEnd = useCallback(() => {
    const pending = draggingTabRef.current;
    const lastHover = lastHoverRef.current;
    const handled = dragDropHandledRef.current;
    if (pending && !handled) {
      if (lastHover) {
        applyPanelDrop(lastHover.panelId, lastHover.dropZone, pending);
      } else if (lastDragPositionRef.current && typeof document !== "undefined") {
        const { x, y } = lastDragPositionRef.current;
        const element = document.elementFromPoint(x, y);
        const panelElement = element?.closest?.("[data-workspace-panel-id]") ?? null;
        const panelId = panelElement?.getAttribute?.("data-workspace-panel-id") ?? null;
        if (panelId && panelElement) {
          const rect = panelElement.getBoundingClientRect();
          const dropZone = getDropZone(rect, x, y);
          applyPanelDrop(panelId, dropZone, pending);
        }
      }
    }
    draggingTabRef.current = null;
    lastHoverRef.current = null;
    dragDropHandledRef.current = false;
    lastDragPositionRef.current = null;
    setDraggingTab(null);
  }, [applyPanelDrop]);

  const handlePanelHover = useCallback(
    (panelId: string, dropZone: DropZone) => {
      if (!draggingTabRef.current) return;
      lastHoverRef.current = { panelId, dropZone };
    },
    []
  );

  const getFallbackDropZone = useCallback((panelId: string): DropZone | null => {
    const lastHover = lastHoverRef.current;
    if (!lastHover || lastHover.panelId !== panelId) return null;
    return lastHover.dropZone;
  }, []);

  const handleTabDrag = useCallback((x: number, y: number) => {
    lastDragPositionRef.current = { x, y };
    if (typeof document === "undefined") return;
    const element = document.elementFromPoint(x, y);
    const panelElement = element?.closest?.("[data-workspace-panel-id]") ?? null;
    const panelId = panelElement?.getAttribute?.("data-workspace-panel-id") ?? null;
    if (!panelId || !panelElement) return;
    const rect = panelElement.getBoundingClientRect();
    const nextDropZone = getDropZone(rect, x, y);
    lastHoverRef.current = { panelId, dropZone: nextDropZone };
  }, []);

  return (
    <div
      className={clsx(
        "flex h-full w-full min-h-0 min-w-0 overflow-hidden",
        className
      )}
      data-drag-disable-pointer
      data-workspace-root
    >
      <WorkspaceNodeView
        node={root}
        onTabSelect={handleTabSelect}
        onTabDrop={handleTabDrop}
        onPanelDrop={handlePanelDrop}
        onPanelHover={handlePanelHover}
        onResizeSplit={handleResizeSplit}
        getFallbackDropZone={getFallbackDropZone}
        renderTabContent={renderTabContent}
        renderEmptyPanel={renderEmptyPanel}
        renderPanelActions={renderPanelActions}
        onTabClose={onTabClose}
        canCloseTab={canCloseTab}
        draggingTab={draggingTab}
        onTabDragStart={handleTabDragStart}
        onTabDrag={handleTabDrag}
        onTabDragEnd={handleTabDragEnd}
        tabStyle={tabStyle}
      />
    </div>
  );
}

function WorkspaceNodeView({
  node,
  onTabSelect,
  onTabDrop,
  onPanelDrop,
  onPanelHover,
  onResizeSplit,
  getFallbackDropZone,
  renderTabContent,
  renderEmptyPanel,
  renderPanelActions,
  onTabClose,
  canCloseTab,
  draggingTab,
  onTabDragStart,
  onTabDrag,
  onTabDragEnd,
  tabStyle,
}: {
  node: WorkspaceNode;
  onTabSelect: (panelId: string, tabId: string) => void;
  onTabDrop: (panelId: string, targetIndex: number, payload: DragTabPayload) => void;
  onPanelDrop: (panelId: string, dropZone: DropZone, payload: DragTabPayload) => void;
  onPanelHover: (panelId: string, dropZone: DropZone) => void;
  onResizeSplit: (splitId: string, sizes: number[]) => void;
  getFallbackDropZone: (panelId: string) => DropZone | null;
  renderTabContent: (tab: WorkspaceTab, panelId: string) => ReactNode;
  renderEmptyPanel?: (panelId: string) => ReactNode;
  renderPanelActions?: (panel: WorkspacePanelNode) => ReactNode;
  onTabClose?: (tab: WorkspaceTab, panelId: string) => void;
  canCloseTab?: (tab: WorkspaceTab, panelId: string) => boolean;
  draggingTab: DraggingTab;
  onTabDragStart: (tabId: string, panelId: string) => void;
  onTabDrag: (x: number, y: number) => void;
  onTabDragEnd: () => void;
  tabStyle: WorkspaceTabStyle;
}) {
  if (node.type === "panel") {
    return (
      <WorkspacePanelView
        panel={node}
        onTabSelect={onTabSelect}
        onTabDrop={onTabDrop}
        onPanelDrop={onPanelDrop}
        onPanelHover={onPanelHover}
        getFallbackDropZone={getFallbackDropZone}
        renderTabContent={renderTabContent}
        renderEmptyPanel={renderEmptyPanel}
        renderPanelActions={renderPanelActions}
        onTabClose={onTabClose}
        canCloseTab={canCloseTab}
        draggingTab={draggingTab}
        onTabDragStart={onTabDragStart}
        onTabDrag={onTabDrag}
        onTabDragEnd={onTabDragEnd}
        tabStyle={tabStyle}
      />
    );
  }
  return (
    <WorkspaceSplitView
      node={node}
      onResize={onResizeSplit}
    >
      {node.children.map((child) => (
        <WorkspaceNodeView
          key={child.id}
          node={child}
          onTabSelect={onTabSelect}
          onTabDrop={onTabDrop}
          onPanelDrop={onPanelDrop}
          onPanelHover={onPanelHover}
          onResizeSplit={onResizeSplit}
          getFallbackDropZone={getFallbackDropZone}
          renderTabContent={renderTabContent}
          renderEmptyPanel={renderEmptyPanel}
          renderPanelActions={renderPanelActions}
          onTabClose={onTabClose}
          canCloseTab={canCloseTab}
          draggingTab={draggingTab}
          onTabDragStart={onTabDragStart}
          onTabDrag={onTabDrag}
          onTabDragEnd={onTabDragEnd}
          tabStyle={tabStyle}
        />
      ))}
    </WorkspaceSplitView>
  );
}

function WorkspacePanelView({
  panel,
  onTabSelect,
  onTabDrop,
  onPanelDrop,
  onPanelHover,
  getFallbackDropZone,
  renderTabContent,
  renderEmptyPanel,
  renderPanelActions,
  onTabClose,
  canCloseTab,
  draggingTab,
  onTabDragStart,
  onTabDrag,
  onTabDragEnd,
  tabStyle,
}: {
  panel: WorkspacePanelNode;
  onTabSelect: (panelId: string, tabId: string) => void;
  onTabDrop: (panelId: string, targetIndex: number, payload: DragTabPayload) => void;
  onPanelDrop: (panelId: string, dropZone: DropZone, payload: DragTabPayload) => void;
  onPanelHover: (panelId: string, dropZone: DropZone) => void;
  getFallbackDropZone: (panelId: string) => DropZone | null;
  renderTabContent: (tab: WorkspaceTab, panelId: string) => ReactNode;
  renderEmptyPanel?: (panelId: string) => ReactNode;
  renderPanelActions?: (panel: WorkspacePanelNode) => ReactNode;
  onTabClose?: (tab: WorkspaceTab, panelId: string) => void;
  canCloseTab?: (tab: WorkspaceTab, panelId: string) => boolean;
  draggingTab: DraggingTab;
  onTabDragStart: (tabId: string, panelId: string) => void;
  onTabDrag: (x: number, y: number) => void;
  onTabDragEnd: () => void;
  tabStyle: WorkspaceTabStyle;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [dropZone, setDropZone] = useState<DropZone>(null);
  const activeTab = useMemo(() => getPanelActiveTab(panel), [panel]);
  const isDragging = draggingTab !== null;
  const tabStyles =
    WORKSPACE_TAB_STYLE_CLASSES[tabStyle] ??
    WORKSPACE_TAB_STYLE_CLASSES[DEFAULT_WORKSPACE_TAB_STYLE];
  const isTabEventTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest("[data-workspace-tab-id], [data-workspace-tab-close]")
    );
  }, []);

  const handleDragOverPanel = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!hasTabPayload(event)) return;
      if (!panelRef.current) return;
      const nextDropZone = getDropZone(
        panelRef.current.getBoundingClientRect(),
        event.clientX,
        event.clientY
      );
      setDropZone(nextDropZone);
      onPanelHover(panel.id, nextDropZone);
      event.dataTransfer.dropEffect = "move";
      event.preventDefault();
    },
    [onPanelHover, panel.id]
  );

  const handleDropPanel = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) return;
      const payload = getDragPayload(event, draggingTab);
      setDropZone(null);
      if (!payload) return;
      event.preventDefault();
      let resolvedDropZone: DropZone | null = null;
      const edgeTarget =
        event.target instanceof Element
          ? event.target.closest("[data-workspace-drop-edge]")
          : null;
      const edgeAttr = edgeTarget?.getAttribute("data-workspace-drop-edge") ?? null;
      if (edgeAttr === "left" || edgeAttr === "right" || edgeAttr === "top" || edgeAttr === "bottom") {
        resolvedDropZone = edgeAttr;
      } else if (panelRef.current) {
        const rect = panelRef.current.getBoundingClientRect();
        const hasPoint =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom &&
          (event.clientX !== 0 || event.clientY !== 0);
        if (hasPoint) {
          resolvedDropZone = getDropZone(rect, event.clientX, event.clientY);
        }
      }
      const fallbackDropZone = getFallbackDropZone(panel.id);
      const stateDropZone = dropZone === "center" ? "center" : null;
      resolvedDropZone =
        resolvedDropZone ?? stateDropZone ?? fallbackDropZone ?? "center";
      onPanelDrop(panel.id, resolvedDropZone, payload);
    },
    [draggingTab, dropZone, getFallbackDropZone, onPanelDrop, panel.id]
  );

  const handleDragLeavePanel = useCallback(() => {
    setDropZone(null);
  }, []);

  const handleEdgeDragOver = useCallback(
    (edge: DropZone) => (event: ReactDragEvent<HTMLDivElement>) => {
      if (edge === null) return;
      if (!hasTabPayload(event)) return;
      setDropZone(edge);
      onPanelHover(panel.id, edge);
      event.dataTransfer.dropEffect = "move";
      event.preventDefault();
    },
    [onPanelHover, panel.id]
  );

  const handleEdgeDrop = useCallback(
    (edge: DropZone) => (event: ReactDragEvent<HTMLDivElement>) => {
      if (edge === null) return;
      const payload = getDragPayload(event, draggingTab);
      if (!payload) return;
      event.stopPropagation();
      event.preventDefault();
      onPanelDrop(panel.id, edge, payload);
      setDropZone(null);
    },
    [draggingTab, onPanelDrop, panel.id]
  );

  return (
    <div
      ref={panelRef}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-neutral-200/70 bg-white/90 dark:border-neutral-800/70 dark:bg-neutral-950/80"
      onDragOver={handleDragOverPanel}
      onDrop={handleDropPanel}
      onDragLeave={handleDragLeavePanel}
      onDragOverCapture={(event) => {
        if (isTabEventTarget(event.target)) return;
        event.stopPropagation();
        handleDragOverPanel(event);
      }}
      onDropCapture={(event) => {
        if (isTabEventTarget(event.target)) return;
        event.stopPropagation();
        handleDropPanel(event);
      }}
      data-workspace-panel-id={panel.id}
    >
      <div className="flex items-center gap-1 border-b border-neutral-200/70 bg-neutral-50/80 px-1.5 py-1 dark:border-neutral-800/70 dark:bg-neutral-900/60">
        <div className="flex items-center gap-1 overflow-x-auto">
          {panel.tabs.length === 0 ? (
            <span className="px-2 py-1 text-[11px] text-neutral-400">
              Empty pane
            </span>
          ) : (
            panel.tabs.map((tab, index) => {
              const isActive = tab.id === activeTab?.id;
              const isClosable = onTabClose
                ? canCloseTab
                  ? canCloseTab(tab, panel.id)
                  : true
                : false;
              return (
                <div key={tab.id} className="relative flex items-center">
                  <button
                    type="button"
                    draggable
                    onClick={() => onTabSelect(panel.id, tab.id)}
                    onDragStart={(event) => {
                      const payload = JSON.stringify({
                        tabId: tab.id,
                        panelId: panel.id,
                      });
                      event.dataTransfer.setData(
                        TAB_DRAG_MIME,
                        payload
                      );
                      event.dataTransfer.setData(
                        TAB_DRAG_FALLBACK_MIME,
                        payload
                      );
                      event.dataTransfer.effectAllowed = "move";
                      onTabDragStart(tab.id, panel.id);
                    }}
                    onDragEnd={() => {
                      onTabDragEnd();
                    }}
                    onDrag={(event) => {
                      onTabDrag(event.clientX, event.clientY);
                    }}
                    onDragOver={(event) => {
                      if (!hasTabPayload(event)) return;
                      event.stopPropagation();
                      event.dataTransfer.dropEffect = "move";
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      const payload = getDragPayload(event, draggingTab);
                      if (!payload) return;
                      if (payload.tabId === tab.id) return;
                      event.stopPropagation();
                      event.preventDefault();
                      onTabDrop(panel.id, index, payload);
                    }}
                    className={clsx(
                      "flex h-7 shrink-0 items-center gap-1 rounded-none px-2 text-[11px] font-medium transition",
                      tabStyles.tab,
                      isActive ? tabStyles.active : tabStyles.inactive,
                      isClosable ? "pr-6" : null
                    )}
                    title={tab.title}
                    data-workspace-tab-id={tab.id}
                    data-workspace-tab-kind={tab.kind}
                    data-workspace-tab-title={tab.title}
                  >
                    <span className="max-w-[140px] truncate">{tab.title}</span>
                  </button>
                  {isClosable ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onTabClose?.(tab, panel.id);
                      }}
                      className={clsx(
                        "absolute right-1 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-sm text-[10px] text-neutral-400 transition",
                        isActive
                          ? "hover:bg-neutral-200/70 hover:text-neutral-700 dark:hover:bg-neutral-800/70 dark:hover:text-neutral-200"
                          : "hover:bg-neutral-200/70 hover:text-neutral-700 dark:hover:bg-neutral-800/70 dark:hover:text-neutral-200"
                      )}
                      aria-label={`Close ${tab.title}`}
                      title="Close tab"
                      data-workspace-tab-close={tab.id}
                    >
                      x
                    </button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
        {renderPanelActions ? (
          <div className="ml-auto flex items-center">
            {renderPanelActions(panel)}
          </div>
        ) : null}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {isDragging ? (
          <div className="absolute inset-0 z-10">
            <div
              className="absolute inset-0"
              onDragOver={handleDragOverPanel}
              onDrop={handleDropPanel}
              onDragLeave={handleDragLeavePanel}
            />
            <div
              className="absolute inset-y-0 left-0 w-1/4"
              data-workspace-drop-edge="left"
              onDragOver={handleEdgeDragOver("left")}
              onDrop={handleEdgeDrop("left")}
            />
            <div
              className="absolute inset-y-0 right-0 w-1/4"
              data-workspace-drop-edge="right"
              onDragOver={handleEdgeDragOver("right")}
              onDrop={handleEdgeDrop("right")}
            />
            <div
              className="absolute inset-x-0 top-0 h-1/4"
              data-workspace-drop-edge="top"
              onDragOver={handleEdgeDragOver("top")}
              onDrop={handleEdgeDrop("top")}
            />
            <div
              className="absolute inset-x-0 bottom-0 h-1/4"
              data-workspace-drop-edge="bottom"
              onDragOver={handleEdgeDragOver("bottom")}
              onDrop={handleEdgeDrop("bottom")}
            />
          </div>
        ) : null}
        <div
          className={clsx(
            "flex min-h-0 flex-1 flex-col",
            isDragging ? "pointer-events-none" : null
          )}
        >
          {activeTab ? (
            renderTabContent(activeTab, panel.id)
          ) : (
            <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-neutral-400">
              {renderEmptyPanel ? renderEmptyPanel(panel.id) : "Drop tabs here"}
            </div>
          )}
        </div>
        {dropZone && dropZone !== "center" ? (
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0 rounded-none border border-neutral-300/60 bg-neutral-200/40 dark:border-neutral-700/70 dark:bg-neutral-800/30" />
            {dropZone === "left" ? (
              <div className="absolute inset-y-0 left-0 w-1/3 border-r border-neutral-300/70 bg-neutral-200/60 dark:border-neutral-700/70 dark:bg-neutral-800/40" />
            ) : null}
            {dropZone === "right" ? (
              <div className="absolute inset-y-0 right-0 w-1/3 border-l border-neutral-300/70 bg-neutral-200/60 dark:border-neutral-700/70 dark:bg-neutral-800/40" />
            ) : null}
            {dropZone === "top" ? (
              <div className="absolute inset-x-0 top-0 h-1/3 border-b border-neutral-300/70 bg-neutral-200/60 dark:border-neutral-700/70 dark:bg-neutral-800/40" />
            ) : null}
            {dropZone === "bottom" ? (
              <div className="absolute inset-x-0 bottom-0 h-1/3 border-t border-neutral-300/70 bg-neutral-200/60 dark:border-neutral-700/70 dark:bg-neutral-800/40" />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceSplitView({
  node,
  onResize,
  children,
}: {
  node: WorkspaceSplitNode;
  onResize: (splitId: string, sizes: number[]) => void;
  children: ReactNode[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizingRef = useRef<{
    index: number;
    startPos: number;
    startSizes: number[];
    containerSize: number;
  } | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const sizes = useMemo(() => {
    if (node.sizes.length === node.children.length) {
      return node.sizes;
    }
    const next = Array.from({ length: node.children.length }, () => 1);
    const total = next.reduce((sum, value) => sum + value, 0);
    return next.map((value) => value / total);
  }, [node.children.length, node.sizes]);

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!resizingRef.current) return;
      const { index, startPos, startSizes, containerSize } = resizingRef.current;
      if (containerSize <= 0) return;
      const delta = event.clientX - startPos;
      const deltaAxis = node.direction === "column" ? event.clientY - startPos : delta;
      const deltaRatio = deltaAxis / containerSize;
      const total = startSizes[index] + startSizes[index + 1];
      const minRatio = MIN_PANEL_SIZE_PX / containerSize;
      let nextFirst = clamp(startSizes[index] + deltaRatio, minRatio, total - minRatio);
      let nextSecond = total - nextFirst;
      if (nextSecond < minRatio) {
        nextSecond = minRatio;
        nextFirst = total - nextSecond;
      }
      const nextSizes = [...startSizes];
      nextSizes[index] = nextFirst;
      nextSizes[index + 1] = nextSecond;
      onResize(node.id, nextSizes);
    },
    [node.direction, node.id, onResize]
  );

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    resizingRef.current = null;
    document.body.style.cursor = "";
    document.body.classList.remove("select-none");
    restoreDragPointerEvents();
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", stopResizing);
  }, [handleMouseMove]);

  const startResizing = useCallback(
    (index: number, event: ReactMouseEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;
      event.preventDefault();
      const rect = containerRef.current.getBoundingClientRect();
      const containerSize =
        node.direction === "column" ? rect.height : rect.width;
      resizingRef.current = {
        index,
        startPos: node.direction === "column" ? event.clientY : event.clientX,
        startSizes: sizes,
        containerSize,
      };
      setIsResizing(true);
      document.body.style.cursor =
        node.direction === "column" ? "row-resize" : "col-resize";
      document.body.classList.add("select-none");
      disableDragPointerEvents();
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", stopResizing);
    },
    [handleMouseMove, node.direction, sizes, stopResizing]
  );

  const flexDirection = node.direction === "column" ? "flex-col" : "flex-row";

  return (
    <div
      ref={containerRef}
      className={clsx(
        "flex min-h-0 min-w-0 flex-1 overflow-hidden",
        flexDirection
      )}
      style={{
        userSelect: isResizing ? "none" : undefined,
      }}
    >
      {children.map((child, index) => {
        const size = sizes[index] ?? 1;
        const childId = node.children[index]?.id ?? `pane-${index}`;
        return (
          <Fragment key={childId}>
            <div
              className="flex min-h-0 min-w-0"
              style={{ flex: `${size} 1 0%` }}
            >
              {child}
            </div>
            {index < children.length - 1 ? (
              <div
                role="separator"
                aria-orientation={node.direction === "column" ? "horizontal" : "vertical"}
                onMouseDown={(event) => startResizing(index, event)}
                className={clsx(
                  "group relative z-10 flex items-center justify-center bg-transparent",
                  node.direction === "column"
                    ? "h-[6px] cursor-row-resize"
                    : "w-[6px] cursor-col-resize"
                )}
                style={{
                  [node.direction === "column" ? "height" : "width"]:
                    `${SPLIT_HANDLE_SIZE}px`,
                }}
                title="Resize"
                data-workspace-split-handle
                data-workspace-split-direction={node.direction}
              >
                <div
                  className={clsx(
                    "absolute inset-0 rounded-full transition",
                    "group-hover:bg-neutral-200/70 dark:group-hover:bg-neutral-800/70"
                  )}
                />
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
