import type { Id } from "@cmux/convex/dataModel";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_PREFIX = "cmux:sidebarPins";

export interface PinnedSidebarTask {
  taskId: Id<"tasks">;
  pinnedAt: number;
}

export interface PinnedSidebarTaskRun {
  taskId: Id<"tasks">;
  runId: Id<"taskRuns">;
  pinnedAt: number;
}

interface SidebarPinsState {
  tasks: PinnedSidebarTask[];
  runs: PinnedSidebarTaskRun[];
}

interface SidebarPinsContextValue {
  pinnedTasks: PinnedSidebarTask[];
  pinnedRuns: PinnedSidebarTaskRun[];
  isTaskPinned: (taskId: Id<"tasks">) => boolean;
  isTaskRunPinned: (runId: Id<"taskRuns">) => boolean;
  pinTask: (taskId: Id<"tasks">) => void;
  unpinTask: (taskId: Id<"tasks">) => void;
  pinTaskRun: (taskId: Id<"tasks">, runId: Id<"taskRuns">) => void;
  unpinTaskRun: (runId: Id<"taskRuns">) => void;
}

const SidebarPinsContext = createContext<SidebarPinsContextValue | null>(null);

function createEmptyState(): SidebarPinsState {
  return { tasks: [], runs: [] };
}

function readStateFromStorage(key: string): SidebarPinsState {
  if (typeof window === "undefined") {
    return createEmptyState();
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return createEmptyState();
    }
    const parsed = JSON.parse(raw) as Partial<SidebarPinsState>;
    const tasks = Array.isArray(parsed?.tasks)
      ? parsed.tasks
          .map((entry) => {
            if (
              entry &&
              typeof entry === "object" &&
              typeof (entry as PinnedSidebarTask).taskId === "string" &&
              typeof (entry as PinnedSidebarTask).pinnedAt === "number"
            ) {
              return entry as PinnedSidebarTask;
            }
            return null;
          })
          .filter((entry): entry is PinnedSidebarTask => Boolean(entry))
      : [];
    const runs = Array.isArray(parsed?.runs)
      ? parsed.runs
          .map((entry) => {
            if (
              entry &&
              typeof entry === "object" &&
              typeof (entry as PinnedSidebarTaskRun).taskId === "string" &&
              typeof (entry as PinnedSidebarTaskRun).runId === "string" &&
              typeof (entry as PinnedSidebarTaskRun).pinnedAt === "number"
            ) {
              return entry as PinnedSidebarTaskRun;
            }
            return null;
          })
          .filter((entry): entry is PinnedSidebarTaskRun => Boolean(entry))
      : [];
    return { tasks, runs };
  } catch {
    return createEmptyState();
  }
}

function writeStateToStorage(key: string, state: SidebarPinsState) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Ignore write failures (e.g., private browsing or quota limits).
  }
}

interface SidebarPinsProviderProps {
  teamSlugOrId: string;
  children: ReactNode;
}

export function SidebarPinsProvider({
  teamSlugOrId,
  children,
}: SidebarPinsProviderProps) {
  const storageKey = `${STORAGE_PREFIX}:${teamSlugOrId}`;
  const [state, setState] = useState<SidebarPinsState>(() =>
    readStateFromStorage(storageKey)
  );

  useEffect(() => {
    setState(readStateFromStorage(storageKey));
  }, [storageKey]);

  useEffect(() => {
    writeStateToStorage(storageKey, state);
  }, [state, storageKey]);

  const orderedTaskPins = useMemo(
    () => [...state.tasks].sort((a, b) => b.pinnedAt - a.pinnedAt),
    [state.tasks]
  );

  const orderedRunPins = useMemo(
    () => [...state.runs].sort((a, b) => b.pinnedAt - a.pinnedAt),
    [state.runs]
  );

  const pinnedTaskIds = useMemo(
    () => new Set(orderedTaskPins.map((entry) => entry.taskId)),
    [orderedTaskPins]
  );

  const pinnedRunMap = useMemo(() => {
    const map = new Map<Id<"taskRuns">, PinnedSidebarTaskRun>();
    for (const entry of orderedRunPins) {
      map.set(entry.runId, entry);
    }
    return map;
  }, [orderedRunPins]);

  const isTaskPinned = useCallback(
    (taskId: Id<"tasks">) => pinnedTaskIds.has(taskId),
    [pinnedTaskIds]
  );

  const isTaskRunPinned = useCallback(
    (runId: Id<"taskRuns">) => pinnedRunMap.has(runId),
    [pinnedRunMap]
  );

  const pinTask = useCallback((taskId: Id<"tasks">) => {
    setState((prev) => {
      if (prev.tasks.some((entry) => entry.taskId === taskId)) {
        return prev;
      }
      const entry: PinnedSidebarTask = {
        taskId,
        pinnedAt: Date.now(),
      };
      return { ...prev, tasks: [...prev.tasks, entry] };
    });
  }, []);

  const unpinTask = useCallback((taskId: Id<"tasks">) => {
    setState((prev) => {
      if (!prev.tasks.some((entry) => entry.taskId === taskId)) {
        return prev;
      }
      return {
        ...prev,
        tasks: prev.tasks.filter((entry) => entry.taskId !== taskId),
      };
    });
  }, []);

  const pinTaskRun = useCallback(
    (taskId: Id<"tasks">, runId: Id<"taskRuns">) => {
      setState((prev) => {
        if (prev.runs.some((entry) => entry.runId === runId)) {
          return prev;
        }
        const entry: PinnedSidebarTaskRun = {
          taskId,
          runId,
          pinnedAt: Date.now(),
        };
        return { ...prev, runs: [...prev.runs, entry] };
      });
    },
    []
  );

  const unpinTaskRun = useCallback((runId: Id<"taskRuns">) => {
    setState((prev) => {
      if (!prev.runs.some((entry) => entry.runId === runId)) {
        return prev;
      }
      return {
        ...prev,
        runs: prev.runs.filter((entry) => entry.runId !== runId),
      };
    });
  }, []);

  const value = useMemo<SidebarPinsContextValue>(
    () => ({
      pinnedTasks: orderedTaskPins,
      pinnedRuns: orderedRunPins,
      isTaskPinned,
      isTaskRunPinned,
      pinTask,
      unpinTask,
      pinTaskRun,
      unpinTaskRun,
    }),
    [
      orderedTaskPins,
      orderedRunPins,
      isTaskPinned,
      isTaskRunPinned,
      pinTask,
      unpinTask,
      pinTaskRun,
      unpinTaskRun,
    ]
  );

  return (
    <SidebarPinsContext.Provider value={value}>
      {children}
    </SidebarPinsContext.Provider>
  );
}

export function useSidebarPins(): SidebarPinsContextValue {
  const context = useContext(SidebarPinsContext);
  if (!context) {
    throw new Error("useSidebarPins must be used within SidebarPinsProvider");
  }
  return context;
}
