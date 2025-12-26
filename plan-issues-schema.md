# Plan: Issues/Todo Tracking System for cmux

## Overview

This document plans how to port a beads-like issue tracking system into cmux's Convex schema. The goal is to support:
- Dependencies between issues
- Version control (undo/redo) for issue changes
- Multi-agent operation with conflict handling
- Real-time updates
- Subtasks with hierarchical structure
- Short, human-friendly IDs

## Key Differences from Beads

| Aspect | Beads | cmux (Convex) |
|--------|-------|---------------|
| Storage | SQLite + JSONL + Git | Convex (cloud DB) |
| Sync | File-based, git push/pull | Real-time WebSocket |
| IDs | Birthday hash (bd-a3f2) | Convex _id + short display ID |
| Conflicts | JSONL merge via git | Optimistic concurrency control |
| Offline | Full support | Limited (Convex is online-first) |

## Proposed Schema

### 1. Issues Table

```typescript
issues: defineTable({
  // Identity
  shortId: v.string(), // Hierarchical ID: "1", "1.1", "1.1.1", "2", etc.
  teamId: v.string(),

  // Core fields
  title: v.string(),
  description: v.optional(v.string()),
  status: v.union(
    v.literal("open"),
    v.literal("in_progress"),
    v.literal("blocked"),
    v.literal("closed"),
    v.literal("tombstone") // soft-delete
  ),
  issueType: v.union(
    v.literal("bug"),
    v.literal("feature"),
    v.literal("task"),
    v.literal("epic"),
    v.literal("chore")
  ),

  // Assignment
  assignee: v.optional(v.string()), // userId
  createdBy: v.string(), // userId or "agent:<agentId>"

  // Tree structure
  parentIssueId: v.optional(v.id("issues")), // null = root level
  orderIndex: v.number(), // Order within siblings (0, 1, 2, ...)

  // Timestamps
  createdAt: v.number(),
  updatedAt: v.number(),
  closedAt: v.optional(v.number()),
  deletedAt: v.optional(v.number()),

  // Close metadata
  closeReason: v.optional(v.string()),
})
  .index("by_team_shortId", ["teamId", "shortId"])
  .index("by_team_status", ["teamId", "status", "updatedAt"])
  .index("by_team_parent", ["teamId", "parentIssueId", "orderIndex"]) // For tree queries
  .index("by_assignee", ["teamId", "assignee", "status"])
  .index("by_team_roots", ["teamId", "parentIssueId"]) // Find root issues (parentIssueId = undefined)
```

### 2. Issue Dependencies Table

```typescript
issueDependencies: defineTable({
  teamId: v.string(),
  issueId: v.id("issues"), // The dependent issue
  dependsOnId: v.id("issues"), // The blocking/parent issue
  type: v.union(
    v.literal("blocks"), // dependsOn must close before issue can start
    v.literal("parent-child"), // Hierarchical relationship
    v.literal("related"), // Soft link for reference
    v.literal("discovered-from"), // Found during work on another issue
    v.literal("duplicates"), // Issue is duplicate of dependsOn
    v.literal("supersedes") // Issue supersedes dependsOn
  ),
  createdAt: v.number(),
  createdBy: v.string(), // userId or "agent:<agentId>"
  metadata: v.optional(v.string()), // JSON blob for type-specific data
})
  .index("by_issue", ["issueId"])
  .index("by_dependsOn", ["dependsOnId"])
  .index("by_team_type", ["teamId", "type"])
```

### 3. Issue Events Table (Audit Trail + Undo Support)

This is the **key table for version control**. Every mutation creates an event that can be replayed or reversed.

