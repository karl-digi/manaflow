import { verifyTaskRunToken, type TaskRunTokenPayload } from "@cmux/shared";
import { captureServerPosthogEvent } from "@/lib/analytics/posthog-server";
import { env } from "@/lib/utils/www-env";
import { NextRequest, NextResponse } from "next/server";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const TEMPORARY_DISABLE_AUTH = true;

const hardCodedApiKey = "sk_placeholder_cmux_anthropic_api_key";

async function requireTaskRunToken(
  request: NextRequest
): Promise<TaskRunTokenPayload> {
  const token = request.headers.get("x-cmux-token");
  if (!token) {
    throw new Error("Missing CMUX token");
  }

  return verifyTaskRunToken(token, env.CMUX_TASK_RUN_JWT_SECRET);
}

function getIsOAuthToken(token: string) {
  return token.includes("sk-ant-oat");
}

async function getTaskRunPayloadIfAvailable(
  request: NextRequest
): Promise<TaskRunTokenPayload | null> {
  const token = request.headers.get("x-cmux-token");
  if (!token) {
    return null;
  }

  try {
    return await verifyTaskRunToken(token, env.CMUX_TASK_RUN_JWT_SECRET);
  } catch (error) {
    console.warn(
      "[anthropic proxy] Failed to verify CMUX token for analytics",
      error
    );
    return null;
  }
}

