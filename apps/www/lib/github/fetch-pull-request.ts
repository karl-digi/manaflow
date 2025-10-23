import { GithubApiError } from "./errors";
import { createGitHubClient } from "./octokit";

type RequestErrorShape = {
  status?: number;
  message?: string;
  documentation_url?: string;
};

type OctokitInstance = ReturnType<typeof createGitHubClient>;

type PullRequestResponse = Awaited<
  ReturnType<OctokitInstance["rest"]["pulls"]["get"]>
>;

type PullRequestFilesResponse = Awaited<
  ReturnType<OctokitInstance["rest"]["pulls"]["listFiles"]>
>;

export type GithubPullRequest = PullRequestResponse["data"];

export type GithubPullRequestFile =
  PullRequestFilesResponse["data"][number];

function toGithubApiError(error: unknown): GithubApiError {
  if (error instanceof GithubApiError) {
    return error;
  }

  if (isRequestErrorShape(error)) {
    const status = typeof error.status === "number" ? error.status : 500;
    const message =
      typeof error.message === "string"
        ? error.message
        : "Unexpected GitHub API error";
    const documentationUrl =
      typeof error.documentation_url === "string"
        ? error.documentation_url
        : undefined;

    return new GithubApiError(message, { status, documentationUrl });
  }

  return new GithubApiError("Unexpected GitHub API error", {
    status: 500,
  });
}

function isRequestErrorShape(error: unknown): error is RequestErrorShape {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const maybeShape = error as Record<string, unknown>;
  return (
    "status" in maybeShape ||
    "message" in maybeShape ||
    "documentation_url" in maybeShape
  );
}

export async function fetchPullRequest(
  owner: string,
  repo: string,
  pullNumber: number
): Promise<GithubPullRequest> {
  try {
    const octokit = createGitHubClient();
    const response = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    return response.data;
  } catch (error) {
    throw toGithubApiError(error);
  }
}

export async function fetchPullRequestFiles(
  owner: string,
  repo: string,
  pullNumber: number
): Promise<GithubPullRequestFile[]> {
  try {
    const octokit = createGitHubClient();
    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });
    return files;
  } catch (error) {
    throw toGithubApiError(error);
  }
}

export async function findPullRequestNumberByBaseHead({
  owner,
  repo,
  baseRef,
  headRef,
  headOwner,
}: {
  owner: string;
  repo: string;
  baseRef: string;
  headRef: string;
  headOwner: string;
}): Promise<number | null> {
  try {
    const octokit = createGitHubClient();
    const headIdentifier = `${headOwner}:${headRef}`;
    const { data } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "all",
      head: headIdentifier,
      per_page: 100,
    });

    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    const normalizedBase = baseRef.toLowerCase();
    const normalizedHead = headRef.toLowerCase();
    const normalizedOwner = headOwner.toLowerCase();

    const primaryMatch = data.find((pr) => {
      const prBase = pr.base?.ref?.toLowerCase() ?? null;
      const prHead = pr.head?.ref?.toLowerCase() ?? null;
      const prHeadOwner =
        pr.head?.repo?.owner?.login?.toLowerCase() ??
        pr.head?.user?.login?.toLowerCase() ??
        null;

      return (
        prBase === normalizedBase &&
        prHead === normalizedHead &&
        prHeadOwner === normalizedOwner
      );
    });

    if (primaryMatch) {
      return primaryMatch.number;
    }

    const secondaryMatch = data.find((pr) => {
      const prBase = pr.base?.ref?.toLowerCase() ?? null;
      const prHead = pr.head?.ref?.toLowerCase() ?? null;
      return prBase === normalizedBase && prHead === normalizedHead;
    });

    if (secondaryMatch) {
      return secondaryMatch.number;
    }

    const fallbackMatch = data.find((pr) => {
      const prHead = pr.head?.ref?.toLowerCase() ?? null;
      return prHead === normalizedHead;
    });

    return fallbackMatch ? fallbackMatch.number : null;
  } catch (error) {
    throw toGithubApiError(error);
  }
}
