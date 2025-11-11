"use node";
import { v } from "convex/values";
import { fetchInstallationAccessToken } from "../_shared/githubApp";
import { internalAction } from "./_generated/server";

function generate0githubUrl(prUrl: string): string {
  return prUrl.replace("github.com", "0github.com");
}

export const addPrReaction = internalAction({
  args: {
    installationId: v.number(),
    repoFullName: v.string(),
    prNumber: v.number(),
    content: v.literal("eyes"),
  },
  handler: async (
    _ctx,
    { installationId, repoFullName, prNumber, content },
  ) => {
    try {
      const accessToken = await fetchInstallationAccessToken(installationId);
      if (!accessToken) {
        console.error(
          "[github_pr_comments] Failed to get access token for installation",
          { installationId },
        );
        return { ok: false, error: "Failed to get access token" };
      }

      const response = await fetch(
        `https://api.github.com/repos/${repoFullName}/issues/${prNumber}/reactions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "cmux-github-bot",
          },
          body: JSON.stringify({ content }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "[github_pr_comments] Failed to add reaction",
          {
            installationId,
            repoFullName,
            prNumber,
            status: response.status,
            error: errorText,
          },
        );
        return {
          ok: false,
          error: `GitHub API error: ${response.status}`,
        };
      }

      const data = await response.json();
      console.log("[github_pr_comments] Successfully added reaction", {
        installationId,
        repoFullName,
        prNumber,
        reactionId: data.id,
      });

      return { ok: true, reactionId: data.id };
    } catch (error) {
      console.error(
        "[github_pr_comments] Unexpected error adding reaction",
        {
          installationId,
          repoFullName,
          prNumber,
          error,
        },
      );
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

export const addPrComment = internalAction({
  args: {
    installationId: v.number(),
    repoFullName: v.string(),
    prNumber: v.number(),
    prUrl: v.string(),
    screenshots: v.optional(v.array(v.string())),
  },
  handler: async (
    _ctx,
    { installationId, repoFullName, prNumber, prUrl, screenshots },
  ) => {
    try {
      const accessToken = await fetchInstallationAccessToken(installationId);
      if (!accessToken) {
        console.error(
          "[github_pr_comments] Failed to get access token for installation",
          { installationId },
        );
        return { ok: false, error: "Failed to get access token" };
      }

      // Build comment body
      const zeroGithubUrl = generate0githubUrl(prUrl);
      let commentBody = `[View on 0github](${zeroGithubUrl})`;

      // Add screenshots if provided
      if (screenshots && screenshots.length > 0) {
        commentBody += "\n\n## Screenshots\n\n";
        for (const screenshotUrl of screenshots) {
          commentBody += `![Screenshot](${screenshotUrl})\n\n`;
        }
      }

      const response = await fetch(
        `https://api.github.com/repos/${repoFullName}/issues/${prNumber}/comments`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "cmux-github-bot",
          },
          body: JSON.stringify({ body: commentBody }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "[github_pr_comments] Failed to add comment",
          {
            installationId,
            repoFullName,
            prNumber,
            status: response.status,
            error: errorText,
          },
        );
        return {
          ok: false,
          error: `GitHub API error: ${response.status}`,
        };
      }

      const data = await response.json();
      console.log("[github_pr_comments] Successfully added comment", {
        installationId,
        repoFullName,
        prNumber,
        commentId: data.id,
      });

      return { ok: true, commentId: data.id };
    } catch (error) {
      console.error(
        "[github_pr_comments] Unexpected error adding comment",
        {
          installationId,
          repoFullName,
          prNumber,
          error,
        },
      );
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
