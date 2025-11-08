const GITHUB_REPO_URL = "https://github.com/manaflow-ai/cmux";
const GITHUB_REPO_API_URL = "https://api.github.com/repos/manaflow-ai/cmux";

export type GithubRepoStats = {
  repoUrl: string;
  name: string;
  stars: number | null;
};

const defaultStats: GithubRepoStats = {
  repoUrl: GITHUB_REPO_URL,
  name: "manaflow-ai/cmux",
  stars: null,
};

type GithubRepoResponse = {
  stargazers_count?: number;
  full_name?: string;
  html_url?: string;
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

    return {
      repoUrl: typeof data.html_url === "string" ? data.html_url : GITHUB_REPO_URL,
      name:
        typeof data.full_name === "string" && data.full_name.trim() !== ""
          ? data.full_name
          : defaultStats.name,
      stars: typeof data.stargazers_count === "number" ? data.stargazers_count : null,
    };
  } catch (error) {
    console.error("Failed to retrieve GitHub repository stats", error);
    return defaultStats;
  }
}
