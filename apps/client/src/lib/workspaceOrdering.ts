import type { Doc, Id } from "@cmux/convex/dataModel";

export type WorkspaceTask = Doc<"tasks">;
export type DropPosition = "above" | "below";

const getTaskTimestamp = (task: WorkspaceTask): number =>
  task.updatedAt ?? task.createdAt ?? 0;

const createWorkspaceOrderMap = (
  workspaceOrder?: Id<"tasks">[] | null
): Map<Id<"tasks">, number> | null => {
  if (!workspaceOrder || workspaceOrder.length === 0) {
    return null;
  }

  const map = new Map<Id<"tasks">, number>();
  workspaceOrder.forEach((taskId, index) => {
    if (!map.has(taskId)) {
      map.set(taskId, index);
    }
  });
  return map;
};

const compareTasks = (
  a: WorkspaceTask,
  b: WorkspaceTask,
  orderMap: Map<Id<"tasks">, number> | null
): number => {
  if (orderMap) {
    const aRank = orderMap.get(a._id);
    const bRank = orderMap.get(b._id);
    if (aRank !== undefined && bRank !== undefined) {
      return aRank - bRank;
    }
    if (aRank !== undefined) {
      return -1;
    }
    if (bRank !== undefined) {
      return 1;
    }
  }

  return getTaskTimestamp(b) - getTaskTimestamp(a);
};

export const sortTasksByWorkspaceOrder = (
  tasks: WorkspaceTask[],
  workspaceOrder?: Id<"tasks">[] | null
): WorkspaceTask[] => {
  if (tasks.length <= 1) {
    return tasks.slice();
  }
  const orderMap = createWorkspaceOrderMap(workspaceOrder);
  return [...tasks].sort((a, b) => compareTasks(a, b, orderMap));
};

export const reorderWorkspaceOrder = ({
  currentOrder,
  sourceId,
  targetId,
  position,
  tasks,
}: {
  currentOrder?: Id<"tasks">[] | null;
  sourceId: Id<"tasks">;
  targetId: Id<"tasks">;
  position: DropPosition;
  tasks: WorkspaceTask[];
}): Id<"tasks">[] => {
  if (sourceId === targetId) {
    return currentOrder ?? [];
  }

  const validTaskIds = new Set(tasks.map((task) => task._id));
  if (!validTaskIds.has(sourceId) || !validTaskIds.has(targetId)) {
    return currentOrder ?? [];
  }

  const baseOrder = (currentOrder ?? []).filter(
    (taskId) => validTaskIds.has(taskId) && taskId !== sourceId
  );
  if (!baseOrder.includes(targetId)) {
    baseOrder.push(targetId);
  }

  const targetIndex = baseOrder.indexOf(targetId);
  const insertIndex =
    position === "above" ? targetIndex : targetIndex + 1;
  const clampedIndex = Math.max(0, Math.min(baseOrder.length, insertIndex));
  const nextOrder = [...baseOrder];
  nextOrder.splice(clampedIndex, 0, sourceId);
  return nextOrder;
};

export const areWorkspaceOrdersEqual = (
  first?: Id<"tasks">[] | null,
  second?: Id<"tasks">[] | null
): boolean => {
  const a = first ?? [];
  const b = second ?? [];
  if (a.length !== b.length) {
    return false;
  }
  return a.every((taskId, index) => taskId === b[index]);
};