```typescript
issueEvents: defineTable({
  teamId: v.string(),
  issueId: v.id("issues"),

  // Event metadata
  eventType: v.union(
    v.literal("created"),
    v.literal("updated"),
    v.literal("status_changed"),
    v.literal("closed"),
    v.literal("reopened"),
    v.literal("deleted"),
    v.literal("restored"), // Un-delete
    v.literal("dependency_added"),
    v.literal("dependency_removed"),
    v.literal("assigned"),
    v.literal("unassigned")
  ),

  // Who made the change
  actor: v.string(), // userId or "agent:<agentId>" or "system"

  // Change details for undo/redo
  fieldChanged: v.optional(v.string()), // e.g., "title", "status", "priority"
  oldValue: v.optional(v.string()), // JSON-encoded previous value
  newValue: v.optional(v.string()), // JSON-encoded new value

  // Full snapshot for complex undos
  snapshot: v.optional(v.string()), // JSON-encoded full issue state before change

  // Undo metadata
  undoneAt: v.optional(v.number()), // If this event was undone
  undoneBy: v.optional(v.string()),

  createdAt: v.number(),
})
  .index("by_issue", ["issueId", "createdAt"])
  .index("by_team_created", ["teamId", "createdAt"])
  .index("by_actor", ["actor", "createdAt"])
```

### 4. ID Generation (No Extra Table)

Sequential IDs generated via max+1 query - Convex serializes mutations to prevent duplicates:

```typescript
// In createIssue mutation:
const lastSibling = await ctx.db
  .query("issues")
  .withIndex("by_team_parent", q =>
    q.eq("teamId", teamId).eq("parentIssueId", parentId))
  .order("desc")
  .first();

const nextNumber = (lastSibling?.orderIndex ?? 0) + 1;
const shortId = parentId
  ? `${parentIssue.shortId}.${nextNumber}`
  : `${nextNumber}`;
```

Convex's OCC ensures no race conditions - if two mutations conflict, one retries with fresh data.


## ID System Design

**Sequential hierarchical IDs**: `1`, `1.1`, `1.1.1`, `2`, etc.

### How shortId Generation Works

```typescript
// Creating a root issue:
// 1. Get next root number from issueSequences (e.g., 3)
// 2. shortId = "3"

// Creating a child of issue "1":
// 1. Count existing children of "1" → say 2 exist (1.1, 1.2)
// 2. shortId = "1.3"

// Creating a child of issue "1.2":
// 1. Count existing children of "1.2" → say 0 exist
// 2. shortId = "1.2.1"
```

### Why Sequential (not birthday hash)
1. Convex handles concurrency via transactions
2. Team-scoped (not globally distributed like beads with git)
3. Human-friendly: "issue 3" vs "issue a3f2"
4. Tree structure visible in ID: "1.2.1" clearly shows nesting

## Tree View Rendering

### Query Strategy

```typescript
// Option 1: Fetch all issues, build tree client-side
export const getAllIssues = query({
  args: { teamId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("issues")
      .withIndex("by_team_status", (q) => q.eq("teamId", args.teamId))
      .collect();
  },
});

// Client-side tree building:
function buildTree(issues: Issue[]): TreeNode[] {
  const byParent = new Map<string | null, Issue[]>();

  for (const issue of issues) {
    const parentKey = issue.parentIssueId ?? null;
    if (!byParent.has(parentKey)) byParent.set(parentKey, []);
    byParent.get(parentKey)!.push(issue);
  }

  // Sort siblings by orderIndex
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.orderIndex - b.orderIndex);
  }

  function buildNode(issue: Issue, depth: number): TreeNode {
    const children = byParent.get(issue._id) ?? [];
    return {
      ...issue,
      depth,
      children: children.map(c => buildNode(c, depth + 1)),
    };
  }

  const roots = byParent.get(null) ?? [];
  return roots.map(r => buildNode(r, 0));
}
```

### Rendered Output

```
1: Setup project infrastructure
   1.1: Configure database
      1.1.1: Define schema
      1.1.2: Add migrations
   1.2: Setup authentication
2: Implement features
   2.1: User dashboard
```

### Reordering

To move issue "1.2" above "1.1":
1. Update orderIndex: `1.1` → orderIndex=1, `1.2` → orderIndex=0
2. Optionally regenerate shortIds if you want them to match visual order
   (or keep shortIds stable and just use orderIndex for display)

## Version Control / Undo Design

### How It Works

1. **Every mutation records an event** in `issueEvents`
2. **Event contains undo data**:
   - `fieldChanged`: Which field was modified
   - `oldValue`: Previous value (JSON)
   - `newValue`: New value (JSON)
   - `snapshot`: Full state before change (for complex undos)

