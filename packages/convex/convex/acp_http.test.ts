import { Effect, Layer } from "effect";
import { SignJWT } from "jose";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { acpCallbackEffect } from "./acp_http";
import { runHttpEffect } from "./effect/http";
import { makeEnvLayer } from "./effect/testLayers";
import type { EnvValues } from "./effect/services";
import type { ActionCtx } from "./_generated/server";

const TEST_SECRET = "acp_test_secret";

async function makeJwt(payload: { sandboxId: string; teamId: string }) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(new TextEncoder().encode(TEST_SECRET));
}

describe("acp_http", () => {
  const envLayer = makeEnvLayer({
    ACP_CALLBACK_SECRET: TEST_SECRET,
    CMUX_TASK_RUN_JWT_SECRET: "unused",
  } satisfies EnvValues);

  it("rejects missing bearer token", async () => {
    const req = new Request("http://localhost/api/acp/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const runMutation: ActionCtx["runMutation"] = async () => undefined;
    const ctx: Pick<ActionCtx, "runMutation"> = { runMutation };

    const response = await runHttpEffect(
      acpCallbackEffect(ctx, req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(401);
  });

  it("rejects non-json content-type", async () => {
    const token = await makeJwt({ sandboxId: "sandbox-1", teamId: "team-1" });
    const req = new Request("http://localhost/api/acp/callback", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "text/plain",
      },
      body: "hello",
    });

    const runMutation: ActionCtx["runMutation"] = async () => undefined;
    const ctx: Pick<ActionCtx, "runMutation"> = { runMutation };

    const response = await runHttpEffect(
      acpCallbackEffect(ctx, req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(415);
  });

  it("rejects invalid payload", async () => {
    const token = await makeJwt({ sandboxId: "sandbox-1", teamId: "team-1" });
    const req = new Request("http://localhost/api/acp/callback", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "message_chunk" }),
    });

    const runMutation: ActionCtx["runMutation"] = async () => undefined;
    const ctx: Pick<ActionCtx, "runMutation"> = { runMutation };

    const response = await runHttpEffect(
      acpCallbackEffect(ctx, req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(400);
  });

  it("dispatches message_chunk mutations", async () => {
    const token = await makeJwt({ sandboxId: "sandbox-1", teamId: "team-1" });
    const payload = {
      type: "message_chunk",
      conversationId: "conv_1",
      messageId: "msg_1",
      createdAt: 123,
      eventSeq: 1,
      content: { type: "text", text: "hi" },
    };

    const req = new Request("http://localhost/api/acp/callback", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const mutations: Array<{ fn: unknown; args: unknown }> = [];
    const runMutation: ActionCtx["runMutation"] = async (mutation, ...args) => {
      mutations.push({ fn: mutation, args: args[0] });
      return undefined;
    };
    const ctx: Pick<ActionCtx, "runMutation"> = { runMutation };

    const response = await runHttpEffect(
      acpCallbackEffect(ctx, req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(200);
    expect(mutations).toHaveLength(1);
    const mutationArgs = mutations[0]?.args;
    const parsed = z.object({ conversationId: z.string() }).safeParse(mutationArgs);
    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.conversationId : undefined).toBe("conv_1");
  });

  it("dispatches tool_call mutations with eventSeq", async () => {
    const token = await makeJwt({ sandboxId: "sandbox-1", teamId: "team-1" });
    const payload = {
      type: "tool_call",
      conversationId: "conv_1",
      messageId: "msg_1",
      eventSeq: 42,
      toolCall: {
        id: "tool_abc",
        name: "read_file",
        arguments: '{"path": "/test.txt"}',
        status: "pending",
      },
    };

    const req = new Request("http://localhost/api/acp/callback", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const mutations: Array<{ fn: unknown; args: unknown }> = [];
    const runMutation: ActionCtx["runMutation"] = async (mutation, ...args) => {
      mutations.push({ fn: mutation, args: args[0] });
      return undefined;
    };
    const ctx: Pick<ActionCtx, "runMutation"> = { runMutation };

    const response = await runHttpEffect(
      acpCallbackEffect(ctx, req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(200);
    expect(mutations).toHaveLength(1);
    const mutationArgs = mutations[0]?.args;
    const parsed = z.object({
      conversationId: z.string(),
      messageId: z.string(),
      eventSeq: z.number(),
      toolCall: z.object({
        id: z.string(),
        name: z.string(),
        arguments: z.string(),
        status: z.string(),
      }),
    }).safeParse(mutationArgs);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.conversationId).toBe("conv_1");
      expect(parsed.data.messageId).toBe("msg_1");
      expect(parsed.data.eventSeq).toBe(42);
      expect(parsed.data.toolCall.id).toBe("tool_abc");
      expect(parsed.data.toolCall.name).toBe("read_file");
    }
  });

  it("dispatches tool_call_update mutations", async () => {
    const token = await makeJwt({ sandboxId: "sandbox-1", teamId: "team-1" });
    const payload = {
      type: "tool_call_update",
      conversationId: "conv_1",
      messageId: "msg_1",
      toolCallId: "tool_abc",
      status: "completed",
      result: "ok",
    };

    const req = new Request("http://localhost/api/acp/callback", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const mutations: Array<{ fn: unknown; args: unknown }> = [];
    const runMutation: ActionCtx["runMutation"] = async (mutation, ...args) => {
      mutations.push({ fn: mutation, args: args[0] });
      return undefined;
    };
    const ctx: Pick<ActionCtx, "runMutation"> = { runMutation };

    const response = await runHttpEffect(
      acpCallbackEffect(ctx, req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(200);
    expect(mutations).toHaveLength(1);
    const mutationArgs = mutations[0]?.args;
    const parsed = z.object({
      messageId: z.string(),
      toolCallId: z.string(),
      status: z.string(),
      result: z.string().optional(),
    }).safeParse(mutationArgs);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.messageId).toBe("msg_1");
      expect(parsed.data.toolCallId).toBe("tool_abc");
      expect(parsed.data.status).toBe("completed");
      expect(parsed.data.result).toBe("ok");
    }
  });

  it("dispatches message_complete mutations with stopReason and messageId", async () => {
    const token = await makeJwt({ sandboxId: "sandbox-1", teamId: "team-1" });
    const payload = {
      type: "message_complete",
      conversationId: "conv_1",
      messageId: "msg_1",
      stopReason: "end_turn",
    };

    const req = new Request("http://localhost/api/acp/callback", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const mutations: Array<{ fn: unknown; args: unknown }> = [];
    const runMutation: ActionCtx["runMutation"] = async (mutation, ...args) => {
      mutations.push({ fn: mutation, args: args[0] });
      return undefined;
    };
    const ctx: Pick<ActionCtx, "runMutation"> = { runMutation };

    const response = await runHttpEffect(
      acpCallbackEffect(ctx, req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(200);
    expect(mutations).toHaveLength(1);
    const mutationArgs = mutations[0]?.args;
    const parsed = z.object({
      conversationId: z.string(),
      messageId: z.string(),
      stopReason: z.string(),
    }).safeParse(mutationArgs);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.conversationId).toBe("conv_1");
      expect(parsed.data.messageId).toBe("msg_1");
      expect(parsed.data.stopReason).toBe("end_turn");
    }
  });
});
