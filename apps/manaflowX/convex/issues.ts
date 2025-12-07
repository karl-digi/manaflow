import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// =============================================================================
// ISSUES - Beads-style persistent issue tracker
// =============================================================================

// Generate a short hash ID (like x-a1b2)
function generateShortId(): string {
  const chars = "0123456789abcdef";
  let hash = "";
  for (let i = 0; i < 4; i++) {
    hash += chars[Math.floor(Math.random() * chars.length)];
  }
  return `x-${hash}`;
}

// List issues
export const listIssues = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(
      v.union(v.literal("open"), v.literal("in_progress"), v.literal("closed"))
    ),
    type: v.optional(
      v.union(
        v.literal("bug"),
        v.literal("feature"),
        v.literal("task"),
        v.literal("epic"),
        v.literal("chore")
      )
    ),
    assignee: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    let issuesQuery;

    if (args.status) {
      issuesQuery = ctx.db
        .query("issues")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc");
    } else if (args.assignee) {
      issuesQuery = ctx.db
        .query("issues")
        .withIndex("by_assignee", (q) => q.eq("assignee", args.assignee!))
        .order("desc");
    } else {
      issuesQuery = ctx.db.query("issues").order("desc");
    }

    const issues = await issuesQuery.take(limit);

    // Filter by type if specified (secondary filter)
    const filtered = args.type
      ? issues.filter((i) => i.type === args.type)
      : issues;

    return filtered;
  },
});

// Get ready work (issues with no open blockers)
export const listReadyIssues = query({
  args: {
    limit: v.optional(v.number()),
    assignee: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    // Get all open issues
    const openIssues = await ctx.db
      .query("issues")
      .withIndex("by_status_priority", (q) => q.eq("status", "open"))
      .order("asc") // Lower priority number = higher priority
      .collect();

    // Get all blocking dependencies
    const allDeps = await ctx.db.query("dependencies").collect();
    const blockingDeps = allDeps.filter((d) => d.type === "blocks");

    // Find issues that are blocked
    const blockedIssueIds = new Set<string>();
    for (const dep of blockingDeps) {
      // Check if the blocker is still open
      const blocker = await ctx.db.get(dep.toIssue);
      if (blocker && blocker.status !== "closed") {
        blockedIssueIds.add(dep.fromIssue);
      }
    }

    // Filter to ready issues (not blocked)
    let readyIssues = openIssues.filter(
      (issue) => !blockedIssueIds.has(issue._id)
    );

    // Filter by assignee if specified
    if (args.assignee) {
      readyIssues = readyIssues.filter((i) => i.assignee === args.assignee);
    }

    return readyIssues.slice(0, limit);
  },
});

// Create an issue
export const createIssue = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    type: v.optional(
      v.union(
        v.literal("bug"),
        v.literal("feature"),
        v.literal("task"),
        v.literal("epic"),
        v.literal("chore")
      )
    ),
    priority: v.optional(v.number()),
    assignee: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
    parentIssue: v.optional(v.id("issues")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const shortId = generateShortId();

    const issueId = await ctx.db.insert("issues", {
      shortId,
      title: args.title,
      description: args.description,
      status: "open",
      priority: args.priority ?? 2, // Default medium priority
      type: args.type ?? "task",
      assignee: args.assignee,
      labels: args.labels ?? [],
      parentIssue: args.parentIssue,
      isCompacted: false,
      createdAt: now,
      updatedAt: now,
    });

    // Create audit event
    await ctx.db.insert("issueEvents", {
      issue: issueId,
      type: "created",
      data: { title: args.title, type: args.type ?? "task" },
      createdAt: now,
    });

    return { issueId, shortId };
  },
});

// Update an issue
export const updateIssue = mutation({
  args: {
    issueId: v.id("issues"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("open"), v.literal("in_progress"), v.literal("closed"))
    ),
    priority: v.optional(v.number()),
    assignee: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");

    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    if (args.title !== undefined && args.title !== issue.title) {
      updates.title = args.title;
      changes.title = { from: issue.title, to: args.title };
    }
    if (
      args.description !== undefined &&
      args.description !== issue.description
    ) {
      updates.description = args.description;
      changes.description = { from: issue.description, to: args.description };
    }
    if (args.status !== undefined && args.status !== issue.status) {
      updates.status = args.status;
      changes.status = { from: issue.status, to: args.status };
      if (args.status === "closed") {
        updates.closedAt = now;
      }
    }
    if (args.priority !== undefined && args.priority !== issue.priority) {
      updates.priority = args.priority;
      changes.priority = { from: issue.priority, to: args.priority };
    }
    if (args.assignee !== undefined && args.assignee !== issue.assignee) {
      updates.assignee = args.assignee;
      changes.assignee = { from: issue.assignee, to: args.assignee };
    }
    if (args.labels !== undefined) {
      updates.labels = args.labels;
      changes.labels = { from: issue.labels, to: args.labels };
    }

    await ctx.db.patch(args.issueId, updates);

    // Create audit event
    if (Object.keys(changes).length > 0) {
      await ctx.db.insert("issueEvents", {
        issue: args.issueId,
        type: "updated",
        data: changes,
        createdAt: now,
      });
    }

    return { success: true };
  },
});

