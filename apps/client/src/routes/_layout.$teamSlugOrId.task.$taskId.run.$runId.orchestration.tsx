import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createFileRoute } from "@tanstack/react-router";
import z from "zod";
import { OrchestrationTaskPanel } from "@/components/OrchestrationTaskPanel";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";

const paramsSchema = z.object({
  taskId: typedZid("tasks"),
  runId: typedZid("taskRuns"),
});

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/orchestration"
)({
  component: TaskRunOrchestration,
  params: {
    parse: paramsSchema.parse,
    stringify: (params) => ({
      taskId: params.taskId,
      runId: params.runId,
    }),
  },
  loader: async (opts) => {
    const { params } = opts;
    const { teamSlugOrId } = params;

    // Prewarm the orchestration tasks query
    convexQueryClient.convexClient.prewarmQuery({
      query: api.orchestrationQueries.listTasksByTeam,
      args: { teamSlugOrId, limit: 50 },
    });
  },
});

function TaskRunOrchestration() {
  const { teamSlugOrId } = Route.useParams();

  return (
    <div className="flex flex-col grow bg-neutral-50 dark:bg-black">
      <div className="flex flex-col grow min-h-0 border-l border-neutral-200 dark:border-neutral-800">
        <OrchestrationTaskPanel teamSlugOrId={teamSlugOrId} />
      </div>
    </div>
  );
}
