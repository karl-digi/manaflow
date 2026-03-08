/**
 * HTTP Actions for Autopilot with JWT Authentication
 *
 * These endpoints allow sandbox autopilot scripts to communicate with Convex
 * using their task-run JWT for authentication.
 *
 * Endpoints:
 * - POST /api/autopilot/heartbeat - Update heartbeat timestamp
 * - POST /api/autopilot/thread-id - Store Codex thread-id for resume
 * - POST /api/autopilot/status - Update autopilot status
 * - GET /api/autopilot/info - Get autopilot info for resume
 */

import { verifyTaskRunToken } from "../../shared/src/convex-safe";
import { env } from "../_shared/convex-env";
import { jsonResponse, extractBearerToken } from "../_shared/http-utils";
import { AUTOPILOT_STATUSES } from "../_shared/autopilot-types";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { z } from "zod";

/**
 * Verify JWT from Authorization header, returning taskRunId or an error Response.
 */
async function authenticateRequest(
  req: Request
): Promise<{ taskRunId: string } | Response> {
  const authHeader = req.headers.get("authorization");
  const token = extractBearerToken(authHeader);
  if (!token) {
    return jsonResponse({ code: 401, message: "Missing authorization token" }, 401);
  }

  try {
    const tokenPayload = await verifyTaskRunToken(
      token,
      env.CMUX_TASK_RUN_JWT_SECRET
    );
    return { taskRunId: tokenPayload.taskRunId };
  } catch (error) {
    console.error("[autopilot_http] Failed to verify JWT", error);
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }
}

/**
 * Verify Content-Type is application/json. Returns error Response or null.
 */
function requireJsonContentType(req: Request): Response | null {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse(
      { code: 415, message: "Content-Type must be application/json" },
      415
    );
  }
  return null;
}

/**
 * POST /api/autopilot/heartbeat
 *
 * Update the last heartbeat timestamp for an autopilot session.
 * Called periodically by the autopilot wrapper script in the sandbox.
 */
export const autopilotHeartbeat = httpAction(async (ctx, req) => {
  const contentTypeError = requireJsonContentType(req);
  if (contentTypeError) return contentTypeError;

  const authResult = await authenticateRequest(req);
  if (authResult instanceof Response) return authResult;
  const { taskRunId } = authResult;

  try {
    const result = await ctx.runMutation(internal.taskRuns.updateAutopilotHeartbeat, {
      id: taskRunId as Id<"taskRuns">,
    });

    return jsonResponse({
      ok: true,
      lastHeartbeat: result.lastHeartbeat,
    });
  } catch (error) {
    console.error("[autopilot_http] Failed to update heartbeat", error);
    const message = error instanceof Error ? error.message : "Failed to update heartbeat";
    return jsonResponse({ code: 500, message }, 500);
  }
});

/**
 * POST /api/autopilot/thread-id
 *
 * Store the Codex thread-id for session resume.
 * Called by the sandbox when codex notify hook receives thread_id.
 */
export const autopilotThreadId = httpAction(async (ctx, req) => {
  const contentTypeError = requireJsonContentType(req);
  if (contentTypeError) return contentTypeError;

  const authResult = await authenticateRequest(req);
  if (authResult instanceof Response) return authResult;
  const { taskRunId } = authResult;

  // Parse and validate body
  const ThreadIdSchema = z.object({
    threadId: z.string().min(1),
  });

  let payload: z.infer<typeof ThreadIdSchema>;
  try {
    const parsed = await req.json();
    const validation = ThreadIdSchema.safeParse(parsed);
    if (!validation.success) {
      return jsonResponse({ code: 400, message: "Invalid payload: threadId required" }, 400);
    }
    payload = validation.data;
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON" }, 400);
  }

  try {
    await ctx.runMutation(internal.taskRuns.updateCodexThreadId, {
      id: taskRunId as Id<"taskRuns">,
      threadId: payload.threadId,
    });

    return jsonResponse({
      ok: true,
      threadId: payload.threadId,
    });
  } catch (error) {
    console.error("[autopilot_http] Failed to store thread-id", error);
    const message = error instanceof Error ? error.message : "Failed to store thread-id";
    return jsonResponse({ code: 500, message }, 500);
  }
});

/**
 * POST /api/autopilot/status
 *
 * Update the autopilot status (running/paused/wrap-up/completed/stopped).
 * Called by the autopilot wrapper script when status changes.
 */
export const autopilotStatus = httpAction(async (ctx, req) => {
  const contentTypeError = requireJsonContentType(req);
  if (contentTypeError) return contentTypeError;

  const authResult = await authenticateRequest(req);
  if (authResult instanceof Response) return authResult;
  const { taskRunId } = authResult;

  // Parse and validate body
  const StatusSchema = z.object({
    status: z.enum(AUTOPILOT_STATUSES),
  });

  let payload: z.infer<typeof StatusSchema>;
  try {
    const parsed = await req.json();
    const validation = StatusSchema.safeParse(parsed);
    if (!validation.success) {
      return jsonResponse(
        { code: 400, message: "Invalid payload: status must be running/paused/wrap-up/completed/stopped" },
        400
      );
    }
    payload = validation.data;
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON" }, 400);
  }

  try {
    await ctx.runMutation(internal.taskRuns.updateAutopilotStatus, {
      id: taskRunId as Id<"taskRuns">,
      status: payload.status,
    });

    return jsonResponse({
      ok: true,
      status: payload.status,
    });
  } catch (error) {
    console.error("[autopilot_http] Failed to update status", error);
    const message = error instanceof Error ? error.message : "Failed to update status";
    return jsonResponse({ code: 500, message }, 500);
  }
});

/**
 * GET /api/autopilot/info
 *
 * Get autopilot info for resume.
 * Returns thread-id and config for resuming an autopilot session.
 */
export const autopilotInfo = httpAction(async (ctx, req) => {
  const authResult = await authenticateRequest(req);
  if (authResult instanceof Response) return authResult;
  const { taskRunId } = authResult;

  try {
    const info = await ctx.runQuery(internal.taskRuns.getAutopilotInfo, {
      id: taskRunId as Id<"taskRuns">,
    });

    if (!info) {
      return jsonResponse({ code: 404, message: "Task run not found" }, 404);
    }

    return jsonResponse({
      taskRunId: info.taskRunId,
      taskId: info.taskId,
      status: info.status,
      autopilotConfig: info.autopilotConfig,
      autopilotStatus: info.autopilotStatus,
      codexThreadId: info.codexThreadId,
      vscode: info.vscode ? {
        url: info.vscode.url,
        status: info.vscode.status,
      } : null,
    });
  } catch (error) {
    console.error("[autopilot_http] Failed to get autopilot info", error);
    const message = error instanceof Error ? error.message : "Failed to get autopilot info";
    return jsonResponse({ code: 500, message }, 500);
  }
});
