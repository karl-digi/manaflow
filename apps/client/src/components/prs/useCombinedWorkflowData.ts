import { useMemo } from "react";
import { api } from "@cmux/convex/api";
import { useQuery as useConvexQuery } from "convex/react";

export interface WorkflowRunsQueryProps {
  teamSlugOrId: string;
  repoFullName: string;
  prNumber: number;
  headSha?: string;
  limit?: number;
}

export function useCombinedWorkflowData({
  teamSlugOrId,
  repoFullName,
  prNumber,
  headSha,
  limit = 50,
}: WorkflowRunsQueryProps) {
  const workflowRuns = useConvexQuery(api.github_workflows.getWorkflowRunsForPr, {
    teamSlugOrId,
    repoFullName,
    prNumber,
    headSha,
    limit,
  });

  const checkRuns = useConvexQuery(api.github_check_runs.getCheckRunsForPr, {
    teamSlugOrId,
    repoFullName,
    prNumber,
    headSha,
    limit,
  });

  const deployments = useConvexQuery(api.github_deployments.getDeploymentsForPr, {
    teamSlugOrId,
    repoFullName,
    prNumber,
    headSha,
    limit,
  });

  const commitStatuses = useConvexQuery(
    api.github_commit_statuses.getCommitStatusesForPr,
    {
      teamSlugOrId,
      repoFullName,
      prNumber,
      headSha,
      limit,
    },
  );

  const isLoading =
    workflowRuns === undefined ||
    checkRuns === undefined ||
    deployments === undefined ||
    commitStatuses === undefined;

  const allRuns = useMemo(
    () => [
      ...(workflowRuns || []).map((run) => ({
        ...run,
        type: "workflow" as const,
        name: run.workflowName,
        timestamp: run.runStartedAt,
        url: run.htmlUrl,
      })),
      ...(checkRuns || []).map((run) => {
        const url =
          run.htmlUrl ||
          `https://github.com/${repoFullName}/pull/${prNumber}/checks?check_run_id=${run.checkRunId}`;
        return {
          ...run,
          type: "check" as const,
          timestamp: run.startedAt,
          url,
        };
      }),
      ...(deployments || [])
        .filter((dep) => dep.environment !== "Preview")
        .map((dep) => ({
          ...dep,
          type: "deployment" as const,
          name: dep.description || dep.environment || "Deployment",
          timestamp: dep.createdAt,
          status:
            dep.state === "pending" ||
            dep.state === "queued" ||
            dep.state === "in_progress"
              ? "in_progress"
              : "completed",
          conclusion:
            dep.state === "success"
              ? "success"
              : dep.state === "failure" || dep.state === "error"
                ? "failure"
                : undefined,
          url: dep.targetUrl,
        })),
      ...(commitStatuses || []).map((status) => ({
        ...status,
        type: "status" as const,
        name: status.context,
        timestamp: status.updatedAt,
        status: status.state === "pending" ? "in_progress" : "completed",
        conclusion:
          status.state === "success"
            ? "success"
            : status.state === "failure" || status.state === "error"
              ? "failure"
              : undefined,
        url: status.targetUrl,
      })),
    ],
    [workflowRuns, checkRuns, deployments, commitStatuses, repoFullName, prNumber],
  );

  return { allRuns, isLoading };
}

export type WorkflowRun = ReturnType<typeof useCombinedWorkflowData>["allRuns"][number];
