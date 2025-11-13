import { isFakeConvexId } from "@/lib/fakeConvexId";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { useQuery } from "convex/react";
// Read team slug from path to avoid route type coupling
import { Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

interface CrownEvaluationProps {
  taskId: Id<"tasks">;
  teamSlugOrId: string;
}

export function CrownEvaluation({
  taskId,
  teamSlugOrId,
}: CrownEvaluationProps) {
  const evaluation = useQuery(
    api.crown.getCrownEvaluation,
    isFakeConvexId(taskId) ? "skip" : { teamSlugOrId, taskId }
  );
  const crownedRun = useQuery(
    api.crown.getCrownedRun,
    isFakeConvexId(taskId) ? "skip" : { teamSlugOrId, taskId }
  );

  if (!evaluation || !crownedRun) {
    return null;
  }

  // Prefer stored agentName, use "Unknown" when missing
  const crownedPullRequests = crownedRun.pullRequests ?? [];
  const fallbackPullRequestUrl =
    crownedRun.pullRequestUrl && crownedRun.pullRequestUrl !== "pending"
      ? crownedRun.pullRequestUrl
      : undefined;

  // Prefer stored agentName, use "Unknown" when missing
  const storedAgentName = crownedRun.agentName?.trim();
  const agentName =
    storedAgentName && storedAgentName.length > 0 ? storedAgentName : "unknown agent";

  return (
    <Card className="border-yellow-200 dark:border-yellow-900 bg-yellow-50 dark:bg-yellow-950/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Trophy className="w-5 h-5 text-yellow-600 dark:text-yellow-500" />
          Crown Winner: {agentName}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div>
            <h4 className="font-medium text-sm text-neutral-600 dark:text-neutral-400 mb-1">
              Evaluation Reason
            </h4>
            <p className="text-sm text-neutral-800 dark:text-neutral-200">
              {crownedRun.crownReason ||
                "This implementation was selected as the best solution."}
            </p>
          </div>

          {crownedPullRequests.length > 0 ? (
            <div>
              <h4 className="font-medium text-sm text-neutral-600 dark:text-neutral-400 mb-1">
                Pull Requests
              </h4>
              <div className="flex flex-col gap-1">
                {crownedPullRequests.map((pr) => (
                  pr.url ? (
                    <a
                      key={pr.repoFullName}
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {pr.repoFullName} ({pr.state ?? "none"}) →
                    </a>
                  ) : (
                    <span
                      key={pr.repoFullName}
                      className="text-sm text-neutral-500 dark:text-neutral-400"
                    >
                      {pr.repoFullName} ({pr.state ?? "none"})
                    </span>
                  )
                ))}
              </div>
            </div>
          ) : fallbackPullRequestUrl ? (
            <div>
              <h4 className="font-medium text-sm text-neutral-600 dark:text-neutral-400 mb-1">
                Pull Request
              </h4>
              <a
                href={fallbackPullRequestUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                {crownedRun.pullRequestIsDraft ? "View draft PR" : "View PR"} →
              </a>
            </div>
          ) : null}

          <div className="pt-2 border-t border-yellow-200 dark:border-yellow-800">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Evaluated against {evaluation.candidateRunIds.length}{" "}
              implementations
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
