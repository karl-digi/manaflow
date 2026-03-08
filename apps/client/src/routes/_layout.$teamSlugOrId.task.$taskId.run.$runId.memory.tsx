import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createFileRoute } from "@tanstack/react-router";
import z from "zod";
import { TaskRunMemoryPanel } from "@/components/TaskRunMemoryPanel";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";

const paramsSchema = z.object({
  taskId: typedZid("tasks"),
  runId: typedZid("taskRuns"),
});

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/memory"
)({
  component: TaskRunMemory,
  params: {
    parse: paramsSchema.parse,
    stringify: (params) => ({
      taskId: params.taskId,
      runId: params.runId,
    }),
  },
  loader: async (opts) => {
    const { params } = opts;
    const { teamSlugOrId, runId } = params;

    // Prewarm the memory query
    convexQueryClient.convexClient.prewarmQuery({
      query: api.agentMemoryQueries.getByTaskRun,
      args: { teamSlugOrId, taskRunId: runId },
    });
  },
});

function TaskRunMemory() {
  const { runId: taskRunId, teamSlugOrId } = Route.useParams();

  return (
    <div className="flex grow min-h-0 flex-col bg-neutral-50 dark:bg-black">
      <div className="flex grow min-h-0 flex-col border-l border-neutral-200 dark:border-neutral-800">
        <TaskRunMemoryPanel teamSlugOrId={teamSlugOrId} taskRunId={taskRunId} />
      </div>
    </div>
  );
}
