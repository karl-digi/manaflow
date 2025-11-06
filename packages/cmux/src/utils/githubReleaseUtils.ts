import { logger } from "../logger";

export interface GitHubRelease {
  tag_name: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

/**
 * Fetches the latest GitHub release, including draft releases if includeDrafts is true.
 * Requires GITHUB_TOKEN environment variable for authentication to access draft releases.
 */
export async function fetchLatestGitHubRelease(
  includeDrafts: boolean = false
): Promise<GitHubRelease | null> {
  const repo = "manaflow-ai/cmux";

  try {
    if (!includeDrafts) {
      // Use the standard latest release endpoint (excludes drafts and prereleases)
      const url = `https://api.github.com/repos/${repo}/releases/latest`;
      const headers: Record<string, string> = {
        "Accept": "application/vnd.github+json",
      };

      // Add auth token if available for higher rate limits
      if (process.env.GITHUB_TOKEN) {
        headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
      }

      const response = await fetch(url, { headers });

      if (!response.ok) {
        await logger.error(`Failed to fetch latest release: ${response.status} ${response.statusText}`);
        return null;
      }

      const release = await response.json() as GitHubRelease;
      return release;
    } else {
      // Fetch all releases and get the latest one (including drafts)
      // This requires authentication
      if (!process.env.GITHUB_TOKEN) {
        await logger.error("GITHUB_TOKEN environment variable is required to fetch draft releases");
        return null;
      }

      const url = `https://api.github.com/repos/${repo}/releases`;
      const headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${process.env.GITHUB_TOKEN}`,
      };

      const response = await fetch(url, { headers });

      if (!response.ok) {
        await logger.error(`Failed to fetch releases: ${response.status} ${response.statusText}`);
        return null;
      }

      const releases = await response.json() as GitHubRelease[];

      // Sort by published_at (most recent first) and return the first one
      // This will include draft releases
      if (releases.length === 0) {
        await logger.info("No releases found");
        return null;
      }

      // The API returns releases sorted by created_at by default, so the first one is the latest
      const latestRelease = releases[0];
      await logger.info(`Found latest release: ${latestRelease.tag_name} (draft: ${latestRelease.draft})`);
      return latestRelease;
    }
  } catch (error) {
    await logger.error(`Error fetching GitHub release: ${error}`);
    return null;
  }
}

/**
 * Extracts the version number from a release tag (e.g., "v0.2.39" -> "0.2.39")
 */
export function normalizeVersion(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

/**
 * Downloads a GitHub release asset to a local file path
 */
export async function downloadReleaseAsset(
  downloadUrl: string,
  destinationPath: string
): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      "Accept": "application/octet-stream",
    };

    if (process.env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const response = await fetch(downloadUrl, { headers });

    if (!response.ok) {
      await logger.error(`Failed to download asset: ${response.status} ${response.statusText}`);
      return false;
    }

    const buffer = await response.arrayBuffer();
    const fs = await import("node:fs/promises");
    await fs.writeFile(destinationPath, Buffer.from(buffer));

    await logger.info(`Downloaded release asset to ${destinationPath}`);
    return true;
  } catch (error) {
    await logger.error(`Error downloading release asset: ${error}`);
    return false;
  }
}
