import { isElectron } from "@/lib/electron";
import { api } from "@cmux/convex/api";
import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";

type CmuxNotificationBridge = {
  showTaskCompletion?: (payload: {
    teamSlugOrId: string;
    taskId: string;
    runId: string;
    taskTitle: string;
    agentName?: string | null;
  }) => Promise<{ ok: boolean; reason?: string }>;
};

const FALLBACK_TASK_TITLE = "Task ready for review";

export function useElectronTaskCompletionNotifications(
  teamSlugOrId: string
): void {
  const tasks = useQuery(
    api.tasks.getTasksWithTaskRuns,
    isElectron ? { teamSlugOrId } : "skip"
  );
  const notifiedRunsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!isElectron) return;

    const maybeWindow =
      typeof window === "undefined" ? undefined : (window as unknown as {
        cmux?: { notifications?: CmuxNotificationBridge };
      });

    const showTaskCompletion = maybeWindow?.cmux?.notifications?.showTaskCompletion;
    if (typeof showTaskCompletion !== "function") return;

    if (!Array.isArray(tasks)) return;

    for (const task of tasks) {
      if (!task || task.isCompleted !== true) continue;
      const run =
        task.selectedTaskRun && typeof task.selectedTaskRun === "object"
          ? task.selectedTaskRun
          : null;
      if (!run || !run._id || run.isCrowned !== true) continue;

      const lastRunId = notifiedRunsRef.current.get(task._id);
      if (lastRunId === run._id) continue;

      notifiedRunsRef.current.set(task._id, run._id);

      const rawTitle = typeof task.text === "string" ? task.text.trim() : "";
      const taskTitle = rawTitle || FALLBACK_TASK_TITLE;
      const agentName =
        typeof run.agentName === "string" && run.agentName.trim().length > 0
          ? run.agentName.trim()
          : null;

      void showTaskCompletion({
        teamSlugOrId,
        taskId: task._id,
        runId: run._id,
        taskTitle,
        agentName,
      }).catch((error) => {
        console.error("Failed to request task completion notification", error);
      });
    }
  }, [tasks, teamSlugOrId]);
}
