import { v } from "convex/values";
import { z } from "zod";
import { jsonResponse } from "../_shared/http-utils";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, internalMutation } from "./_generated/server";
import { getWorkerAuth } from "./users/utils/getWorkerAuth";
import { typedZid } from "@cmux/shared/utils/typed-zid";

// Date format validation: YYYY-MM-DD
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const MemoryFileSchema = z.object({
  memoryType: z.enum(["knowledge", "daily", "tasks", "mailbox", "events", "plan"]),
  content: z.string(),
  fileName: z.string().optional(),
  date: z
    .string()
    .regex(dateRegex, "Date must be in YYYY-MM-DD format")
    .optional(),
});

const SyncMemoryRequestSchema = z.object({
  taskRunId: typedZid("taskRuns").optional(),
  projectId: z.string().optional(), // Optional project linkage for plan sync
  files: z.array(MemoryFileSchema).max(50, "Maximum 50 files per request"),
});

// Maximum content size before truncation (500KB leaves headroom under Convex 1MB limit)
const MAX_CONTENT_SIZE = 500_000;

const memoryTypeValidator = v.union(
  v.literal("knowledge"),
  v.literal("daily"),
  v.literal("tasks"),
  v.literal("mailbox"),
  v.literal("events")
);

// Schema for parsing PLAN.json content
const PlanTaskSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  agentName: z.string(),
  status: z.string(),
  dependsOn: z.array(z.string()).optional(),
  priority: z.number().optional(),
});

const PlanContentSchema = z.object({
  orchestrationId: z.string().optional(),
  headAgent: z.string().optional(),
  description: z.string().optional(),
  tasks: z.array(PlanTaskSchema).optional(),
});

/**
 * Internal mutation to sync memory files from a sandbox to Convex.
 * Called by the syncMemory HTTP action after auth verification.
 *
 * Implements upsert behavior:
 * - For knowledge/tasks/mailbox: one snapshot per taskRunId + memoryType
 * - For daily: one snapshot per taskRunId + memoryType + date
 *
 * Content over 500KB is truncated with truncated: true flag.
 * Empty content is skipped.
 */
