import {
  buildAuthCandidates,
  isRequestErrorShape,
  shouldRetryWithAlternateAuth,
  toGithubApiError,
} from "./api-helpers";
import { createGitHubClient } from "./octokit";
import {
  generateGitHubInstallationToken,
  getInstallationForRepo,
} from "../utils/github-app-token";

type OctokitInstance = ReturnType<typeof createGitHubClient>;

type RepositoryResponse = Awaited<
  ReturnType<OctokitInstance["rest"]["repos"]["get"]>
>;

export type GithubRepository = RepositoryResponse["data"];

type FetchRepositoryOptions = {
  authToken?: string | null;
};

export async function fetchRepository(
  owner: string,
  repo: string,
  options: FetchRepositoryOptions = {},
): Promise<GithubRepository> {
  try {
    const authCandidates = buildAuthCandidates(options.authToken);
    let lastError: unknown;

    for (const candidate of authCandidates) {
      try {
        const octokit = createGitHubClient(candidate);
        const response = await octokit.rest.repos.get({
          owner,
          repo,
        });
        return response.data;
      } catch (error) {
        lastError = error;
        if (shouldRetryWithAlternateAuth(error)) {
          continue;
        }
        throw toGithubApiError(error);
      }
    }

    if (isRequestErrorShape(lastError) && lastError.status === 404) {
      const installationId = await getInstallationForRepo(`${owner}/${repo}`);
      if (installationId) {
        const appToken = await generateGitHubInstallationToken({
          installationId,
          permissions: {
            contents: "read",
            metadata: "read",
          },
        });

        try {
          const octokit = createGitHubClient(appToken);
          const response = await octokit.rest.repos.get({
            owner,
            repo,
          });
          return response.data;
        } catch (appError) {
          throw toGithubApiError(appError);
        }
      }
    }

    if (lastError) {
      throw toGithubApiError(lastError);
    }

    throw toGithubApiError({
      status: 500,
      message: "Unable to fetch repository metadata",
    });
  } catch (error) {
    throw toGithubApiError(error);
  }
}
