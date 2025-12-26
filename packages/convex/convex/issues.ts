import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { resolveTeamIdLoose } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";

// =============================================================================
// Types
// =============================================================================

const issueStatusValidator = v.union(
  v.literal("open"),
  v.literal("in_progress"),
  v.literal("blocked"),
  v.literal("closed"),
  v.literal("tombstone")
);

const issueTypeValidator = v.union(
  v.literal("bug"),
  v.literal("feature"),
  v.literal("task"),
  v.literal("epic"),
  v.literal("chore")
);

const dependencyTypeValidator = v.union(
  v.literal("blocks"),
  v.literal("related"),
  v.literal("discovered-from"),
  v.literal("duplicates"),
  v.literal("supersedes")
);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate the next shortId for a new issue.
 * For root issues: "1", "2", "3", ...
 * For children: "1.1", "1.2", "2.1", ...
 *
 * Note: Convex's Optimistic Concurrency Control (OCC) provides the primary protection
 * against concurrent mutations generating duplicate IDs. If the sibling query results
 * change between read and commit, the mutation is automatically retried with fresh data.
 * The uniqueness check below is a defensive measure for additional safety.
 */
async function generateShortId(
  ctx: MutationCtx | QueryCtx,
  teamId: string,
  parentIssueId?: Id<"issues">
): Promise<{ shortId: string; orderIndex: number }> {
  // Get parent info if needed
  let parentShortId: string | undefined;
  if (parentIssueId) {
    const parent = await ctx.db.get(parentIssueId);
    if (!parent) {
      throw new ConvexError("Parent issue not found");
    }
    // Validate parent belongs to same team to prevent cross-team references
    if (parent.teamId !== teamId) {
      throw new ConvexError("Parent issue belongs to a different team");
    }
    parentShortId = parent.shortId;
  }

  // Find the last sibling to determine next number
  const siblings = await ctx.db
    .query("issues")
    .withIndex("by_team_parent", (q) =>
      q.eq("teamId", teamId).eq("parentIssueId", parentIssueId)
    )
    .collect();

  // Find max orderIndex
  let maxOrderIndex = 0;
  for (const sibling of siblings) {
    if (sibling.orderIndex > maxOrderIndex) {
      maxOrderIndex = sibling.orderIndex;
    }
  }

  // Try successive numbers until we find one that's not taken
  // This handles edge cases where OCC might not catch a race condition
  const MAX_ATTEMPTS = 10;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const nextNumber = maxOrderIndex + 1 + attempt;
    const shortId = parentShortId
      ? `${parentShortId}.${nextNumber}`
      : `${nextNumber}`;

    // Defensive check: verify this shortId doesn't already exist
    const existing = await ctx.db
      .query("issues")
      .withIndex("by_team_shortId", (q) =>
        q.eq("teamId", teamId).eq("shortId", shortId)
      )
      .first();

    if (!existing) {
      return { shortId, orderIndex: nextNumber };
    }
    // If exists, try next number
  }

  throw new ConvexError(
    "Failed to generate unique shortId after maximum attempts"
  );
}

/**
 * Record an event in the audit trail.
 */
async function recordEvent(
  ctx: MutationCtx,
  args: {
    teamId: string;
    issueId: Id<"issues">;
    eventType: Doc<"issueEvents">["eventType"];
    actor: string;
    fieldChanged?: string;
    oldValue?: unknown;
    newValue?: unknown;
    snapshot?: Doc<"issues">;
    // Set to true when oldValue/newValue are explicitly provided (even if undefined)
    hasOldValue?: boolean;
    hasNewValue?: boolean;
  }
) {
  // Use null to represent "was undefined" so undo can restore undefined values
  const encodeValue = (value: unknown, hasValue: boolean | undefined) => {
    if (!hasValue && value === undefined) return undefined;
    // Encode undefined as null, everything else as JSON
    return value === undefined ? "null" : JSON.stringify(value);
  };

  await ctx.db.insert("issueEvents", {
    teamId: args.teamId,
    issueId: args.issueId,
    eventType: args.eventType,
    actor: args.actor,
    fieldChanged: args.fieldChanged,
    oldValue: encodeValue(args.oldValue, args.hasOldValue),
    newValue: encodeValue(args.newValue, args.hasNewValue),
    snapshot: args.snapshot ? JSON.stringify(args.snapshot) : undefined,
    createdAt: Date.now(),
  });
}

