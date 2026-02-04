import { Effect } from "effect";
import { z } from "zod";
import { LiveServices } from "./effect/services";
import {
  httpError,
  jsonResponse,
  parseJsonBody,
  requireJsonContentType,
  runHttpEffect,
} from "./effect/http";
import { withObservability } from "./effect/observability";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, type ActionCtx } from "./_generated/server";
import { getWorkerAuth, type AuthContext } from "./users/utils/getWorkerAuth";
import { getSnapshotIdForProvider } from "./acp";

const providerIds = ["claude", "codex", "gemini", "opencode"] as const;

const spawnRequestSchema = z.object({
  teamSlugOrId: z.string().min(1),
  providerId: z.enum(providerIds),
  modelId: z.string().optional(),
  prompt: z.string().min(1),
  cwd: z.string().default("/workspace"),
  repo: z.string().optional(), // e.g., "owner/repo"
  branch: z.string().optional(),
});

type SpawnRequest = z.infer<typeof spawnRequestSchema>;

function parseRequest(body: unknown): Effect.Effect<SpawnRequest, ReturnType<typeof httpError>> {
  return Effect.try({
    try: () => spawnRequestSchema.parse(body),
    catch: (error) => {
      console.error("[spawn] Invalid request:", error);
      return httpError(400, { code: 400, message: "Invalid request body", details: String(error) });
    },
  });
}

function requireAuth(req: Request): Effect.Effect<AuthContext, ReturnType<typeof httpError>> {
  return Effect.tryPromise({
    try: async () => {
      const auth = await getWorkerAuth(req, { loggerPrefix: "[spawn]" });
      if (!auth) {
        throw new Error("Unauthorized");
      }
      return auth;
    },
    catch: () => httpError(401, { code: 401, message: "Unauthorized - requires x-cmux-token header" }),
  });
}