3. **Undo operation**:
   ```typescript
   // To undo an event:
   // 1. Find the event
   // 2. Apply oldValue back to the issue
   // 3. Mark event as undone (undoneAt, undoneBy)
   // 4. Create a new "restored" event for the undo action
   ```

4. **Redo**: Just undo the undo event

### Example Flow

```
User creates issue #42
  → Issue created with version=1
  → Event: { type: "created", snapshot: {...fullIssue} }

Agent updates title to "Fix bug in auth"
  → Issue updated with version=2
  → Event: { type: "updated", fieldChanged: "title", oldValue: "New issue", newValue: "Fix bug in auth" }

User clicks "Undo"
  → Read last event for issue #42
  → Apply oldValue back: title = "New issue"
  → Issue updated with version=3
  → Event: { type: "updated", fieldChanged: "title", oldValue: "Fix bug in auth", newValue: "New issue" }
  → Mark original event: undoneAt = now(), undoneBy = userId
```

## Multi-Agent Concurrency

### How Convex Handles It

Convex mutations are **atomic and serializable** - no version numbers needed:

```typescript
// Two agents call this simultaneously:
export const updateIssueStatus = mutation({
  args: { issueId: v.id("issues"), status: v.string() },
  handler: async (ctx, args) => {
    // Convex ensures this runs atomically
    // If two agents call at once, they execute sequentially
    await ctx.db.patch(args.issueId, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});
```

### Real-time Subscriptions

Agents can subscribe to issue changes and react in real-time:

```typescript
// Query that agents subscribe to
export const watchIssue = query({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.issueId);
  },
});
```

When another agent modifies the issue, all subscribers get instant updates via WebSocket.

## Dependency Resolution

### "Ready" Query
Find issues that are ready to work on (not blocked):

```typescript
export const getReadyIssues = query({
  args: { teamId: v.string() },
  handler: async (ctx, args) => {
    // Get all non-closed issues
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_team_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "open")
      )
      .collect();

    // Get all blocking dependencies
    const blockingDeps = await ctx.db
      .query("issueDependencies")
      .withIndex("by_team_type", (q) =>
        q.eq("teamId", args.teamId).eq("type", "blocks")
      )
      .collect();

    // Build set of blocked issue IDs
    const blockedIds = new Set<string>();
    for (const dep of blockingDeps) {
      const blocker = await ctx.db.get(dep.dependsOnId);
      if (blocker && blocker.status !== "closed") {
        blockedIds.add(dep.issueId);
      }
    }

    // Filter to ready issues
    return issues.filter((i) => !blockedIds.has(i._id));
  },
});
```

## Migration Strategy

1. **Add 3 new tables** to schema.ts (issues, issueDependencies, issueEvents)
2. **Build mutations** for CRUD operations (create, update, close, delete, addDependency, etc.)
3. **Build queries** (listIssues, getIssueTree, getReadyIssues, etc.)
4. **Add undo mutation** (reads last event, applies oldValue)

## Design Decisions (Confirmed)

1. **Separate `issues` table** - Not reusing `tasks` (which is for coding tasks with runs)

2. **Sequential IDs** - Use `1`, `2`, `3` with subtasks as `1.1`, `1.2`

3. **Team-wide scope** - Issues belong to teams, not individual tasks

4. **Full audit trail** - Keep all events forever for complete undo history

5. **Agent attribution** - Use format `agent:<agentName>` for clarity (e.g., `agent:claude-sonnet-4`)

## Summary

| Feature | Implementation |
|---------|---------------|
| Short IDs | Hierarchical sequential (`1`, `1.1`, `1.1.1`) |
| Tree View | `parentIssueId` + `orderIndex` for nesting & ordering |
| Team Isolation | All tables keyed by `teamId`, indexes start with `teamId` |
| Dependencies | Separate table with typed relationships (blocks, related, etc.) |
| Undo/Redo | Events table with old/new values + snapshots |
| Concurrency | Convex atomic mutations (no version numbers needed) |
| Real-time | Convex subscriptions (built-in WebSocket) |
| Audit Trail | Full event history, kept forever |

### Tables

1. **issues** - Core issue data + tree structure
2. **issueDependencies** - Relationships (blocks, related, etc.)
3. **issueEvents** - Audit trail for undo/redo
