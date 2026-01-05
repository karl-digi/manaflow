import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";

export const list = authQuery({
  args: {
    teamSlugOrId: v.string(),
    environmentId: v.id("environments"),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const environment = await ctx.db.get(args.environmentId);
    if (!environment || environment.teamId !== teamId) {
      throw new Error("Environment not found");
    }

    const versions = await ctx.db
      .query("environmentSnapshotVersions")
      .withIndex("by_environment_version", (q) =>
        q.eq("environmentId", args.environmentId)
      )
      .order("desc")
      .collect();

    const activeSnapshotId = environment.snapshotId ?? environment.morphSnapshotId;
    const activeSnapshotProvider =
      environment.snapshotProvider ?? (environment.morphSnapshotId ? "morph" : "other");

    return versions.map((version) => ({
      ...version,
      isActive:
        (version.snapshotId ?? version.morphSnapshotId) === activeSnapshotId &&
        (version.snapshotProvider ??
          (version.morphSnapshotId ? "morph" : "other")) === activeSnapshotProvider,
    }));
  },
});

export const create = authMutation({
  args: {
    teamSlugOrId: v.string(),
    environmentId: v.id("environments"),
    snapshotId: v.string(),
    snapshotProvider: v.union(
      v.literal("morph"),
      v.literal("pve-lxc"),
      v.literal("pve-vm"),
      v.literal("docker"),
      v.literal("daytona"),
      v.literal("other")
    ),
    templateVmid: v.optional(v.number()),
    label: v.optional(v.string()),
    activate: v.optional(v.boolean()),
    maintenanceScript: v.optional(v.string()),
    devScript: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const environment = await ctx.db.get(args.environmentId);
    if (!environment || environment.teamId !== teamId) {
      throw new Error("Environment not found");
    }
    const userId = ctx.identity.subject;
    if (!userId) {
      throw new Error("Authentication required");
    }

    const latest = await ctx.db
      .query("environmentSnapshotVersions")
      .withIndex("by_environment_version", (q) =>
        q.eq("environmentId", args.environmentId)
      )
      .order("desc")
      .first();

    const nextVersion = (latest?.version ?? 0) + 1;
    const createdAt = Date.now();
    const maintenanceScript =
      args.maintenanceScript ?? environment.maintenanceScript ?? undefined;
    const devScript = args.devScript ?? environment.devScript ?? undefined;
    const legacyMorphSnapshotId =
      args.snapshotProvider === "morph" ? args.snapshotId : undefined;
    const templateVmid =
      args.snapshotProvider === "pve-lxc" || args.snapshotProvider === "pve-vm"
        ? args.templateVmid
        : undefined;

    const snapshotVersionId = await ctx.db.insert(
      "environmentSnapshotVersions",
      {
        environmentId: args.environmentId,
        teamId,
        snapshotId: args.snapshotId,
        snapshotProvider: args.snapshotProvider,
        morphSnapshotId: legacyMorphSnapshotId,
        templateVmid,
        version: nextVersion,
        createdAt,
        createdByUserId: userId,
        label: args.label,
        maintenanceScript,
        devScript,
      }
    );

    if (args.activate ?? true) {
      await ctx.db.patch(args.environmentId, {
        snapshotId: args.snapshotId,
        snapshotProvider: args.snapshotProvider,
        morphSnapshotId: legacyMorphSnapshotId,
        templateVmid,
        maintenanceScript,
        devScript,
        updatedAt: Date.now(),
      });
    }

    return {
      snapshotVersionId,
      version: nextVersion,
    };
  },
});

export const activate = authMutation({
  args: {
    teamSlugOrId: v.string(),
    environmentId: v.id("environments"),
    snapshotVersionId: v.id("environmentSnapshotVersions"),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const environment = await ctx.db.get(args.environmentId);
    if (!environment || environment.teamId !== teamId) {
      throw new Error("Environment not found");
    }

    const versionDoc = await ctx.db.get(args.snapshotVersionId);
    if (
      !versionDoc ||
      versionDoc.environmentId !== args.environmentId ||
      versionDoc.teamId !== teamId
    ) {
      throw new Error("Snapshot version not found");
    }

    const maintenanceScript =
      versionDoc.maintenanceScript ?? environment.maintenanceScript ?? undefined;
    const devScript =
      versionDoc.devScript ?? environment.devScript ?? undefined;

    await ctx.db.patch(args.environmentId, {
      snapshotId: versionDoc.snapshotId ?? versionDoc.morphSnapshotId,
      snapshotProvider:
        versionDoc.snapshotProvider ??
        (versionDoc.morphSnapshotId ? "morph" : "other"),
      morphSnapshotId: versionDoc.morphSnapshotId,
      templateVmid: versionDoc.templateVmid,
      maintenanceScript,
      devScript,
      updatedAt: Date.now(),
    });

    return {
      snapshotId: versionDoc.snapshotId ?? versionDoc.morphSnapshotId ?? "",
      snapshotProvider:
        versionDoc.snapshotProvider ??
        (versionDoc.morphSnapshotId ? "morph" : "other"),
      templateVmid: versionDoc.templateVmid,
      version: versionDoc.version,
    };
  },
});

export const remove = authMutation({
  args: {
    teamSlugOrId: v.string(),
    environmentId: v.id("environments"),
    snapshotVersionId: v.id("environmentSnapshotVersions"),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const environment = await ctx.db.get(args.environmentId);

    if (!environment || environment.teamId !== teamId) {
      throw new Error("Environment not found");
    }

    const versionDoc = await ctx.db.get(args.snapshotVersionId);

    if (
      !versionDoc ||
      versionDoc.environmentId !== args.environmentId ||
      versionDoc.teamId !== teamId
    ) {
      throw new Error("Snapshot version not found");
    }

    const activeSnapshotId = environment.snapshotId ?? environment.morphSnapshotId;
    const versionSnapshotId = versionDoc.snapshotId ?? versionDoc.morphSnapshotId;
    if (versionSnapshotId && versionSnapshotId === activeSnapshotId) {
      throw new Error("Cannot delete the active snapshot version.");
    }

    await ctx.db.delete(args.snapshotVersionId);
  },
});

export const findBySnapshotId = authQuery({
  args: {
    teamSlugOrId: v.string(),
    snapshotId: v.string(),
    snapshotProvider: v.optional(
      v.union(
        v.literal("morph"),
        v.literal("pve-lxc"),
        v.literal("pve-vm"),
        v.literal("docker"),
        v.literal("daytona"),
        v.literal("other")
      )
    ),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const provider = args.snapshotProvider;
    if (provider) {
      return await ctx.db
        .query("environmentSnapshotVersions")
        .withIndex("by_team_snapshot", (q) =>
          q.eq("teamId", teamId).eq("snapshotId", args.snapshotId)
        )
        .filter((q) => q.eq(q.field("snapshotProvider"), provider))
        .first();
    }

    const canonical = await ctx.db
      .query("environmentSnapshotVersions")
      .withIndex("by_team_snapshot", (q) =>
        q.eq("teamId", teamId).eq("snapshotId", args.snapshotId)
      )
      .first();
    if (canonical) {
      return canonical;
    }

    return await ctx.db
      .query("environmentSnapshotVersions")
      .withIndex("by_team_snapshot_legacy", (q) =>
        q.eq("teamId", teamId).eq("morphSnapshotId", args.snapshotId)
      )
      .first();
  },
});
