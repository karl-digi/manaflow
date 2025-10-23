import { cache } from "react";

import { toGithubApiError } from "./api-helpers";
import { createGitHubClient } from "./octokit";

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

export const fetchPullRequest = cache(
  async (
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<GithubPullRequest> => {
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
  },
);

export const fetchPullRequestFiles = cache(
  async (
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<GithubPullRequestFile[]> => {
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
  },
);
