import { NextResponse } from "next/server";

export const runtime = "edge";

// Revalidate every hour
export const revalidate = 3600;

type GitHubRepoData = {
  stargazers_count: number;
};

export async function GET() {
  try {
    const response = await fetch(
      "https://api.github.com/repos/manaflow-ai/cmux",
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "cmux-website",
        },
        next: {
          revalidate: 3600, // Cache for 1 hour
        },
      }
    );

    if (!response.ok) {
      console.error("GitHub API error:", response.status, response.statusText);
      return NextResponse.json(
        { error: "Failed to fetch GitHub data" },
        { status: response.status }
      );
    }

    const data = (await response.json()) as GitHubRepoData;
    const stars = data.stargazers_count;

    return NextResponse.json(
      { stars },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
        },
      }
    );
  } catch (error) {
    console.error("Error fetching GitHub stars:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
