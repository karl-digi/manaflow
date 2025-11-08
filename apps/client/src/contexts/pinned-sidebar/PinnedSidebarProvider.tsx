import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Id } from "@cmux/convex/dataModel";
import {
  PinnedSidebarContext,
  type PinnedSidebarEntry,
  type PinnedSidebarState,
} from "./PinnedSidebarContext";

const STORAGE_PREFIX = "cmux:pinned-sidebar:v1";

const EMPTY_STATE: PinnedSidebarState = { items: [] };

function isValidEntry(payload: any): payload is PinnedSidebarEntry {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  if (payload.type === "task") {
    return typeof payload.taskId === "string";
  }
  if (payload.type === "run") {
    return (
      typeof payload.taskId === "string" && typeof payload.runId === "string"
    );
  }
  return false;
}

function loadState(key: string): PinnedSidebarState {
  if (typeof window === "undefined") {
    return EMPTY_STATE;
  }
  try {
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) {
      return EMPTY_STATE;
    }
    const parsed = JSON.parse(rawValue);
    if (!parsed || !Array.isArray(parsed.items)) {
      return EMPTY_STATE;
    }
    const items = parsed.items.filter(isValidEntry);
    return { items };
  } catch {
    return EMPTY_STATE;
  }
}

function persistState(key: string, state: PinnedSidebarState) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Ignore storage errors (e.g., quota exceeded)
  }
}

function entriesEqual(
  a: PinnedSidebarEntry,
  b: PinnedSidebarEntry
): boolean {
  if (a.type !== b.type) {
    return false;
  }
  if (a.type === "task" && b.type === "task") {
    return a.taskId === b.taskId;
  }
  if (a.type === "run" && b.type === "run") {
    return a.runId === b.runId && a.taskId === b.taskId;
  }
  return false;
}

function upsertEntry(
  current: PinnedSidebarEntry[],
  nextEntry: PinnedSidebarEntry
): PinnedSidebarEntry[] {
  const filtered = current.filter((entry) => !entriesEqual(entry, nextEntry));
  return [nextEntry, ...filtered];
}

interface PinnedSidebarProviderProps {
  teamSlugOrId: string;
  children: ReactNode;
}

export function PinnedSidebarProvider({
  teamSlugOrId,
  children,
}: PinnedSidebarProviderProps) {
  const storageKey = useMemo(
    () => `${STORAGE_PREFIX}:${teamSlugOrId}`,
    [teamSlugOrId]
  );

  const [state, setState] = useState<PinnedSidebarState>(() =>
    loadState(storageKey)
  );

  useEffect(() => {
    setState(loadState(storageKey));
  }, [storageKey]);

  useEffect(() => {
    persistState(storageKey, state);
  }, [state, storageKey]);

  const pinnedTaskIds = useMemo(() => {
    const ids = new Set<Id<"tasks">>();
    for (const entry of state.items) {
      if (entry.type === "task") {
        ids.add(entry.taskId);
      }
    }
    return ids;
  }, [state.items]);

  const pinnedRunIds = useMemo(() => {
    const ids = new Set<Id<"taskRuns">>();
    for (const entry of state.items) {
      if (entry.type === "run") {
        ids.add(entry.runId);
      }
    }
    return ids;
  }, [state.items]);

  const pinTask = useCallback((taskId: Id<"tasks">) => {
    setState((prev) => ({
      items: upsertEntry(prev.items, { type: "task", taskId }),
    }));
  }, []);

  const unpinTask = useCallback((taskId: Id<"tasks">) => {
    setState((prev) => ({
      items: prev.items.filter(
        (entry) => entry.type !== "task" || entry.taskId !== taskId
      ),
    }));
  }, []);

  const pinRun = useCallback((taskId: Id<"tasks">, runId: Id<"taskRuns">) => {
    setState((prev) => ({
      items: upsertEntry(prev.items, { type: "run", taskId, runId }),
    }));
  }, []);

  const unpinRun = useCallback((runId: Id<"taskRuns">) => {
    setState((prev) => ({
      items: prev.items.filter(
        (entry) => entry.type !== "run" || entry.runId !== runId
      ),
    }));
  }, []);

  const isTaskPinned = useCallback(
    (taskId: Id<"tasks">) => pinnedTaskIds.has(taskId),
    [pinnedTaskIds]
  );

  const isRunPinned = useCallback(
    (runId: Id<"taskRuns">) => pinnedRunIds.has(runId),
    [pinnedRunIds]
  );

  const contextValue = useMemo(
    () => ({
      items: state.items,
      pinTask,
      unpinTask,
      pinRun,
      unpinRun,
      isTaskPinned,
      isRunPinned,
    }),
    [
      state.items,
      pinTask,
      unpinTask,
      pinRun,
      unpinRun,
      isTaskPinned,
      isRunPinned,
    ]
  );

  return (
    <PinnedSidebarContext.Provider value={contextValue}>
      {children}
    </PinnedSidebarContext.Provider>
  );
}
