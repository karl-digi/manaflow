import { TaskRunTerminals } from "@/components/TaskRunTerminals";
import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import z from "zod";

const paramsSchema = z.object({
  taskId: typedZid("tasks"),
  runId: typedZid("taskRuns"),
});

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/terminals"
)({
  component: TerminalsRouteComponent,
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
      })
    );
  },
});

function TerminalsRouteComponent() {
  const { runId: taskRunId, teamSlugOrId } = Route.useParams();
  useSuspenseQuery(
    convexQuery(api.taskRuns.get, {
      teamSlugOrId,
      id: taskRunId,
    })
  );

  return (
    <div className="flex flex-col grow bg-neutral-50 dark:bg-black">
      <div className="flex grow flex-col min-h-0 border-l border-neutral-200 dark:border-neutral-800">
        <TaskRunTerminals />
      </div>
    </div>
  );
}