// =============================================================================
// Mutations - Single Operations
// =============================================================================

export const createIssue = authMutation({
  args: {
    teamSlugOrId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    issueType: v.optional(issueTypeValidator),
    parentIssueId: v.optional(v.id("issues")),
    assignee: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const { shortId, orderIndex } = await generateShortId(ctx, teamId, args.parentIssueId);

    const now = Date.now();
    const issueId = await ctx.db.insert("issues", {
      shortId,
      teamId,
      title: args.title,
      description: args.description,
      status: "open",
      issueType: args.issueType ?? "task",
      assignee: args.assignee,
      createdBy: userId,
      parentIssueId: args.parentIssueId,
      orderIndex,
      createdAt: now,
      updatedAt: now,
    });

    // Record creation event
    await recordEvent(ctx, {
      teamId,
      issueId,
      eventType: "created",
      actor: userId,
    });

    return { issueId, shortId };
  },
});

export const updateIssue = authMutation({
  args: {
    teamSlugOrId: v.string(),
    issueId: v.id("issues"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    issueType: v.optional(issueTypeValidator),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const issue = await ctx.db.get(args.issueId);
    if (!issue || issue.teamId !== teamId) {
      throw new ConvexError("Issue not found");
    }

    // Build updates and record changes
    const updates: Partial<Doc<"issues">> = { updatedAt: Date.now() };

    if (args.title !== undefined && args.title !== issue.title) {
      await recordEvent(ctx, {
        teamId,
        issueId: args.issueId,
        eventType: "updated",
        actor: userId,
        fieldChanged: "title",
        oldValue: issue.title,
        newValue: args.title,
      });
      updates.title = args.title;
    }

    if (args.description !== undefined) {
      // Treat empty string as "clear description" by converting to undefined
      const newDescription = args.description === "" ? undefined : args.description;
      if (newDescription !== issue.description) {
        await recordEvent(ctx, {
          teamId,
          issueId: args.issueId,
          eventType: "updated",
          actor: userId,
          fieldChanged: "description",
          oldValue: issue.description,
          newValue: newDescription,
          hasOldValue: true,
          hasNewValue: true,
        });
        updates.description = newDescription;
      }
    }

    if (args.issueType !== undefined && args.issueType !== issue.issueType) {
      await recordEvent(ctx, {
        teamId,
        issueId: args.issueId,
        eventType: "updated",
        actor: userId,
        fieldChanged: "issueType",
        oldValue: issue.issueType,
        newValue: args.issueType,
      });
      updates.issueType = args.issueType;
    }

    await ctx.db.patch(args.issueId, updates);
    return { success: true };
  },
});

export const updateIssueStatus = authMutation({
  args: {
    teamSlugOrId: v.string(),
    issueId: v.id("issues"),
    status: issueStatusValidator,
    closeReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const issue = await ctx.db.get(args.issueId);
    if (!issue || issue.teamId !== teamId) {
      throw new ConvexError("Issue not found");
    }

    const oldStatus = issue.status;
    const now = Date.now();

    const updates: Partial<Doc<"issues">> = {
      status: args.status,
      updatedAt: now,
    };

    // Handle closing
    if (args.status === "closed" && oldStatus !== "closed") {
      updates.closedAt = now;
      updates.closeReason = args.closeReason;
      await recordEvent(ctx, {
        teamId,
        issueId: args.issueId,
        eventType: "closed",
        actor: userId,
        oldValue: oldStatus,
        newValue: args.status,
        snapshot: issue,
      });
    }
    // Handle reopening
    else if (oldStatus === "closed" && args.status !== "closed") {
      updates.closedAt = undefined;
      updates.closeReason = undefined;
      await recordEvent(ctx, {
        teamId,
        issueId: args.issueId,
        eventType: "reopened",
        actor: userId,
        oldValue: oldStatus,
        newValue: args.status,
      });
    }
    // Regular status change
    else if (args.status !== oldStatus) {
      await recordEvent(ctx, {
        teamId,
        issueId: args.issueId,
        eventType: "status_changed",
        actor: userId,
        fieldChanged: "status",
        oldValue: oldStatus,
        newValue: args.status,
      });
    }

    await ctx.db.patch(args.issueId, updates);
    return { success: true };
  },
});

export const assignIssue = authMutation({
  args: {
    teamSlugOrId: v.string(),
    issueId: v.id("issues"),
    assignee: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const issue = await ctx.db.get(args.issueId);
    if (!issue || issue.teamId !== teamId) {
      throw new ConvexError("Issue not found");
    }

    const oldAssignee = issue.assignee;
    const eventType = args.assignee ? "assigned" : "unassigned";

    await recordEvent(ctx, {
      teamId,
      issueId: args.issueId,
      eventType,
      actor: userId,
      fieldChanged: "assignee",
      oldValue: oldAssignee,
      newValue: args.assignee,
      hasOldValue: true,
      hasNewValue: true,
    });

    await ctx.db.patch(args.issueId, {
      assignee: args.assignee,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

export const deleteIssue = authMutation({
  args: {
    teamSlugOrId: v.string(),
    issueId: v.id("issues"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const issue = await ctx.db.get(args.issueId);
    if (!issue || issue.teamId !== teamId) {
      throw new ConvexError("Issue not found");
    }

    const now = Date.now();

    // Reparent children to the grandparent (or root if no grandparent)
    // This prevents children from being orphaned when their parent is deleted
    const children = await ctx.db
      .query("issues")
      .withIndex("by_team_parent", (q) =>
        q.eq("teamId", teamId).eq("parentIssueId", args.issueId)
      )
      .collect();

    // Store child IDs for undo operation
    const reparentedChildIds = children.map((c) => c._id);

    for (const child of children) {
      await ctx.db.patch(child._id, {
        parentIssueId: issue.parentIssueId, // Move to grandparent or undefined (root)
        updatedAt: now,
      });
    }

    // Soft delete via tombstone status
    // Store reparented children IDs in oldValue so undo can restore them
    await recordEvent(ctx, {
      teamId,
      issueId: args.issueId,
      eventType: "deleted",
      actor: userId,
      snapshot: issue,
      oldValue: reparentedChildIds.length > 0 ? reparentedChildIds : undefined,
      hasOldValue: reparentedChildIds.length > 0,
    });

    await ctx.db.patch(args.issueId, {
      status: "tombstone",
      deletedAt: now,
      updatedAt: now,
    });

    return { success: true };
  },
});

export const restoreIssue = authMutation({
  args: {
    teamSlugOrId: v.string(),
    issueId: v.id("issues"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const issue = await ctx.db.get(args.issueId);
    if (!issue || issue.teamId !== teamId) {
      throw new ConvexError("Issue not found");
    }

    if (issue.status !== "tombstone") {
      throw new ConvexError("Issue is not deleted");
    }

    await recordEvent(ctx, {
      teamId,
      issueId: args.issueId,
      eventType: "restored",
      actor: userId,
    });

    await ctx.db.patch(args.issueId, {
      status: "open",
      deletedAt: undefined,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// =============================================================================
// Mutations - Bulk Operations
// =============================================================================

export const createIssues = authMutation({
  args: {
    teamSlugOrId: v.string(),
    issues: v.array(
      v.object({
        title: v.string(),
        description: v.optional(v.string()),
        issueType: v.optional(issueTypeValidator),
        parentIssueId: v.optional(v.id("issues")),
        assignee: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const now = Date.now();

    const results: { issueId: Id<"issues">; shortId: string }[] = [];

    for (const issueData of args.issues) {
      const { shortId, orderIndex } = await generateShortId(
        ctx,
        teamId,
        issueData.parentIssueId
      );

      const issueId = await ctx.db.insert("issues", {
        shortId,
        teamId,
        title: issueData.title,
        description: issueData.description,
        status: "open",
        issueType: issueData.issueType ?? "task",
        assignee: issueData.assignee,
        createdBy: userId,
        parentIssueId: issueData.parentIssueId,
        orderIndex,
        createdAt: now,
        updatedAt: now,
      });

      await recordEvent(ctx, {
        teamId,
        issueId,
        eventType: "created",
        actor: userId,
      });

      results.push({ issueId, shortId });
    }

    return results;
  },
});

export const updateIssuesStatus = authMutation({
  args: {
    teamSlugOrId: v.string(),
    issueIds: v.array(v.id("issues")),
    status: issueStatusValidator,
    closeReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const now = Date.now();

    const results: { issueId: Id<"issues">; success: boolean }[] = [];

    for (const issueId of args.issueIds) {
      const issue = await ctx.db.get(issueId);
      if (!issue || issue.teamId !== teamId) {
        results.push({ issueId, success: false });
        continue;
      }

      const oldStatus = issue.status;
      const updates: Partial<Doc<"issues">> = {
        status: args.status,
        updatedAt: now,
      };

      if (args.status === "closed" && oldStatus !== "closed") {
        updates.closedAt = now;
        updates.closeReason = args.closeReason;
        await recordEvent(ctx, {
          teamId,
          issueId,
          eventType: "closed",
          actor: userId,
          oldValue: oldStatus,
          newValue: args.status,
          snapshot: issue,
        });
      } else if (oldStatus === "closed" && args.status !== "closed") {
        updates.closedAt = undefined;
        updates.closeReason = undefined;
        await recordEvent(ctx, {
          teamId,
          issueId,
          eventType: "reopened",
          actor: userId,
          oldValue: oldStatus,
          newValue: args.status,
        });
      } else if (args.status !== oldStatus) {
        await recordEvent(ctx, {
          teamId,
          issueId,
          eventType: "status_changed",
          actor: userId,
          fieldChanged: "status",
          oldValue: oldStatus,
          newValue: args.status,
        });
      }

      await ctx.db.patch(issueId, updates);
      results.push({ issueId, success: true });
    }

    return results;
  },
});

export const deleteIssues = authMutation({
  args: {
    teamSlugOrId: v.string(),
    issueIds: v.array(v.id("issues")),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const now = Date.now();

    // Set of issues being deleted (for checking if children are also being deleted)
    const deletingSet = new Set(args.issueIds.map((id) => id.toString()));

    const results: { issueId: Id<"issues">; success: boolean }[] = [];

    for (const issueId of args.issueIds) {
      const issue = await ctx.db.get(issueId);
      if (!issue || issue.teamId !== teamId) {
        results.push({ issueId, success: false });
        continue;
      }

      // Reparent children that are NOT also being deleted
      const children = await ctx.db
        .query("issues")
        .withIndex("by_team_parent", (q) =>
          q.eq("teamId", teamId).eq("parentIssueId", issueId)
        )
        .collect();

      for (const child of children) {
        // Only reparent if the child is not also being deleted
        if (!deletingSet.has(child._id.toString())) {
          await ctx.db.patch(child._id, {
            parentIssueId: issue.parentIssueId, // Move to grandparent or undefined (root)
            updatedAt: now,
          });
        }
      }

      await recordEvent(ctx, {
        teamId,
        issueId,
        eventType: "deleted",
        actor: userId,
        snapshot: issue,
      });

      await ctx.db.patch(issueId, {
        status: "tombstone",
        deletedAt: now,
        updatedAt: now,
      });

      results.push({ issueId, success: true });
    }

    return results;
  },
});

export const assignIssues = authMutation({
  args: {
    teamSlugOrId: v.string(),
    issueIds: v.array(v.id("issues")),
    assignee: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const now = Date.now();

    const results: { issueId: Id<"issues">; success: boolean }[] = [];

    for (const issueId of args.issueIds) {
      const issue = await ctx.db.get(issueId);
      if (!issue || issue.teamId !== teamId) {
        results.push({ issueId, success: false });
        continue;
      }

      const oldAssignee = issue.assignee;
      const eventType = args.assignee ? "assigned" : "unassigned";

      await recordEvent(ctx, {
        teamId,
        issueId,
        eventType,
        actor: userId,
        fieldChanged: "assignee",
        oldValue: oldAssignee,
        newValue: args.assignee,
        hasOldValue: true,
        hasNewValue: true,
      });

      await ctx.db.patch(issueId, {
        assignee: args.assignee,
        updatedAt: now,
      });

      results.push({ issueId, success: true });
    }

    return results;
  },
});

// =============================================================================
// Mutations - Dependencies
// =============================================================================

export const addDependency = authMutation({
  args: {
    teamSlugOrId: v.string(),
    issueId: v.id("issues"),
    dependsOnId: v.id("issues"),
    type: dependencyTypeValidator,
    metadata: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Verify both issues exist and belong to team
    const issue = await ctx.db.get(args.issueId);
    const dependsOn = await ctx.db.get(args.dependsOnId);

    if (!issue || issue.teamId !== teamId) {
      throw new ConvexError("Issue not found");
    }
    if (!dependsOn || dependsOn.teamId !== teamId) {
      throw new ConvexError("Dependency target not found");
    }

    // Prevent self-dependency
    if (args.issueId === args.dependsOnId) {
      throw new ConvexError("Cannot create self-dependency");
    }

    // Check for existing dependency
    const existing = await ctx.db
      .query("issueDependencies")
      .withIndex("by_issue", (q) => q.eq("issueId", args.issueId))
      .filter((q) => q.eq(q.field("dependsOnId"), args.dependsOnId))
      .first();

    if (existing) {
      throw new ConvexError("Dependency already exists");
    }

    const depId = await ctx.db.insert("issueDependencies", {
      teamId,
      issueId: args.issueId,
      dependsOnId: args.dependsOnId,
      type: args.type,
      createdAt: Date.now(),
      createdBy: userId,
      metadata: args.metadata,
    });

    await recordEvent(ctx, {
      teamId,
      issueId: args.issueId,
      eventType: "dependency_added",
      actor: userId,
      newValue: { dependsOnId: args.dependsOnId, type: args.type },
    });

    return { dependencyId: depId };
  },
});

export const removeDependency = authMutation({
  args: {
    teamSlugOrId: v.string(),
    issueId: v.id("issues"),
    dependsOnId: v.id("issues"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const dependency = await ctx.db
      .query("issueDependencies")
      .withIndex("by_issue", (q) => q.eq("issueId", args.issueId))
      .filter((q) => q.eq(q.field("dependsOnId"), args.dependsOnId))
      .first();

    if (!dependency || dependency.teamId !== teamId) {
      throw new ConvexError("Dependency not found");
    }

    await ctx.db.delete(dependency._id);

    await recordEvent(ctx, {
      teamId,
      issueId: args.issueId,
      eventType: "dependency_removed",
      actor: userId,
      oldValue: { dependsOnId: args.dependsOnId, type: dependency.type },
    });

    return { success: true };
  },
});

// =============================================================================
// Mutations - Undo
// =============================================================================

export const undoLastEvent = authMutation({
  args: {
    teamSlugOrId: v.string(),
    issueId: v.id("issues"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const issue = await ctx.db.get(args.issueId);
    if (!issue || issue.teamId !== teamId) {
      throw new ConvexError("Issue not found");
    }

    // Find the last undoable event
    const events = await ctx.db
      .query("issueEvents")
      .withIndex("by_issue", (q) => q.eq("issueId", args.issueId))
      .order("desc")
      .collect();

    const lastEvent = events.find((e) => e.undoneAt === undefined);

    if (!lastEvent) {
      throw new ConvexError("No events to undo");
    }

    // Apply undo based on event type
    const now = Date.now();

    switch (lastEvent.eventType) {
      case "updated":
      case "status_changed":
        if (lastEvent.fieldChanged && lastEvent.oldValue !== undefined) {
          // "null" JSON string means the previous value was undefined
          const oldValue =
            lastEvent.oldValue === "null"
              ? undefined
              : (JSON.parse(lastEvent.oldValue) as unknown);
          await ctx.db.patch(args.issueId, {
            [lastEvent.fieldChanged]: oldValue,
            updatedAt: now,
          });
        }
        break;

      case "closed":
        // Restore to the previous status (oldValue), not hardcoded "open"
        {
          const previousStatus = lastEvent.oldValue
            ? (JSON.parse(lastEvent.oldValue) as Doc<"issues">["status"])
            : "open";
          await ctx.db.patch(args.issueId, {
            status: previousStatus,
            closedAt: undefined,
            closeReason: undefined,
            updatedAt: now,
          });
        }
        break;

      case "reopened":
        if (lastEvent.oldValue) {
          const oldStatus = JSON.parse(lastEvent.oldValue) as Doc<"issues">["status"];
          await ctx.db.patch(args.issueId, {
            status: oldStatus,
            updatedAt: now,
          });
        }
        break;

      case "deleted":
        // Restore from snapshot if available
        if (lastEvent.snapshot) {
          const snapshot = JSON.parse(lastEvent.snapshot) as Doc<"issues">;
          await ctx.db.patch(args.issueId, {
            status: snapshot.status ?? "open",
            deletedAt: undefined,
            updatedAt: now,
          });
        } else {
          await ctx.db.patch(args.issueId, {
            status: "open",
            deletedAt: undefined,
            updatedAt: now,
          });
        }
        // Restore reparented children back to this issue
        if (lastEvent.oldValue) {
          const reparentedChildIds = JSON.parse(lastEvent.oldValue) as Id<"issues">[];
          for (const childId of reparentedChildIds) {
            const child = await ctx.db.get(childId);
            if (child) {
              await ctx.db.patch(childId, {
                parentIssueId: args.issueId,
                updatedAt: now,
              });
            }
          }
        }
        break;

      case "assigned":
      case "unassigned":
        if (lastEvent.oldValue !== undefined) {
          // "null" JSON string means the previous value was undefined
          const oldAssignee =
            lastEvent.oldValue === "null"
              ? undefined
              : (JSON.parse(lastEvent.oldValue) as string);
          await ctx.db.patch(args.issueId, {
            assignee: oldAssignee,
            updatedAt: now,
          });
        }
        break;

      default:
        throw new ConvexError(`Cannot undo event type: ${lastEvent.eventType}`);
    }

    // Mark event as undone
    await ctx.db.patch(lastEvent._id, {
      undoneAt: now,
      undoneBy: userId,
    });

    return { success: true, undoneEvent: lastEvent.eventType };
  },
});

// =============================================================================
// Queries
// =============================================================================

export const getIssue = authQuery({
  args: {
    teamSlugOrId: v.string(),
    issueId: v.optional(v.id("issues")),
    shortId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    let issue: Doc<"issues"> | null = null;

    if (args.issueId) {
      issue = await ctx.db.get(args.issueId);
    } else if (args.shortId) {
      issue = await ctx.db
        .query("issues")
        .withIndex("by_team_shortId", (q) =>
          q.eq("teamId", teamId).eq("shortId", args.shortId!)
        )
        .first();
    }

    if (!issue || issue.teamId !== teamId) {
      return null;
    }

    // Don't return tombstoned issues by default
    if (issue.status === "tombstone") {
      return null;
    }

    return issue;
  },
});

export const listIssues = authQuery({
  args: {
    teamSlugOrId: v.string(),
    status: v.optional(issueStatusValidator),
    issueType: v.optional(issueTypeValidator),
    assignee: v.optional(v.string()),
    parentIssueId: v.optional(v.id("issues")),
    includeDeleted: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const query = ctx.db
      .query("issues")
      .withIndex("by_team_created", (q) => q.eq("teamId", teamId));

    const issues = await query.collect();

    // Filter in memory (Convex doesn't support complex filters on indexes)
    let filtered = issues.filter((issue) => {
      if (!args.includeDeleted && issue.status === "tombstone") return false;
      if (args.status && issue.status !== args.status) return false;
      if (args.issueType && issue.issueType !== args.issueType) return false;
      if (args.assignee !== undefined && issue.assignee !== args.assignee) return false;
      if (args.parentIssueId !== undefined && issue.parentIssueId !== args.parentIssueId)
        return false;
      return true;
    });

    // Sort by createdAt desc
    filtered.sort((a, b) => b.createdAt - a.createdAt);

    if (args.limit) {
      filtered = filtered.slice(0, args.limit);
    }

    return filtered;
  },
});

export const getIssueTree = authQuery({
  args: {
    teamSlugOrId: v.string(),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const issues = await ctx.db
      .query("issues")
      .withIndex("by_team_created", (q) => q.eq("teamId", teamId))
      .collect();

    // Filter out tombstones unless requested
    const filtered = args.includeDeleted
      ? issues
      : issues.filter((i) => i.status !== "tombstone");

    // Build tree structure
    type TreeNode = Doc<"issues"> & { children: TreeNode[] };
    const byParent = new Map<string | undefined, Doc<"issues">[]>();

    for (const issue of filtered) {
      const parentKey = issue.parentIssueId ?? undefined;
      if (!byParent.has(parentKey)) byParent.set(parentKey, []);
      byParent.get(parentKey)!.push(issue);
    }

    // Sort siblings by orderIndex
    for (const siblings of byParent.values()) {
      siblings.sort((a, b) => a.orderIndex - b.orderIndex);
    }

    function buildNode(issue: Doc<"issues">): TreeNode {
      const children = byParent.get(issue._id) ?? [];
      return {
        ...issue,
        children: children.map((c) => buildNode(c)),
      };
    }

    const roots = byParent.get(undefined) ?? [];
    return roots.map((r) => buildNode(r));
  },
});

export const getReadyIssues = authQuery({
  args: {
    teamSlugOrId: v.string(),
    assignee: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Get all open issues
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_team_status", (q) => q.eq("teamId", teamId).eq("status", "open"))
      .collect();

    // Get all blocking dependencies
    const blockingDeps = await ctx.db
      .query("issueDependencies")
      .withIndex("by_team_type", (q) => q.eq("teamId", teamId).eq("type", "blocks"))
      .collect();

    // Build set of blocked issue IDs
    const blockedIds = new Set<string>();
    for (const dep of blockingDeps) {
      const blocker = await ctx.db.get(dep.dependsOnId);
      if (blocker && blocker.status !== "closed" && blocker.status !== "tombstone") {
        blockedIds.add(dep.issueId);
      }
    }

    // Filter to ready issues
    let ready = issues.filter((i) => !blockedIds.has(i._id));

    // Optional assignee filter
    if (args.assignee !== undefined) {
      ready = ready.filter((i) => i.assignee === args.assignee);
    }

    // Sort by createdAt
    ready.sort((a, b) => a.createdAt - b.createdAt);

    if (args.limit) {
      ready = ready.slice(0, args.limit);
    }

    return ready;
  },
});

export const getIssueEvents = authQuery({
  args: {
    teamSlugOrId: v.string(),
    issueId: v.id("issues"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const issue = await ctx.db.get(args.issueId);
    if (!issue || issue.teamId !== teamId) {
      throw new ConvexError("Issue not found");
    }

    let events = await ctx.db
      .query("issueEvents")
      .withIndex("by_issue", (q) => q.eq("issueId", args.issueId))
      .order("desc")
      .collect();

    if (args.limit) {
      events = events.slice(0, args.limit);
    }

    return events;
  },
});

export const getIssueDependencies = authQuery({
  args: {
    teamSlugOrId: v.string(),
    issueId: v.id("issues"),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const issue = await ctx.db.get(args.issueId);
    if (!issue || issue.teamId !== teamId) {
      throw new ConvexError("Issue not found");
    }

    // Dependencies this issue has (what it depends on)
    const dependsOn = await ctx.db
      .query("issueDependencies")
      .withIndex("by_issue", (q) => q.eq("issueId", args.issueId))
      .collect();

    // Dependents (issues that depend on this one)
    const dependents = await ctx.db
      .query("issueDependencies")
      .withIndex("by_dependsOn", (q) => q.eq("dependsOnId", args.issueId))
      .collect();

    return { dependsOn, dependents };
  },
});
