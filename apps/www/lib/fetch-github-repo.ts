import { cache } from "react";

export type GithubRepoStats = {
  url: string;
  stars: number | null;
};

type GithubRepoResponse = {
  stargazers_count?: number;
};

export const CMUX_GITHUB_REPO_URL = "https://github.com/manaflow-ai/cmux";
const CMUX_GITHUB_REPO_API_URL =
  "https://api.github.com/repos/manaflow-ai/cmux";

const FALLBACK_STATS: GithubRepoStats = {
  url: CMUX_GITHUB_REPO_URL,
  stars: null,
};

export const fetchGithubRepoStats = cache(async (): Promise<GithubRepoStats> => {
  try {
    const response = await fetch(CMUX_GITHUB_REPO_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
      },
      next: {
        revalidate: 3600,
      },
    });

    if (!response.ok) {
      return FALLBACK_STATS;
    }

    const payload = (await response.json()) as GithubRepoResponse;
    const stars =
      typeof payload.stargazers_count === "number"
        ? payload.stargazers_count
        : null;

    return {
      url: CMUX_GITHUB_REPO_URL,
      stars,
    };
  } catch (error) {
    console.error("Failed to fetch GitHub repo stats", error);
    return FALLBACK_STATS;
  }
});
