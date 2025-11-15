type TaskIdentifier = string;

export interface OrderableItem {
  _id: TaskIdentifier;
}

export function applyWorkspaceOrder<T extends OrderableItem>(
  tasks: T[] | undefined,
  order: TaskIdentifier[]
): T[] | undefined {
  if (!tasks || order.length === 0) {
    return tasks;
  }
  const orderMap = new Map(order.map((id, index) => [id, index]));
  return tasks
    .map((task, index) => ({
      task,
      originalIndex: index,
      orderIndex: orderMap.get(task._id),
    }))
    .sort((a, b) => {
      const aOrder = a.orderIndex;
      const bOrder = b.orderIndex;
      if (aOrder != null && bOrder != null) {
        return aOrder - bOrder;
      }
      if (aOrder != null) {
        return -1;
      }
      if (bOrder != null) {
        return 1;
      }
      return a.originalIndex - b.originalIndex;
    })
    .map((entry) => entry.task);
}

export function moveTaskId(
  currentOrder: TaskIdentifier[],
  taskId: TaskIdentifier,
  targetId: TaskIdentifier | null
): TaskIdentifier[] {
  const withoutTask = currentOrder.filter((id) => id !== taskId);
  if (targetId === null) {
    return [...withoutTask, taskId];
  }
  const targetIndex = withoutTask.indexOf(targetId);
  if (targetIndex === -1) {
    return [...withoutTask, taskId];
  }
  const next = [...withoutTask];
  next.splice(targetIndex, 0, taskId);
  return next;
}

export function filterOrderToKnownTasks(
  currentOrder: TaskIdentifier[],
  allowedTaskIds: Iterable<TaskIdentifier>
): TaskIdentifier[] {
  const allowed = new Set(allowedTaskIds);
  return currentOrder.filter((id) => allowed.has(id));
}
