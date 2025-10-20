import { FloatingPane } from "@/components/floating-pane";
import { TaskRunTerminalsPane } from "@/components/TaskRunTerminalsPane";
import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { convexQuery } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import z from "zod";

const paramsSchema = z.object({
  taskId: typedZid("tasks"),
  runId: typedZid("taskRuns"),
});

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/terminals",
)({
  component: RunTerminalsPage,
  params: {
    parse: paramsSchema.parse,
    stringify: (params) => ({
      taskId: params.taskId,
      runId: params.runId,
    }),
  },
  loader: async (opts) => {
    await opts.context.queryClient.ensureQueryData(
      convexQuery(api.taskRuns.get, {
        teamSlugOrId: opts.params.teamSlugOrId,
        id: opts.params.runId,
      }),
    );
  },
});

function RunTerminalsPage() {
  return (
    <FloatingPane>
      <div className="flex h-full min-h-0 flex-col bg-white dark:bg-neutral-900">
        <TaskRunTerminalsPane />
      </div>
    </FloatingPane>
  );
}
