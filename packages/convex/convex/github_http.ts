"use node";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { Octokit } from "octokit";
import { parseGithubRepoUrl } from "@cmux/shared";
import { parseLocalRepoPath } from "@cmux/shared/node";

// Add a manual repository from a custom URL
export const addManualRepo = action({
  args: {
    teamSlugOrId: v.string(),
    repoUrl: v.string(),
  },
  handler: async (ctx, { teamSlugOrId, repoUrl }): Promise<{ success: boolean; repoId: Id<"repos">; fullName: string }> => {
    // Parse the repo URL
    const parsed = parseGithubRepoUrl(repoUrl);
    if (!parsed) {
      throw new Error("Invalid GitHub repository URL");
    }

    // Check if the repo is public using GitHub API
    try {
      // Create Octokit instance without authentication (for public repos only)
      const octokit = new Octokit({
        userAgent: "cmux",
        request: {
          timeout: 10_000,
        },
      });

      const { data } = await octokit.rest.repos.get({
        owner: parsed.owner,
        repo: parsed.repo,
      });

      if (data.private) {
        throw new Error("Private repositories are not supported for manual addition");
      }

      // Get the authenticated user
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) {
        throw new Error("Not authenticated");
      }

      // Verify team access by calling an authQuery (this will throw if user is not a team member)
      await ctx.runQuery(api.github.hasReposForTeam, { teamSlugOrId });

      // Check if repo already exists
      const existing = await ctx.runQuery(internal.github.getRepoByFullNameInternal, {
        teamSlugOrId,
        fullName: parsed.fullName,
      });

      if (existing) {
        return { success: true, repoId: existing._id, fullName: parsed.fullName };
      }

      // Validate owner type
      const ownerType = data.owner.type;
      if (ownerType !== "User" && ownerType !== "Organization") {
        throw new Error(`Invalid owner type: ${data.owner.type}`);
      }

      // Insert the manual repo
      const repoId = await ctx.runMutation(internal.github.insertManualRepoInternal, {
        teamSlugOrId,
        userId: identity.subject,
        fullName: parsed.fullName,
        org: parsed.owner,
        name: parsed.repo,
        gitRemote: parsed.gitUrl,
        providerRepoId: data.id,
        ownerLogin: data.owner.login,
        ownerType,
        defaultBranch: data.default_branch,
        lastPushedAt: data.pushed_at ? new Date(data.pushed_at).getTime() : undefined,
      });

      return { success: true, repoId, fullName: parsed.fullName };
    } catch (error) {
      // Handle Octokit errors with status codes
      if (error && typeof error === "object" && "status" in error) {
        if (error.status === 404) {
          throw new Error("Repository not found or is private");
        }
        throw new Error(`GitHub API error: ${error.status}`);
      }

      // Re-throw known errors
      if (error instanceof Error) {
        throw error;
      }

      throw new Error("Failed to validate repository");
    }
  },
});

// Add a local repository from a file path
export const addLocalRepo = action({
  args: {
    teamSlugOrId: v.string(),
    repoPath: v.string(),
    archiveStorageId: v.string(), // Storage ID for the git archive created by Hono endpoint
  },
  handler: async (ctx, { teamSlugOrId, repoPath, archiveStorageId }): Promise<{ success: boolean; repoId: Id<"repos">; fullName: string }> => {
    // Parse the local repo path
    const parsed = parseLocalRepoPath(repoPath);
    if (!parsed) {
      throw new Error("Invalid local repository path");
    }

    // Get the authenticated user
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Verify team access by calling an authQuery (this will throw if user is not a team member)
    await ctx.runQuery(api.github.hasReposForTeam, { teamSlugOrId });

    // Extract repo name from path (last directory component)
    const pathParts = parsed.resolvedPath.split("/").filter(Boolean);
    const repoName = pathParts[pathParts.length - 1] || "local-repo";
    const orgName = "local";
    const fullName = `${orgName}/${repoName}`;

    // Check if repo already exists
    const existing = await ctx.runQuery(internal.github.getRepoByFullNameInternal, {
      teamSlugOrId,
      fullName,
    });

    if (existing) {
      return { success: true, repoId: existing._id, fullName };
    }

    // Insert the local repo
    const repoId = await ctx.runMutation(internal.github.insertLocalRepoInternal, {
      teamSlugOrId,
      userId: identity.subject,
      fullName,
      org: orgName,
      name: repoName,
      gitRemote: parsed.resolvedPath, // Store the resolved local path
      defaultBranch: "main", // Default, will be updated when archive is processed
      archiveStorageId,
    });

    return { success: true, repoId, fullName };
  },
});
