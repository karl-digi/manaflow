import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@cmux/convex/api";
import { isElectron } from "@/lib/electron";
import type { Id } from "@cmux/convex/dataModel";
import {
  type TaskCompletionNotificationRequest,
} from "@/lib/electron-notifications";

interface TaskNotificationState {
  completed: boolean;
  runId: Id<"taskRuns"> | null;
}

export function useTaskCompletionNotifications(teamSlugOrId: string): void {
  const tasksWithRuns = useQuery(
    api.tasks.getTasksWithTaskRuns,
    isElectron ? { teamSlugOrId } : "skip"
  );

  const taskStateRef = useRef<Map<Id<"tasks">, TaskNotificationState>>(new Map());
  const notifiedRunsRef = useRef<Set<Id<"taskRuns">>>(new Set());
  const initializedRef = useRef(false);

  useEffect(() => {
    taskStateRef.current = new Map();
    notifiedRunsRef.current = new Set();
    initializedRef.current = false;
  }, [teamSlugOrId]);

  useEffect(() => {
    if (!isElectron) return;
    if (!Array.isArray(tasksWithRuns)) return;
    const notifier = window.cmux?.notifications?.showTaskComplete;
    if (!notifier) return;

    const nextState = new Map<Id<"tasks">, TaskNotificationState>();

    if (!initializedRef.current) {
      for (const task of tasksWithRuns) {
        const selectedRun = task.selectedTaskRun ?? null;
        const runId = selectedRun?._id ?? null;
        const completed = Boolean(task.isCompleted);
        if (completed && selectedRun?.isCrowned && runId) {
          notifiedRunsRef.current.add(runId);
        }
        nextState.set(task._id, { completed, runId });
      }
      taskStateRef.current = nextState;
      initializedRef.current = true;
      return;
    }

    for (const task of tasksWithRuns) {
      const selectedRun = task.selectedTaskRun ?? null;
      const runId = selectedRun?._id ?? null;
      const completed = Boolean(task.isCompleted);
      nextState.set(task._id, { completed, runId });

      if (!completed || !selectedRun?.isCrowned || !runId) {
        continue;
      }

      const previous = taskStateRef.current.get(task._id);
      const completionChanged = !previous?.completed || previous.runId !== runId;
      if (!completionChanged) {
        continue;
      }

      if (notifiedRunsRef.current.has(runId)) {
        continue;
      }

      notifiedRunsRef.current.add(runId);

      const payload: TaskCompletionNotificationRequest = {
        teamSlugOrId,
        taskId: task._id,
        runId,
        taskTitle: task.text ?? "Task completed",
        agentName: selectedRun.agentName ?? null,
        crownReason: selectedRun.crownReason ?? null,
      };

      void notifier(payload).catch((error: unknown) => {
        console.error(
          "Failed to request task completion notification",
          error
        );
      });
    }

    taskStateRef.current = nextState;
  }, [tasksWithRuns, teamSlugOrId]);
}
