import { GithubApiError } from "./errors";
import { createGitHubClient } from "./octokit";
import { generateGitHubInstallationToken, getInstallationForRepo } from "../utils/github-app-token";

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

type CompareCommitsResponse = Awaited<
  ReturnType<OctokitInstance["rest"]["repos"]["compareCommitsWithBasehead"]>
>;

export type GithubPullRequest = PullRequestResponse["data"];

export type GithubPullRequestFile =
  PullRequestFilesResponse["data"][number];

export type RepoVisibility = "public" | "private" | "unknown";

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
  pullNumber: number,
): Promise<GithubPullRequest> {
  try {
    // Try to use GitHub App installation token for private repos
    let octokit = createGitHubClient();

    // First attempt with basic token
    try {
      const response = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
      });
      return response.data;
    } catch (firstError) {
      // If 404, try with GitHub App token
      if (isRequestErrorShape(firstError) && firstError.status === 404) {
        console.log(`[fetchPullRequest] Got 404, trying with GitHub App token for ${owner}/${repo}`);

        const installationId = await getInstallationForRepo(`${owner}/${repo}`);
        if (installationId) {
          const appToken = await generateGitHubInstallationToken({
            installationId,
            permissions: {
              contents: "read",
              metadata: "read",
              pull_requests: "read",
            },
          });

          octokit = createGitHubClient(appToken);
          const response = await octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: pullNumber,
          });
          return response.data;
        }
      }
      throw firstError;
    }
  } catch (error) {
    throw toGithubApiError(error);
  }
}

export async function fetchPullRequestFiles(
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<GithubPullRequestFile[]> {
  try {
    // Try to use GitHub App installation token for private repos
    let octokit = createGitHubClient();

    // First attempt with basic token
    try {
      const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
      });
      return files;
    } catch (firstError) {
      // If 404, try with GitHub App token
      if (isRequestErrorShape(firstError) && firstError.status === 404) {
        console.log(`[fetchPullRequestFiles] Got 404, trying with GitHub App token for ${owner}/${repo}`);

        const installationId = await getInstallationForRepo(`${owner}/${repo}`);
        if (installationId) {
          const appToken = await generateGitHubInstallationToken({
            installationId,
            permissions: {
              contents: "read",
              metadata: "read",
              pull_requests: "read",
            },
          });

          octokit = createGitHubClient(appToken);
          const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
            owner,
            repo,
            pull_number: pullNumber,
            per_page: 100,
          });
          return files;
        }
      }
      throw firstError;
    }
  } catch (error) {
    throw toGithubApiError(error);
  }
}

type GithubComparisonFile = NonNullable<CompareCommitsResponse["data"]["files"]>[number];

export type GithubComparison = CompareCommitsResponse["data"];

export type GithubFileChange = {
  filename: GithubPullRequestFile["filename"];
  status: GithubPullRequestFile["status"];
  additions: GithubPullRequestFile["additions"];
  deletions: GithubPullRequestFile["deletions"];
  changes: GithubPullRequestFile["changes"];
  previous_filename?: GithubPullRequestFile["previous_filename"];
  patch?: GithubPullRequestFile["patch"];
};

export function toGithubFileChange(
  file: GithubPullRequestFile | GithubComparisonFile,
): GithubFileChange {
  return {
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    previous_filename: file.previous_filename,
    patch: file.patch,
  };
}

export async function fetchRepositoryVisibility(
  owner: string,
  repo: string,
): Promise<RepoVisibility> {
  try {
    const octokit = createGitHubClient();
    const response = await octokit.rest.repos.get({ owner, repo });
    const repository = response.data;

    if (repository.private) {
      return "private";
    }

    if (repository.visibility === "private") {
      return "private";
    }

    if (repository.visibility === "public") {
      return "public";
    }

    return "public";
  } catch (error) {
    if (isRequestErrorShape(error)) {
      if (error.status === 404) {
        // GitHub returns 404 for private repositories when unauthenticated.
        return "private";
      }

      if (error.status === 403) {
        return "unknown";
      }
    }

    return "unknown";
  }
}

export async function fetchComparison(
  owner: string,
  repo: string,
  baseRef: string,
  headRef: string,
): Promise<GithubComparison> {
  try {
    const octokit = createGitHubClient();
    const response = await octokit.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${baseRef}...${headRef}`,
      per_page: 100,
    });
    return response.data;
  } catch (error) {
    throw toGithubApiError(error);
  }
}
