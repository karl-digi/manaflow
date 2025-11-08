import { type Id } from "@cmux/convex/dataModel";
import { createContext, useContext } from "react";

export interface PinnedItems {
  tasks: Id<"tasks">[];
  taskRuns: Id<"taskRuns">[];
}

interface PinnedItemsContextType {
  pinnedItems: PinnedItems;
  pinTask: (taskId: Id<"tasks">) => void;
  unpinTask: (taskId: Id<"tasks">) => void;
  isTaskPinned: (taskId: Id<"tasks">) => boolean;
  pinTaskRun: (taskRunId: Id<"taskRuns">) => void;
  unpinTaskRun: (taskRunId: Id<"taskRuns">) => void;
  isTaskRunPinned: (taskRunId: Id<"taskRuns">) => boolean;
}

export const PinnedItemsContext = createContext<
  PinnedItemsContextType | undefined
>(undefined);

export function usePinnedItems() {
  const context = useContext(PinnedItemsContext);
  if (!context) {
    throw new Error(
      "usePinnedItems must be used within a PinnedItemsProvider"
    );
  }
  return context;
}
