import "server-only";

import { cache } from "react";

import { CMUX_GITHUB_REPO_NAME, CMUX_GITHUB_REPO_OWNER } from "./constants";

const GITHUB_REPO_API_URL = `https://api.github.com/repos/${CMUX_GITHUB_REPO_OWNER}/${CMUX_GITHUB_REPO_NAME}`;
const REVALIDATE_SECONDS = 60 * 30;
const CACHE_TAG = "github:repo:cmux";

export type CmuxGithubRepoMetadata = {
  stargazersCount: number | null;
};

const fetchCmuxRepo = cache(async () => {
  const response = await fetch(GITHUB_REPO_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "cmux-www-site",
    },
    next: {
      revalidate: REVALIDATE_SECONDS,
      tags: [CACHE_TAG],
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch cmux GitHub metadata (${response.status})`);
  }

  return (await response.json()) as {
    stargazers_count?: number;
  };
});

export async function getCmuxGithubRepoMetadata(): Promise<CmuxGithubRepoMetadata> {
  try {
    const repo = await fetchCmuxRepo();

    return {
      stargazersCount:
        typeof repo.stargazers_count === "number" ? repo.stargazers_count : null,
    };
  } catch (error) {
    console.error("Failed to load cmux GitHub metadata", error);
    return { stargazersCount: null };
  }
}
