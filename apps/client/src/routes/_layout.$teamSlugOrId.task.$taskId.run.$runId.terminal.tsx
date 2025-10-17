import { TaskRunTerminal } from "@/components/task-run-terminal";
import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import z from "zod";

const paramsSchema = z.object({
  taskId: typedZid("tasks"),
  runId: typedZid("taskRuns"),
});

const TERMINAL_PORT = 39383;

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/terminal"
)({
  component: TaskRunTerminalPage,
  params: {
    parse: paramsSchema.parse,
    stringify: (params) => ({
      taskId: params.taskId,
      runId: params.runId,
    }),
  },
});

function TaskRunTerminalPage() {
  const { taskId, teamSlugOrId, runId } = Route.useParams();

  const taskRuns = useQuery(api.taskRuns.getByTask, {
    teamSlugOrId,
    taskId,
  });

  const selectedRun = useMemo(() => {
    return taskRuns?.find((run) => run._id === runId);
  }, [runId, taskRuns]);

  const terminalService = useMemo(() => {
    if (!selectedRun?.networking) return null;
    return (
      selectedRun.networking.find((service) => service.port === TERMINAL_PORT) ??
      null
    );
  }, [selectedRun]);

  return (
    <div className="flex h-full flex-col bg-white dark:bg-neutral-950">
      <div className="flex-1 min-h-0">
        {!selectedRun ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
            Loading terminal…
          </div>
        ) : terminalService ? (
          <TaskRunTerminal endpoint={terminalService.url} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-neutral-500 dark:text-neutral-400">
            <p>Terminal service is not available for this run.</p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              Ensure the workspace is running and exposes port {TERMINAL_PORT}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
