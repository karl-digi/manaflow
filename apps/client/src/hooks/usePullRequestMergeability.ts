import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  postApiIntegrationsGithubPrsMergeability,
  type PostApiIntegrationsGithubPrsMergeabilityResponse,
} from "@cmux/www-openapi-client";

type PullRequestDescriptor = {
  repoFullName?: string | null;
  number?: number | null;
};

export function usePullRequestMergeability({
  teamSlugOrId,
  pullRequests,
  enabled = true,
}: {
  teamSlugOrId: string;
  pullRequests: PullRequestDescriptor[];
  enabled?: boolean;
}) {
  const normalizedPullRequests = useMemo(() => {
    return pullRequests
      .map((pr) => ({
        repoFullName: (pr.repoFullName ?? "").trim(),
        number: typeof pr.number === "number" ? pr.number : undefined,
      }))
      .filter(
        (pr): pr is { repoFullName: string; number: number } =>
          Boolean(pr.repoFullName) && typeof pr.number === "number",
      );
  }, [pullRequests]);

  const cacheKey = useMemo(() => {
    return normalizedPullRequests
      .map((pr) => `${pr.repoFullName}#${pr.number}`)
      .sort()
      .join("|");
  }, [normalizedPullRequests]);

  const queryEnabled = enabled && normalizedPullRequests.length > 0;

  const query = useQuery<PostApiIntegrationsGithubPrsMergeabilityResponse>({
    queryKey: ["github-pr-mergeability", teamSlugOrId, cacheKey],
    queryFn: async () => {
      const { data } = await postApiIntegrationsGithubPrsMergeability({
        body: {
          teamSlugOrId,
          pullRequests: normalizedPullRequests,
        },
        throwOnError: true,
      });
      return data;
    },
    enabled: queryEnabled,
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
  });

  return {
    statuses: query.data?.statuses ?? [],
    isChecking: queryEnabled && (query.isLoading || query.isFetching),
    error: query.error,
  };
}
