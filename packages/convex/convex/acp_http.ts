import {
  AcpIngestRequestSchema,
  type AcpIngestRequest,
} from "@cmux/shared/convex-safe";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { getWorkerAuth } from "./users/utils/getWorkerAuth";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function ensureJsonRequest(
  req: Request
): Promise<{ json: unknown } | Response> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse(
      { code: 415, message: "Content-Type must be application/json" },
      415
    );
  }

  try {
    const json = await req.json();
    return { json };
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
  }
}

export const ingest = httpAction(async (ctx, req) => {
  const auth = await getWorkerAuth(req, { loggerPrefix: "[convex.acp]" });
  if (!auth) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const parsedBody = await ensureJsonRequest(req);
  if (parsedBody instanceof Response) return parsedBody;

  const validation = AcpIngestRequestSchema.safeParse(parsedBody.json);
  if (!validation.success) {
    return jsonResponse(
      { code: 400, message: "Invalid ACP ingest payload" },
      400
    );
  }

  const data: AcpIngestRequest = validation.data;

  const result = await ctx.runMutation(internal.acp.ingestFromWorker, {
    provider: data.provider,
    teamId: auth.payload.teamId,
    userId: auth.payload.userId,
    threadId: data.threadId as any,
    sessionId: data.sessionId,
    threadUpdate: data.threadUpdate,
    messages: data.messages?.map((msg) => ({
      ...msg,
      payload: msg.payload,
    })),
  });

  return jsonResponse({ ok: true, threadId: result.threadId });
});
