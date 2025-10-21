export const TASK_NOTIFICATION_OPEN_DIFF_EVENT = "task-notification:open-diff" as const;

export type TaskNotificationNavigationPayload = {
  teamSlugOrId: string;
  taskId: string;
  runId: string;
};

export type TaskCompletionNotificationRequest = {
  teamSlugOrId: string;
  taskId: string;
  runId: string;
  taskTitle: string;
  agentName?: string | null;
  crownReason?: string | null;
};
