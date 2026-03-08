import { FloatingPane } from "@/components/floating-pane";
import { OrchestrationDashboard } from "@/components/orchestration/OrchestrationDashboard";
import { TitleBar } from "@/components/TitleBar";
import { api } from "@cmux/convex/api";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

export const Route = createFileRoute("/_layout/$teamSlugOrId/orchestration")({
  component: OrchestrationPage,
  validateSearch: z.object({
    status: z.enum(["pending", "assigned", "running", "completed", "failed", "cancelled", "all"]).optional(),
  }),
});

function OrchestrationPage() {
  const { teamSlugOrId } = Route.useParams();
  const { status } = Route.useSearch();

  // Prefetch orchestration summary for faster dashboard loading
  const { data: summary, isLoading: summaryLoading } = useQuery(
    convexQuery(api.orchestrationQueries.getOrchestrationSummary, {
      teamSlugOrId,
    })
  );

  // Prefetch tasks list
  const { data: tasks, isLoading: tasksLoading } = useQuery(
    convexQuery(api.orchestrationQueries.listTasksWithDependencyInfo, {
      teamSlugOrId,
      status: status === "all" ? undefined : status,
      limit: 50,
    })
  );

  return (
    <FloatingPane header={<TitleBar title="Orchestration" />}>
      <OrchestrationDashboard
        teamSlugOrId={teamSlugOrId}
        summary={summary}
        summaryLoading={summaryLoading}
        tasks={tasks}
        tasksLoading={tasksLoading}
        statusFilter={status ?? "all"}
      />
    </FloatingPane>
  );
}
