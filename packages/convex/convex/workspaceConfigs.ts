import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";

const normalizeProjectFullName = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Invalid input: projectFullName is required and cannot be empty. Please provide a valid project name in the format 'owner/repository'.");
  }
  return trimmed;
};

const normalizeScript = (
  script: string | undefined,
): string | undefined => {
  if (script === undefined) {
    return undefined;
  }
  const trimmed = script.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const get = authQuery({
  args: {
    teamSlugOrId: v.string(),
    projectFullName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;

    if (!userId) {
      throw new Error("Authentication required. Please sign in to access workspace configurations.");
    }

    let teamId;
    try {
      teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    } catch (error) {
      throw new Error(`Failed to resolve team: ${error instanceof Error ? error.message : 'Team not found or access denied'}`);
    }

    const projectFullName = normalizeProjectFullName(args.projectFullName);

    try {
      const config = await ctx.db
        .query("workspaceConfigs")
        .withIndex("by_team_user_repo", (q) =>
          q
            .eq("teamId", teamId)
            .eq("userId", userId)
            .eq("projectFullName", projectFullName),
        )
        .first();

      return config ?? null;
    } catch (error) {
      throw new Error(`Failed to query workspace configuration: ${error instanceof Error ? error.message : 'Database query failed'}`);
    }
  },
});

export const upsert = authMutation({
  args: {
    teamSlugOrId: v.string(),
    projectFullName: v.string(),
    maintenanceScript: v.optional(v.string()),
    dataVaultKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;

    if (!userId) {
      throw new Error("Authentication required. Please sign in to save workspace configurations.");
    }

    let teamId;
    try {
      teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    } catch (error) {
      throw new Error(`Failed to resolve team: ${error instanceof Error ? error.message : 'Team not found or access denied'}`);
    }

    const projectFullName = normalizeProjectFullName(args.projectFullName);
    const maintenanceScript = normalizeScript(args.maintenanceScript);
    const now = Date.now();

    // Check for existing config
    let existing;
    try {
      existing = await ctx.db
        .query("workspaceConfigs")
        .withIndex("by_team_user_repo", (q) =>
          q
            .eq("teamId", teamId)
            .eq("userId", userId)
            .eq("projectFullName", projectFullName),
        )
        .first();
    } catch (error) {
      throw new Error(`Failed to query existing configuration: ${error instanceof Error ? error.message : 'Database query failed'}`);
    }

    try {
      if (existing) {
        await ctx.db.patch(existing._id, {
          maintenanceScript,
          dataVaultKey: args.dataVaultKey ?? existing.dataVaultKey,
          updatedAt: now,
        });
        return existing._id;
      }

      // No existing config, create new
      const id = await ctx.db.insert("workspaceConfigs", {
        projectFullName,
        maintenanceScript,
        dataVaultKey: args.dataVaultKey,
        createdAt: now,
        updatedAt: now,
        userId,
        teamId,
      });

      return id;
    } catch (error) {
      throw new Error(`Failed to save workspace configuration: ${error instanceof Error ? error.message : 'Database operation failed'}`);
    }
  },
});
