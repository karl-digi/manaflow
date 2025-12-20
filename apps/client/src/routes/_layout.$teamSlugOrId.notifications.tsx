import { FloatingPane } from "@/components/floating-pane";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { convexQuery } from "@convex-dev/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
  Bell,
  CheckCircle,
  CheckCheck,
  XCircle,
} from "lucide-react";
import { useCallback } from "react";

// Type for notifications from the API
interface NotificationData {
  _id: Id<"taskNotifications">;
  taskId: Id<"tasks">;
  taskRunId?: Id<"taskRuns">;
  teamId: string;
  userId: string;
  type: "run_completed" | "run_failed";
  message?: string;
  readAt?: number;
  createdAt: number;
  task: {
    _id: Id<"tasks">;
    text: string;
    description?: string;
  } | null;
  taskRun: {
    _id: Id<"taskRuns">;
    agentName?: string;
  } | null;
}

export const Route = createFileRoute("/_layout/$teamSlugOrId/notifications")({
  component: NotificationsRoute,
  loader: async ({ params }) => {
    const { teamSlugOrId } = params;
    void convexQueryClient.queryClient.ensureQueryData(
      convexQuery(api.taskNotifications.list, { teamSlugOrId })
    );
  },
});

function NotificationsRoute() {
  const { teamSlugOrId } = Route.useParams();
  const notifications = useQuery(api.taskNotifications.list, { teamSlugOrId }) as NotificationData[] | undefined;
  const markAsRead = useMutation(api.taskNotifications.markAsRead);
  const markAllAsRead = useMutation(api.taskNotifications.markAllAsRead);

  const handleMarkAsRead = useCallback(
    async (notificationId: Id<"taskNotifications">) => {
      await markAsRead({ teamSlugOrId, notificationId });
    },
    [markAsRead, teamSlugOrId]
  );

  const handleMarkAllAsRead = useCallback(async () => {
    await markAllAsRead({ teamSlugOrId });
  }, [markAllAsRead, teamSlugOrId]);

  const unreadCount =
    notifications?.filter((n: { readAt?: number }) => !n.readAt).length ?? 0;

  return (
    <FloatingPane>
      <div className="grow h-full flex flex-col">
        <div className="border-b border-neutral-200 px-6 py-4 dark:border-neutral-800 flex items-center justify-between">
          <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 select-none">
            Notifications
          </h1>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="flex items-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 transition-colors"
            >
              <CheckCheck className="size-4" />
              Mark all as read
            </button>
          )}
        </div>
        <div className="overflow-y-auto px-4 pb-6">
          {notifications === undefined ? (
            <div className="mt-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 bg-neutral-100 dark:bg-neutral-800 rounded-lg animate-pulse"
                />
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="mt-12 flex flex-col items-center justify-center text-neutral-500 dark:text-neutral-400">
              <Bell className="size-12 mb-3 opacity-50" />
              <p className="text-sm select-none">No notifications yet.</p>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification._id}
                  notification={notification}
                  teamSlugOrId={teamSlugOrId}
                  onMarkAsRead={handleMarkAsRead}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </FloatingPane>
  );
}

function NotificationItem({
  notification,
  teamSlugOrId,
  onMarkAsRead,
}: {
  notification: NotificationData;
  teamSlugOrId: string;
  onMarkAsRead: (id: Id<"taskNotifications">) => void;
}) {
  const isUnread = !notification.readAt;
  const isCompleted = notification.type === "run_completed";
  const Icon = isCompleted ? CheckCircle : XCircle;

  const taskName =
    notification.task?.text?.slice(0, 60) ||
    notification.task?.description?.slice(0, 60) ||
    "Task";

  const truncatedTaskName =
    taskName.length >= 60 ? `${taskName}...` : taskName;

  const timeAgo = getTimeAgo(notification.createdAt);

  const handleClick = () => {
    if (isUnread) {
      onMarkAsRead(notification._id);
    }
  };

  return (
    <Link
      to="/$teamSlugOrId/task/$taskId"
      params={{
        teamSlugOrId,
        taskId: notification.taskId,
      }}
      search={{ runId: undefined }}
      onClick={handleClick}
      className={`
        block px-4 py-3 rounded-lg border transition-colors
        ${
          isUnread
            ? "bg-blue-50/50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800"
            : "bg-neutral-50 border-neutral-200 dark:bg-neutral-900 dark:border-neutral-800"
        }
        hover:bg-neutral-100 dark:hover:bg-neutral-800
      `}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex-shrink-0 ${
            isCompleted
              ? "text-green-600 dark:text-green-500"
              : "text-red-600 dark:text-red-500"
          }`}
        >
          <Icon className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
              {isCompleted ? "Run completed" : "Run failed"}
            </p>
            <span className="text-xs text-neutral-500 dark:text-neutral-400 flex-shrink-0">
              {timeAgo}
            </span>
          </div>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-0.5 truncate">
            {truncatedTaskName}
          </p>
          {notification.taskRun?.agentName && (
            <p className="text-xs text-neutral-500 dark:text-neutral-500 mt-1">
              {notification.taskRun.agentName}
            </p>
          )}
        </div>
        {isUnread && (
          <div className="flex-shrink-0 mt-1.5">
            <div className="size-2 rounded-full bg-blue-500" />
          </div>
        )}
      </div>
    </Link>
  );
}

function getTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
}
