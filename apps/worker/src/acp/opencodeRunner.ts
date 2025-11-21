import { spawn } from "node:child_process";

import {
  type AcpIngestMessage,
  type AcpIngestRequest,
  type JsonValue,
  isJsonValue,
} from "@cmux/shared/convex-safe";
import { log } from "../logger";
import { convexRequest } from "../crown/convex";
import { WORKSPACE_ROOT } from "../crown/utils";

type Pending = {
  resolve: (value: RpcResponse | PromiseLike<RpcResponse>) => void;
  reject: (error: Error) => void;
};

type RpcResponse = { id: number; result?: unknown; error?: unknown };
type RpcRequest = { id?: number; method?: string; params?: unknown };

type StartAcpOptions = {
  prompt?: string;
  cwd?: string;
  token: string;
  convexUrl?: string;
};

export async function startOpencodeAcpSession(
  options: StartAcpOptions
): Promise<{
  threadId?: string;
  sessionId?: string;
  stopReason?: unknown;
}> {
  const convexUrl =
    options.convexUrl ||
    process.env.NEXT_PUBLIC_CONVEX_URL ||
    process.env.CONVEX_URL;
  const token = options.token;

  if (!token) {
    throw new Error("CMUX task run token is required to run ACP");
  }
  if (!convexUrl) {
    throw new Error("Convex URL is required to record ACP data");
  }

  const acpProc = spawn("opencode", ["acp"], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = "";
  let rpcId = 1;
  let sequence = 0;
  let threadId: string | undefined;
  let sessionId: string | undefined;
  let stopReason: unknown;

  const pending = new Map<number, Pending>();

  const send = (method: string, params: unknown) =>
    new Promise<RpcResponse>((resolve, reject) => {
      const id = rpcId++;
      pending.set(id, { resolve, reject });
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });
      acpProc.stdin.write(`${payload}\n`);
    });

  const ingest = async (payload: Partial<AcpIngestRequest>) => {
    const body: AcpIngestRequest = {
      provider: "opencode",
      threadId: threadId,
      sessionId: sessionId,
      ...payload,
    };
    const result = await convexRequest<{ threadId?: string }>(
      "/api/acp/ingest",
      token,
      body,
      convexUrl
    );
    if (result?.threadId && !threadId) {
      threadId = result.threadId;
    }
  };

  const respondNotImplemented = (id: number, method: string) => {
    const payload = {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method ${method} not implemented`,
      },
    };
    acpProc.stdin.write(`${JSON.stringify(payload)}\n`);
  };

  const handleNotification = async (notification: RpcRequest) => {
    if (notification.method !== "session/update" || !notification.params) {
      return;
    }
    const params = notification.params as {
      sessionId?: string;
      update?: { sessionUpdate?: string };
    };
    if (!sessionId && params.sessionId) {
      sessionId = params.sessionId;
    }

    const updateType =
      params.update && typeof params.update === "object"
        ? (params.update as { sessionUpdate?: string }).sessionUpdate
        : undefined;
    const payload: JsonValue = isJsonValue(notification)
      ? notification
      : (JSON.parse(JSON.stringify(notification)) as JsonValue);
    const message: AcpIngestMessage = {
      kind: "update",
      role: "agent",
      payload,
      sessionUpdateType: updateType,
      sequence: sequence++,
      createdAt: Date.now(),
    };
    await ingest({ messages: [message] });
  };

  const handleLine = async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: RpcResponse & RpcRequest;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      log("ERROR", "Failed to parse ACP line", { line, error });
      return;
    }

    if (typeof parsed.id === "number" && (parsed.result || parsed.error)) {
      const pendingEntry = pending.get(parsed.id);
      if (pendingEntry) {
        pending.delete(parsed.id);
        if (parsed.error) {
          pendingEntry.reject(
            new Error(
              typeof parsed.error === "string"
                ? parsed.error
                : JSON.stringify(parsed.error)
            )
          );
        } else {
          pendingEntry.resolve(parsed as RpcResponse);
        }
      }
      return;
    }

    if (typeof parsed.id === "number" && parsed.method) {
      respondNotImplemented(parsed.id, parsed.method);
      return;
    }

    if (!parsed.id && parsed.method) {
      await handleNotification(parsed);
    }
  };

  acpProc.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach((line) => {
      void handleLine(line);
    });
  });

  acpProc.stderr.on("data", (chunk: Buffer) => {
    log("WARN", "[opencode acp] stderr", chunk.toString("utf8"));
  });

  acpProc.on("exit", (code, signal) => {
    log("INFO", "[opencode acp] exited", { code, signal });
  });

  try {
    await send("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: false,
      },
    });

    const newSession = (await send("session/new", {
      cwd: options.cwd ?? WORKSPACE_ROOT,
      mcpServers: [],
    })) as { result?: { session_id?: string; sessionId?: string } };
    sessionId =
      newSession.result?.sessionId ??
      newSession.result?.session_id ??
      sessionId;

    await ingest({
      sessionId,
      threadUpdate: {
        sessionId,
        status: "running",
        title: options.prompt ? options.prompt.slice(0, 120) : undefined,
      },
    });

    if (options.prompt) {
      await ingest({
        messages: [
          {
            kind: "prompt",
            role: "user",
            payload: { prompt: options.prompt } as JsonValue,
            sequence: sequence++,
            createdAt: Date.now(),
          },
        ],
      });

      const promptResponse = (await send("session/prompt", {
        sessionId,
        prompt: [
          {
            type: "text",
            text: options.prompt,
          },
        ],
      })) as { result?: { stopReason?: unknown } };

      stopReason = promptResponse.result?.stopReason;
      const stopPayload: JsonValue = isJsonValue(
        promptResponse.result ?? promptResponse
      )
        ? ((promptResponse.result ?? promptResponse) as JsonValue)
        : (JSON.parse(
            JSON.stringify(promptResponse.result ?? promptResponse)
          ) as JsonValue);
      await ingest({
        threadUpdate: {
          status: "completed",
          lastStopReason:
            typeof stopReason === "string" ? stopReason : undefined,
        },
        messages: [
          {
            kind: "stop",
            role: "agent",
            payload: stopPayload,
            sequence: sequence++,
            createdAt: Date.now(),
          },
        ],
      });
    }
  } catch (error) {
    log("ERROR", "ACP session failed", { error });
    await ingest({
      threadUpdate: {
        status: "error",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      messages: [
        {
          kind: "error",
          role: "agent",
          payload: error instanceof Error ? error.message : String(error),
          sequence: sequence++,
          createdAt: Date.now(),
        },
      ],
    }).catch((ingestError) => {
      log("ERROR", "Failed to record ACP error", { ingestError });
    });
  } finally {
    acpProc.kill();
  }

  return { threadId, sessionId, stopReason };
}
