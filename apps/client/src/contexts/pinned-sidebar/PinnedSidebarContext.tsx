import type { Id } from "@cmux/convex/dataModel";
import { createContext, useContext } from "react";

export type PinnedSidebarEntry =
  | { type: "task"; taskId: Id<"tasks"> }
  | { type: "run"; taskId: Id<"tasks">; runId: Id<"taskRuns"> };

/**
 * Serialized representation of pinned sidebar entries. The ordered `items`
 * array allows us to keep tasks and runs in the order users pinned them while
 * still discriminating between entry types.
 */
export interface PinnedSidebarState {
  items: PinnedSidebarEntry[];
}

export interface PinnedSidebarContextValue {
  items: PinnedSidebarEntry[];
  pinTask: (taskId: Id<"tasks">) => void;
  unpinTask: (taskId: Id<"tasks">) => void;
  pinRun: (taskId: Id<"tasks">, runId: Id<"taskRuns">) => void;
  unpinRun: (runId: Id<"taskRuns">) => void;
  isTaskPinned: (taskId: Id<"tasks">) => boolean;
  isRunPinned: (runId: Id<"taskRuns">) => boolean;
}

export const PinnedSidebarContext =
  createContext<PinnedSidebarContextValue | null>(null);

export function usePinnedSidebar(): PinnedSidebarContextValue {
  const context = useContext(PinnedSidebarContext);
  if (!context) {
    throw new Error(
      "usePinnedSidebar must be used within a PinnedSidebarProvider"
    );
  }
  return context;
}