export async function POST(request: NextRequest) {
  let taskRunPayload: TaskRunTokenPayload | null = null;

  if (!TEMPORARY_DISABLE_AUTH) {
    try {
      taskRunPayload = await requireTaskRunToken(request);
    } catch (authError) {
      console.error("[anthropic proxy] Auth error:", authError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    taskRunPayload = await getTaskRunPayloadIfAvailable(request);
  }

  try {
    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const beta = searchParams.get("beta");

    const xApiKeyHeader = request.headers.get("x-api-key");
    const authorizationHeader = request.headers.get("authorization");
    const isOAuthToken = getIsOAuthToken(
      xApiKeyHeader || authorizationHeader || ""
    );
    const useOriginalApiKey =
      !isOAuthToken &&
      xApiKeyHeader !== hardCodedApiKey &&
      authorizationHeader !== hardCodedApiKey;
    const body = (await request.json()) as AnthropicMessagesRequestBody;
    const messagesCount = Array.isArray(body.messages) ? body.messages.length : 0;
    const modelName = typeof body.model === "string" ? body.model : "unknown";
    const isStreamingRequest = Boolean(body.stream);

    // Build headers
    const headers: Record<string, string> =
      useOriginalApiKey && !TEMPORARY_DISABLE_AUTH
        ? (() => {
            const filtered = new Headers(request.headers);
            return Object.fromEntries(filtered);
          })()
        : {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          };

    // Add beta header if beta param is present
    if (!useOriginalApiKey) {
      if (beta === "true") {
        headers["anthropic-beta"] = "messages-2023-12-15";
      }
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const analyticsContext: AnthropicUsageContext = {
      distinctId: taskRunPayload?.userId ?? "anonymous",
      messagesCount,
      model: modelName,
      payload: taskRunPayload,
      status: response.status,
      streaming: isStreamingRequest,
    };

    console.log(
      "[anthropic proxy] Anthropic response status:",
      response.status
    );

    // Handle streaming responses
    if (body.stream && response.ok) {
      const stream = forwardAnthropicStream(
        response.body,
        async (usage) => {
          await trackAnthropicUsage(analyticsContext, usage);
        }
      );

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Handle non-streaming responses
    const data = await response.json();

    if (!response.ok) {
      console.error("[anthropic proxy] Anthropic error:", data);
      return NextResponse.json(data, { status: response.status });
    }

    await trackAnthropicUsage(
      analyticsContext,
      extractUsageFromResponseBody(data)
    );

    return NextResponse.json(data);
  } catch (error) {
    console.error("[anthropic proxy] Error:", error);
    return NextResponse.json(
      { error: "Failed to proxy request to Anthropic" },
      { status: 500 }
    );
  }
}

type AnthropicMessagesRequestBody = {
  messages?: unknown[];
  model?: string;
  stream?: boolean;
};

type TokenUsageMetrics = {
  inputTokens?: number;
  outputTokens?: number;
};

type AnthropicUsageContext = {
  distinctId: string;
  messagesCount: number;
  model: string;
  payload: TaskRunTokenPayload | null;
  status: number;
  streaming: boolean;
};

async function trackAnthropicUsage(
  context: AnthropicUsageContext,
  usage: TokenUsageMetrics | null
): Promise<void> {
  try {
    await captureServerPosthogEvent({
      distinctId: context.distinctId,
      event: "anthropic_messages_usage",
      properties: {
        user_id: context.payload?.userId ?? null,
        team_id: context.payload?.teamId ?? null,
        task_run_id: context.payload?.taskRunId ?? null,
        model: context.model,
        streaming: context.streaming,
        response_status: context.status,
        messages_count: context.messagesCount,
        input_tokens: usage?.inputTokens ?? null,
        output_tokens: usage?.outputTokens ?? null,
      },
    });
  } catch (error) {
    console.error("[anthropic proxy] Failed to send PostHog event", error);
  }
}

function extractUsageFromResponseBody(
  data: unknown
): TokenUsageMetrics | null {
  if (!data || typeof data !== "object" || data === null) {
    return null;
  }

  const usage = (data as { usage?: Record<string, unknown> }).usage;
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const metrics: TokenUsageMetrics = {};
  let hasUsage = false;

  if (typeof usage.input_tokens === "number") {
    metrics.inputTokens = usage.input_tokens;
    hasUsage = true;
  }

  if (typeof usage.output_tokens === "number") {
    metrics.outputTokens = usage.output_tokens;
    hasUsage = true;
  }

  return hasUsage ? metrics : null;
}

function forwardAnthropicStream(
  source: ReadableStream<Uint8Array> | null,
  onComplete: (usage: TokenUsageMetrics | null) => Promise<void>
): ReadableStream<Uint8Array> {
  const usageParser = createSSEUsageParser();

  return new ReadableStream({
    async start(controller) {
      if (!source) {
        controller.close();
        await onComplete(null);
        return;
      }

      const reader = source.getReader();
      const decoder = new TextDecoder();
      let readerFinished = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            readerFinished = true;
            break;
          }

          if (value) {
            controller.enqueue(value);
            usageParser.push(decoder.decode(value, { stream: true }));
          }
        }

        usageParser.flush(decoder.decode());
        controller.close();
        await onComplete(usageParser.getUsage());
      } catch (error) {
        console.error("[anthropic proxy] Stream error:", error);
        controller.error(error);
        usageParser.flush(decoder.decode());
        await onComplete(usageParser.getUsage());
      } finally {
        if (!readerFinished) {
          await reader.cancel().catch(() => {});
        }
      }
    },
  });
}

function createSSEUsageParser() {
  let buffer = "";
  const usage: TokenUsageMetrics = {};
  let hasUsage = false;

  function push(chunk: string) {
    if (!chunk) {
      return;
    }
    buffer += chunk;
    drain();
  }

  function flush(extra?: string) {
    if (extra) {
      buffer += extra;
    }
    drain(true);
  }

  function drain(force = false) {
    let separatorIndex: number;

    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      parseEvent(rawEvent);
    }

    if (force && buffer.trim().length > 0) {
      parseEvent(buffer);
      buffer = "";
    }
  }

  function parseEvent(rawEvent: string) {
    if (!rawEvent.trim()) {
      return;
    }

    const lines = rawEvent.split(/\r?\n/);
    let eventName: string | null = null;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (!eventName || dataLines.length === 0) {
      return;
    }

    const payload = dataLines.join("\n");

    try {
      const parsed = JSON.parse(payload);
      applyUsageFromEvent(eventName, parsed);
    } catch {
      // Ignore JSON parse errors
    }
  }

  function applyUsageFromEvent(eventName: string, data: unknown) {
    if (!data || typeof data !== "object") {
      return;
    }

    const usageCandidates: Array<{
      mode: "delta" | "absolute";
      usage: Record<string, unknown>;
    }> = [];

    if ("usage" in data && data.usage) {
      usageCandidates.push({
        usage: data.usage as Record<string, unknown>,
        mode: eventName === "message_delta" ? "delta" : "absolute",
      });
    }

    if ("message" in data && data.message && typeof data.message === "object") {
      const messageUsage = (data.message as { usage?: Record<string, unknown> })
        .usage;
      if (messageUsage) {
        usageCandidates.push({
          usage: messageUsage,
          mode: "absolute",
        });
      }
    }

    if ("delta" in data && data.delta && typeof data.delta === "object") {
      const deltaUsage = (data.delta as { usage?: Record<string, unknown> })
        .usage;
      if (deltaUsage) {
        usageCandidates.push({
          usage: deltaUsage,
          mode: eventName === "message_delta" ? "delta" : "absolute",
        });
      }
    }

    for (const candidate of usageCandidates) {
      mergeUsage(candidate.usage, candidate.mode);
    }
  }

  function mergeUsage(
    usageSource: Record<string, unknown>,
    mode: "delta" | "absolute"
  ) {
    const inputValue = usageSource.input_tokens;
    if (typeof inputValue === "number") {
      usage.inputTokens = inputValue;
      hasUsage = true;
    }

    const outputValue = usageSource.output_tokens;
    if (typeof outputValue === "number") {
      if (mode === "delta") {
        usage.outputTokens = (usage.outputTokens ?? 0) + outputValue;
      } else {
        usage.outputTokens = outputValue;
      }
      hasUsage = true;
    }
  }

  return {
    push,
    flush,
    getUsage(): TokenUsageMetrics | null {
      return hasUsage ? usage : null;
    },
  };
}