export const spawnEffect = (ctx: ActionCtx, req: Request) =>
  Effect.gen(function* () {
    // Authenticate via x-cmux-token
    const auth = yield* requireAuth(req);

    // Parse request body
    yield* requireJsonContentType(req);
    const body = yield* parseJsonBody(req);
    const request = yield* parseRequest(body);

    yield* Effect.annotateCurrentSpan({
      teamSlugOrId: request.teamSlugOrId,
      providerId: request.providerId,
      modelId: request.modelId ?? "default",
    });

    // Resolve team ID
    const teamId = auth.payload.teamId;

    // Get userId from auth context (for task run tokens)
    const userId = auth.type === "taskRun" ? auth.payload.userId : undefined;

    // Get snapshot ID for sandbox provider (always use E2B for spawn endpoint)
    const { snapshotId, providerName } = getSnapshotIdForProvider("e2b");

    // Try to claim a warm sandbox first
    let sandboxId: Id<"acpSandboxes"> | undefined;
    let sandboxStatus: string = "starting";

    if (userId) {
      const claimedWarm = yield* Effect.tryPromise({
        try: () =>
          ctx.runMutation(internal.acpSandboxes.claimWarmSandbox, {
            userId,
            teamId,
            snapshotId,
          }),
        catch: () => null,
      });
      if (claimedWarm) {
        sandboxId = claimedWarm._id;
        sandboxStatus = claimedWarm.status;
      }
    }

    // If no warm sandbox, spawn a new one
    if (!sandboxId) {
      const spawnResult = yield* Effect.tryPromise({
        try: () =>
          ctx.runAction(internal.acp.spawnSandbox, {
            teamId,
            providerName,
          }),
        catch: (error) => {
          console.error("[spawn] Failed to spawn sandbox:", error);
          return httpError(500, { code: 500, message: "Failed to spawn sandbox", details: String(error) });
        },
      });
      sandboxId = spawnResult.sandboxId;
    }

    if (!sandboxId) {
      return yield* Effect.fail(httpError(500, { code: 500, message: "Failed to allocate sandbox" }));
    }

    // Create conversation
    const sessionId = `spawn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const conversationId = yield* Effect.tryPromise({
      try: () =>
        ctx.runMutation(internal.acp.createConversationInternal, {
          teamId,
          userId,
          sessionId,
          providerId: request.providerId,
          cwd: request.cwd,
          acpSandboxId: sandboxId,
        }),
      catch: (error) => {
        console.error("[spawn] Failed to create conversation:", error);
        return httpError(500, { code: 500, message: "Failed to create conversation", details: String(error) });
      },
    });

    // Set custom model if specified
    if (request.modelId) {
      yield* Effect.tryPromise({
        try: () =>
          ctx.runMutation(internal.conversations.setModel, {
            conversationId,
            modelId: request.modelId!,
          }),
        catch: () => null, // Non-fatal
      });
    }

    // Increment sandbox conversation count
    yield* Effect.tryPromise({
      try: () =>
        ctx.runMutation(internal.acpSandboxes.incrementConversationCount, {
          sandboxId,
        }),
      catch: () => null, // Non-fatal
    });

    // Create and send the initial message
    const messageId = yield* Effect.tryPromise({
      try: () =>
        ctx.runMutation(internal.conversationMessages.create, {
          conversationId,
          role: "user",
          content: [{ type: "text", text: request.prompt }],
        }),
      catch: (error) => {
        console.error("[spawn] Failed to create message:", error);
        return httpError(500, { code: 500, message: "Failed to create message", details: String(error) });
      },
    });

    // Schedule message delivery (will retry until sandbox is ready)
    yield* Effect.tryPromise({
      try: () =>
        ctx.scheduler.runAfter(0, internal.acp.deliverMessageInternal, {
          conversationId,
          messageId: messageId as Id<"conversationMessages">,
          attempt: 0,
        }),
      catch: (error) => {
        console.error("[spawn] Failed to schedule delivery:", error);
        return httpError(500, { code: 500, message: "Failed to schedule delivery", details: String(error) });
      },
    });

    return jsonResponse({
      success: true,
      conversationId,
      sandboxId,
      messageId,
      status: "queued",
      sandboxStatus,
    });
  }).pipe(
    withObservability("spawn.create", {
      endpoint: "spawn.create",
      method: req.method,
    })
  );

/**
 * HTTP endpoint to spawn a new sandbox with an initial prompt.
 *
 * POST /api/spawn
 * Headers:
 *   x-cmux-token: <task_run_jwt or sandbox_jwt>
 *   Content-Type: application/json
 *
 * Body:
 * {
 *   "teamSlugOrId": "manaflow",
 *   "providerId": "claude" | "codex" | "gemini" | "opencode",
 *   "modelId": "claude-sonnet-4-20250514",  // optional
 *   "prompt": "What is 2+2?",
 *   "cwd": "/workspace",  // optional, defaults to /workspace
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "conversationId": "...",
 *   "sandboxId": "...",
 *   "messageId": "...",
 *   "status": "queued",
 *   "sandboxStatus": "starting" | "running" | ...
 * }
 */
export const spawn = httpAction(async (ctx, req) => {
  return runHttpEffect(spawnEffect(ctx, req).pipe(Effect.provide(LiveServices)));
});

// ============================================================================
// POST /api/spawn/message - Send follow-up message to conversation
// ============================================================================

const messageRequestSchema = z.object({
  conversationId: z.string().min(1),
  prompt: z.string().min(1),
});

export const messageEffect = (ctx: ActionCtx, req: Request) =>
  Effect.gen(function* () {
    // Authenticate via x-cmux-token
    yield* requireAuth(req);

    // Parse request body
    yield* requireJsonContentType(req);
    const body = yield* parseJsonBody(req);

    const parsed = messageRequestSchema.safeParse(body);
    if (!parsed.success) {
      return yield* Effect.fail(
        httpError(400, { code: 400, message: "Invalid request", details: parsed.error.message })
      );
    }
    const { conversationId, prompt } = parsed.data;

    yield* Effect.annotateCurrentSpan({ conversationId });

    // Verify conversation exists
    const conversation = yield* Effect.tryPromise({
      try: () =>
        ctx.runQuery(internal.conversations.getByIdInternal, {
          conversationId: conversationId as Id<"conversations">,
        }),
      catch: (error) => {
        console.error("[message] Failed to fetch conversation:", error);
        return httpError(500, { code: 500, message: "Failed to fetch conversation", details: String(error) });
      },
    });

    if (!conversation) {
      return yield* Effect.fail(
        httpError(404, { code: 404, message: "Conversation not found" })
      );
    }

    // Create the message
    const messageId = yield* Effect.tryPromise({
      try: () =>
        ctx.runMutation(internal.conversationMessages.create, {
          conversationId: conversationId as Id<"conversations">,
          role: "user",
          content: [{ type: "text", text: prompt }],
        }),
      catch: (error) => {
        console.error("[message] Failed to create message:", error);
        return httpError(500, { code: 500, message: "Failed to create message", details: String(error) });
      },
    });

    // Schedule message delivery
    yield* Effect.tryPromise({
      try: () =>
        ctx.scheduler.runAfter(0, internal.acp.deliverMessageInternal, {
          conversationId: conversationId as Id<"conversations">,
          messageId: messageId as Id<"conversationMessages">,
          attempt: 0,
        }),
      catch: (error) => {
        console.error("[message] Failed to schedule delivery:", error);
        return httpError(500, { code: 500, message: "Failed to schedule delivery", details: String(error) });
      },
    });

    return jsonResponse({
      success: true,
      conversationId,
      messageId,
      status: "queued",
    });
  }).pipe(
    withObservability("spawn.message", {
      endpoint: "spawn.message",
      method: req.method,
    })
  );

/**
 * HTTP endpoint to send a follow-up message to an existing conversation.
 *
 * POST /api/spawn/message
 * Headers:
 *   x-cmux-token: <task_run_jwt or sandbox_jwt>
 *   Content-Type: application/json
 *
 * Body:
 * {
 *   "conversationId": "...",
 *   "prompt": "What is 3+3?"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "conversationId": "...",
 *   "messageId": "...",
 *   "status": "queued"
 * }
 */
export const message = httpAction(async (ctx, req) => {
  return runHttpEffect(messageEffect(ctx, req).pipe(Effect.provide(LiveServices)));
});

// ============================================================================
// GET /api/spawn/trajectory - Get conversation messages
// ============================================================================

const trajectoryRequestSchema = z.object({
  conversationId: z.string().min(1),
  limit: z.coerce.number().optional().default(100),
});

export const trajectoryEffect = (ctx: ActionCtx, req: Request) =>
  Effect.gen(function* () {
    // Authenticate via x-cmux-token
    yield* requireAuth(req);

    // Parse query params
    const url = new URL(req.url);
    const params = Object.fromEntries(url.searchParams.entries());

    const parsed = trajectoryRequestSchema.safeParse(params);
    if (!parsed.success) {
      return yield* Effect.fail(
        httpError(400, { code: 400, message: "Invalid request", details: parsed.error.message })
      );
    }
    const { conversationId, limit } = parsed.data;

    yield* Effect.annotateCurrentSpan({ conversationId, limit });

    // Fetch messages
    const messages = yield* Effect.tryPromise({
      try: () =>
        ctx.runQuery(internal.conversationMessages.listByConversationInternal, {
          conversationId: conversationId as Id<"conversations">,
          limit,
        }),
      catch: (error) => {
        console.error("[trajectory] Failed to fetch messages:", error);
        return httpError(500, { code: 500, message: "Failed to fetch messages", details: String(error) });
      },
    });

    // Get conversation status
    const conversation = yield* Effect.tryPromise({
      try: () =>
        ctx.runQuery(internal.conversations.getByIdInternal, {
          conversationId: conversationId as Id<"conversations">,
        }),
      catch: () => null,
    });

    return jsonResponse({
      success: true,
      conversationId,
      status: conversation?.status ?? "unknown",
      messages: messages.map((m) => ({
        id: m._id,
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
        deliveryStatus: m.deliveryStatus,
        createdAt: m.createdAt,
      })),
    });
  }).pipe(
    withObservability("spawn.trajectory", {
      endpoint: "spawn.trajectory",
      method: req.method,
    })
  );

/**
 * HTTP endpoint to get conversation trajectory (messages).
 *
 * GET /api/spawn/trajectory?conversationId=xxx&limit=100
 * Headers:
 *   x-cmux-token: <task_run_jwt or sandbox_jwt>
 *
 * Response:
 * {
 *   "success": true,
 *   "conversationId": "...",
 *   "status": "active" | "completed" | ...,
 *   "messages": [
 *     {
 *       "id": "...",
 *       "role": "user" | "assistant",
 *       "content": [...],
 *       "toolCalls": [...],
 *       "deliveryStatus": "queued" | "sent" | "error",
 *       "createdAt": 1234567890
 *     }
 *   ]
 * }
 */
export const trajectory = httpAction(async (ctx, req) => {
  return runHttpEffect(trajectoryEffect(ctx, req).pipe(Effect.provide(LiveServices)));
});
