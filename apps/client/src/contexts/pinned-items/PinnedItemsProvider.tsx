import { type Id } from "@cmux/convex/dataModel";
import { useSessionStorage } from "@mantine/hooks";
import { useCallback, useMemo } from "react";
import {
  PinnedItemsContext,
  type PinnedItems,
} from "./PinnedItemsContext";

export function PinnedItemsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pinnedItems, setPinnedItems] = useSessionStorage<PinnedItems>({
    key: "pinnedItems",
    defaultValue: {
      tasks: [],
      taskRuns: [],
    },
    getInitialValueInEffect: true,
  });

  const pinTask = useCallback(
    (taskId: Id<"tasks">) => {
      setPinnedItems((prev) => {
        if (prev.tasks.includes(taskId)) {
          return prev;
        }
        return {
          ...prev,
          tasks: [...prev.tasks, taskId],
        };
      });
    },
    [setPinnedItems]
  );

  const unpinTask = useCallback(
    (taskId: Id<"tasks">) => {
      setPinnedItems((prev) => ({
        ...prev,
        tasks: prev.tasks.filter((id) => id !== taskId),
      }));
    },
    [setPinnedItems]
  );

  const isTaskPinned = useCallback(
    (taskId: Id<"tasks">) => {
      return pinnedItems.tasks.includes(taskId);
    },
    [pinnedItems.tasks]
  );

  const pinTaskRun = useCallback(
    (taskRunId: Id<"taskRuns">) => {
      setPinnedItems((prev) => {
        if (prev.taskRuns.includes(taskRunId)) {
          return prev;
        }
        return {
          ...prev,
          taskRuns: [...prev.taskRuns, taskRunId],
        };
      });
    },
    [setPinnedItems]
  );

  const unpinTaskRun = useCallback(
    (taskRunId: Id<"taskRuns">) => {
      setPinnedItems((prev) => ({
        ...prev,
        taskRuns: prev.taskRuns.filter((id) => id !== taskRunId),
      }));
    },
    [setPinnedItems]
  );

  const isTaskRunPinned = useCallback(
    (taskRunId: Id<"taskRuns">) => {
      return pinnedItems.taskRuns.includes(taskRunId);
    },
    [pinnedItems.taskRuns]
  );

  const value = useMemo(
    () => ({
      pinnedItems,
      pinTask,
      unpinTask,
      isTaskPinned,
      pinTaskRun,
      unpinTaskRun,
      isTaskRunPinned,
    }),
    [
      pinnedItems,
      pinTask,
      unpinTask,
      isTaskPinned,
      pinTaskRun,
      unpinTaskRun,
      isTaskRunPinned,
    ]
  );

  return (
    <PinnedItemsContext.Provider value={value}>
      {children}
    </PinnedItemsContext.Provider>
  );
}
