import { toGithubApiError } from "./api-helpers";
import { createGitHubClient } from "./octokit";

type OctokitInstance = ReturnType<typeof createGitHubClient>;

type CompareResponse = Awaited<
  ReturnType<
    OctokitInstance["rest"]["repos"]["compareCommitsWithBasehead"]
  >
>;

export type GithubCompare = CompareResponse["data"];

export type GithubCompareFile = NonNullable<GithubCompare["files"]>[number];

export async function fetchCompare(
  owner: string,
  repo: string,
  basehead: string,
): Promise<GithubCompare> {
  try {
    const octokit = createGitHubClient();
    const response = await octokit.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead,
    });
    return response.data;
  } catch (error) {
    throw toGithubApiError(error);
  }
}