// Close an issue
export const closeIssue = mutation({
  args: {
    issueId: v.id("issues"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");

    const now = Date.now();

    await ctx.db.patch(args.issueId, {
      status: "closed",
      closedAt: now,
      closedReason: args.reason,
      updatedAt: now,
    });

    await ctx.db.insert("issueEvents", {
      issue: args.issueId,
      type: "closed",
      data: { reason: args.reason },
      createdAt: now,
    });

    return { success: true };
  },
});

// Reopen an issue
export const reopenIssue = mutation({
  args: {
    issueId: v.id("issues"),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");

    const now = Date.now();

    await ctx.db.patch(args.issueId, {
      status: "open",
      closedAt: undefined,
      closedReason: undefined,
      updatedAt: now,
    });

    await ctx.db.insert("issueEvents", {
      issue: args.issueId,
      type: "reopened",
      data: {},
      createdAt: now,
    });

    return { success: true };
  },
});

// Get a single issue with its events
export const getIssue = query({
  args: {
    issueId: v.id("issues"),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) return null;

    const events = await ctx.db
      .query("issueEvents")
      .withIndex("by_issue", (q) => q.eq("issue", args.issueId))
      .order("desc")
      .take(50);

    return { issue, events };
  },
});

// Get issue by short ID
export const getIssueByShortId = query({
  args: {
    shortId: v.string(),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db
      .query("issues")
      .withIndex("by_shortId", (q) => q.eq("shortId", args.shortId))
      .first();

    return issue;
  },
});

// =============================================================================
// DEPENDENCIES
// =============================================================================

// Add a dependency
export const addIssueDependency = mutation({
  args: {
    fromIssue: v.id("issues"),
    toIssue: v.id("issues"),
    type: v.optional(
      v.union(
        v.literal("blocks"),
        v.literal("related"),
        v.literal("parent_child"),
        v.literal("discovered_from")
      )
    ),
  },
  handler: async (ctx, args) => {
    // Check both issues exist
    const from = await ctx.db.get(args.fromIssue);
    const to = await ctx.db.get(args.toIssue);
    if (!from || !to) throw new Error("Issue not found");

    // Check for existing dependency
    const existing = await ctx.db
      .query("dependencies")
      .withIndex("by_from", (q) => q.eq("fromIssue", args.fromIssue))
      .filter((q) => q.eq(q.field("toIssue"), args.toIssue))
      .first();

    if (existing) throw new Error("Dependency already exists");

    const depId = await ctx.db.insert("dependencies", {
      fromIssue: args.fromIssue,
      toIssue: args.toIssue,
      type: args.type ?? "blocks",
      createdAt: Date.now(),
    });

    return depId;
  },
});

// Remove a dependency
export const removeIssueDependency = mutation({
  args: {
    fromIssue: v.id("issues"),
    toIssue: v.id("issues"),
  },
  handler: async (ctx, args) => {
    const dep = await ctx.db
      .query("dependencies")
      .withIndex("by_from", (q) => q.eq("fromIssue", args.fromIssue))
      .filter((q) => q.eq(q.field("toIssue"), args.toIssue))
      .first();

    if (dep) {
      await ctx.db.delete(dep._id);
    }

    return { success: true };
  },
});

// Get dependencies for an issue
export const getIssueDependencies = query({
  args: {
    issueId: v.id("issues"),
  },
  handler: async (ctx, args) => {
    // Issues this one depends on (blockers)
    const dependsOn = await ctx.db
      .query("dependencies")
      .withIndex("by_from", (q) => q.eq("fromIssue", args.issueId))
      .collect();

    // Issues that depend on this one (blocked by this)
    const blockedBy = await ctx.db
      .query("dependencies")
      .withIndex("by_to", (q) => q.eq("toIssue", args.issueId))
      .collect();

    // Fetch the actual issues
    const dependsOnIssues = await Promise.all(
      dependsOn.map(async (d) => ({
        dependency: d,
        issue: await ctx.db.get(d.toIssue),
      }))
    );

    const blockedByIssues = await Promise.all(
      blockedBy.map(async (d) => ({
        dependency: d,
        issue: await ctx.db.get(d.fromIssue),
      }))
    );

    return {
      dependsOn: dependsOnIssues,
      blockedBy: blockedByIssues,
    };
  },
});
