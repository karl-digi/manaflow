const GITHUB_REPO_API_URL = "https://api.github.com/repos/manaflow-ai/cmux";

type GithubRepoResponse = {
  stargazers_count?: number;
};

export type GithubRepoStats = {
  stargazersCount: number | null;
};

const defaultStats: GithubRepoStats = {
  stargazersCount: null,
};

export async function fetchGithubRepoStats(): Promise<GithubRepoStats> {
  try {
    const response = await fetch(GITHUB_REPO_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
      },
      next: {
        revalidate: 3600,
      },
    });

    if (!response.ok) {
      return defaultStats;
    }

    const data = (await response.json()) as GithubRepoResponse;
    const stargazersCount =
      typeof data.stargazers_count === "number" ? data.stargazers_count : null;

    return { stargazersCount };
  } catch (error) {
    console.error("Failed to retrieve GitHub repository stats", error);
    return defaultStats;
  }
}