export const syncMemoryFiles = internalMutation({
  args: {
    taskRunId: v.id("taskRuns"),
    teamId: v.string(),
    userId: v.string(),
    agentName: v.optional(v.string()),
    files: v.array(
      v.object({
        memoryType: memoryTypeValidator,
        content: v.string(),
        fileName: v.optional(v.string()),
        date: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ insertedCount: number }> => {
    const now = Date.now();
    let insertedCount = 0;

    for (const file of args.files) {
      // Skip empty content
      if (!file.content || file.content.trim().length === 0) {
        continue;
      }

      // Truncate content if too large
      let content = file.content;
      let truncated = false;
      if (content.length > MAX_CONTENT_SIZE) {
        content = content.slice(0, MAX_CONTENT_SIZE);
        truncated = true;
      }

      // Build query to find existing snapshot
      // For daily logs, we also match by date
      let existingId: Id<"agentMemorySnapshots"> | null = null;

      if (file.memoryType === "daily" && file.date) {
        // Query for daily logs by taskRunId + memoryType, then filter by date
        const existing = await ctx.db
          .query("agentMemorySnapshots")
          .withIndex("by_task_run", (q) =>
            q.eq("taskRunId", args.taskRunId).eq("memoryType", file.memoryType)
          )
          .filter((q) => q.eq(q.field("date"), file.date))
          .first();
        existingId = existing?._id ?? null;
      } else {
        // Query for knowledge/tasks/mailbox by taskRunId + memoryType
        const existing = await ctx.db
          .query("agentMemorySnapshots")
          .withIndex("by_task_run", (q) =>
            q.eq("taskRunId", args.taskRunId).eq("memoryType", file.memoryType)
          )
          .first();
        existingId = existing?._id ?? null;
      }

      if (existingId) {
        // Update existing snapshot
        await ctx.db.patch(existingId, {
          content,
          fileName: file.fileName,
          truncated: truncated || undefined,
          createdAt: now,
          agentName: args.agentName,
        });
      } else {
        // Insert new snapshot
        await ctx.db.insert("agentMemorySnapshots", {
          taskRunId: args.taskRunId,
          teamId: args.teamId,
          userId: args.userId,
          agentName: args.agentName,
          memoryType: file.memoryType,
          content,
          fileName: file.fileName,
          date: file.date,
          truncated: truncated || undefined,
          createdAt: now,
        });
      }

      insertedCount++;
    }

    return { insertedCount };
  },
});

/**
 * HTTP endpoint called by sandbox stop hooks to sync agent memory files to Convex.
 * POST /api/memory/sync
 *
 * Auth: x-cmux-token header with valid task run JWT
 *
 * Body: {
 *   files: [{
 *     memoryType: "knowledge" | "daily" | "tasks" | "mailbox",
 *     content: string,
 *     fileName?: string,
 *     date?: string (YYYY-MM-DD for daily logs)
 *   }]
 * }
 *
 * Returns: { ok: true, insertedCount: number } on success
 */
export const syncMemory = httpAction(async (ctx, req) => {
  const auth = await getWorkerAuth(req, {
    loggerPrefix: "[convex.agentMemory]",
  });
  if (!auth) {
    console.error("[convex.agentMemory] Auth failed for memory sync");
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse(
      { code: 415, message: "Content-Type must be application/json" },
      415
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch (error) {
    console.error("[convex.agentMemory] Failed to parse JSON body:", error);
    return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
  }

  const validation = SyncMemoryRequestSchema.safeParse(json);
  if (!validation.success) {
    console.warn(
      "[convex.agentMemory] Invalid sync payload",
      validation.error.format()
    );
    return jsonResponse(
      {
        code: 400,
        message: "Invalid input",
        errors: validation.error.issues.map((i) => i.message),
      },
      400
    );
  }

  // Security: Always use taskRunId from JWT - ignore body taskRunId to prevent
  // workers from attaching memory to other task runs they don't own
  const taskRunId = auth.payload.taskRunId as Id<"taskRuns">;

  // Verify the task run exists
  const taskRun = await ctx.runQuery(internal.taskRuns.getById, {
    id: taskRunId,
  });

  if (!taskRun) {
    console.warn("[convex.agentMemory] Task run not found", { taskRunId });
    return jsonResponse({ code: 404, message: "Task run not found" }, 404);
  }

  // Verify the worker is authorized for this task run
  if (
    taskRun.teamId !== auth.payload.teamId ||
    taskRun.userId !== auth.payload.userId
  ) {
    console.warn(
      "[convex.agentMemory] Worker attempted to sync memory for unauthorized task run",
      {
        requestedTaskRunId: taskRunId,
        tokenTaskRunId: auth.payload.taskRunId,
        workerTeamId: auth.payload.teamId,
        taskRunTeamId: taskRun.teamId,
      }
    );
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  // Skip if no files to sync
  if (validation.data.files.length === 0) {
    return jsonResponse({ ok: true, insertedCount: 0 });
  }

  // Check if there's a plan file to sync to project
  const planFile = validation.data.files.find((f) => f.memoryType === "plan");
  if (planFile && planFile.content) {
    try {
      const planContent = JSON.parse(planFile.content);
      const planValidation = PlanContentSchema.safeParse(planContent);

      if (planValidation.success && planValidation.data.tasks && planValidation.data.tasks.length > 0) {
        // Try to find linked project by orchestrationId
        const orchestrationId = planValidation.data.orchestrationId ||
          (taskRun.orchestrationId ? taskRun.orchestrationId : undefined);

        if (orchestrationId) {
          // Look up project by orchestrationId
          const project = await ctx.runQuery(
            internal.projectQueries.getProjectByOrchestrationId,
            {
              orchestrationId,
              teamId: taskRun.teamId,
            }
          );

          if (project) {
            // Sync plan tasks to project
            await ctx.runMutation(internal.projectQueries.updatePlanInternal, {
              projectId: project._id,
              tasks: planValidation.data.tasks,
            });

            console.log("[convex.agentMemory] Synced plan to project", {
              projectId: project._id,
              orchestrationId,
              taskCount: planValidation.data.tasks.length,
            });
          }
        }

        // Also check if projectId was explicitly provided
        const explicitProjectId = validation.data.projectId;
        if (explicitProjectId && !orchestrationId) {
          try {
            await ctx.runMutation(internal.projectQueries.updatePlanInternal, {
              projectId: explicitProjectId as Id<"projects">,
              tasks: planValidation.data.tasks,
            });

            console.log("[convex.agentMemory] Synced plan to explicit project", {
              projectId: explicitProjectId,
              taskCount: planValidation.data.tasks.length,
            });
          } catch (error) {
            console.warn("[convex.agentMemory] Failed to sync to explicit project:", error);
            // Don't fail the whole sync, just log the warning
          }
        }
      }
    } catch (error) {
      console.warn("[convex.agentMemory] Failed to parse plan content:", error);
      // Don't fail the whole sync, just log the warning
    }
  }

  // Sync memory files (filter out plan type as it's stored separately)
  const nonPlanFiles = validation.data.files
    .filter((f) => f.memoryType !== "plan")
    .map((f) => ({
      memoryType: f.memoryType as "knowledge" | "daily" | "tasks" | "mailbox" | "events",
      content: f.content,
      fileName: f.fileName,
      date: f.date,
    }));

  const result = await ctx.runMutation(
    internal.agentMemory_http.syncMemoryFiles,
    {
      taskRunId,
      teamId: taskRun.teamId,
      userId: taskRun.userId,
      agentName: taskRun.agentName,
      files: nonPlanFiles,
    }
  );

  console.log("[convex.agentMemory] Synced memory files", {
    taskRunId,
    insertedCount: result.insertedCount,
    fileTypes: validation.data.files.map((f) => f.memoryType),
  });

  return jsonResponse({ ok: true, insertedCount: result.insertedCount });
});
