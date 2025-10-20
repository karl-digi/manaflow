import { TaskRunTerminals } from "@/components/TaskRunTerminals";
import { toTerminalServiceBaseUrl } from "@/lib/toProxyWorkspaceUrl";
import { api } from "@cmux/convex/api";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { convexQuery } from "@convex-dev/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import z from "zod";

const paramsSchema = z.object({
  taskId: typedZid("tasks"),
  runId: typedZid("taskRuns"),
});

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/terminals"
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
      })
    );
  },
});

function RunTerminalsPage() {
  const { teamSlugOrId, runId: taskRunId } = Route.useParams();
  const taskRun = useSuspenseQuery(
    convexQuery(api.taskRuns.get, {
      teamSlugOrId,
      id: taskRunId,
    })
  );

  const vscodeInfo = taskRun?.data?.vscode;
  const rawWorkspaceUrl =
    vscodeInfo?.workspaceUrl ?? vscodeInfo?.url ?? null;

  const terminalBaseUrl = useMemo(() => {
    if (!rawWorkspaceUrl) {
      return null;
    }
    return toTerminalServiceBaseUrl(rawWorkspaceUrl);
  }, [rawWorkspaceUrl]);

  return (
    <div className="flex flex-col grow bg-neutral-50 dark:bg-black">
      <div className="flex flex-col grow min-h-0 border-l border-neutral-200 dark:border-neutral-800">
        <TaskRunTerminals baseUrl={terminalBaseUrl} taskRunId={taskRunId} />
      </div>
    </div>
  );
}
