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

type AnthropicRequestMetadata = {
  distinct_id?: string;
  team_id?: string;
  task_run_id?: string;
  user_id?: string;
  [key: string]: unknown;
};

type AnthropicMessagesRequestBody = {
  metadata?: AnthropicRequestMetadata;
  messages?: unknown[];
  model?: string;
  stream?: boolean;
};

type UsageTotals = {
  inputTokens?: number;
  outputTokens?: number;
};

type UsageTracker = (usage?: UsageTotals, statusOverride?: number) => void;

export async function POST(request: NextRequest) {
  let tokenPayload: TaskRunTokenPayload | undefined;

  if (!TEMPORARY_DISABLE_AUTH) {
    try {
      tokenPayload = await requireTaskRunToken(request);
    } catch (authError) {
      console.error("[anthropic proxy] Auth error:", authError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    tokenPayload = await getTaskRunTokenIfAvailable(request);
  }

  let body: AnthropicMessagesRequestBody | undefined;
  let trackUsage: UsageTracker | undefined;

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
    body = (await request.json()) as AnthropicMessagesRequestBody;
    trackUsage = createUsageTracker({
      body,
      tokenPayload,
      useOriginalApiKey,
    });

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

    console.log(
      "[anthropic proxy] Anthropic response status:",
      response.status
    );

    // Handle streaming responses
    if (body.stream && response.ok) {
      const streamUsageContext = { responseStatus: response.status };
      // Create a TransformStream to pass through the SSE data
      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader();
          if (!reader) {
            controller.close();
            trackUsage?.(undefined, streamUsageContext.responseStatus);
            return;
          }

          let bufferedSseChunk = "";
          const decoder = new TextDecoder();
          let usageFromStream: UsageTotals | undefined;

          const processBufferedSse = () => {
            let delimiterIndex = bufferedSseChunk.indexOf("\n\n");

            while (delimiterIndex !== -1) {
              const rawEvent = bufferedSseChunk
                .slice(0, delimiterIndex)
                .replace(/\r/g, "")
                .trim();
              bufferedSseChunk = bufferedSseChunk.slice(delimiterIndex + 2);

              if (rawEvent.length === 0) {
                delimiterIndex = bufferedSseChunk.indexOf("\n\n");
                continue;
              }

              const dataLines = rawEvent
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.startsWith("data:"));

              for (const dataLine of dataLines) {
                const payload = dataLine.slice(5).trim();
                if (!payload || payload === "[DONE]") {
                  continue;
                }

                const usage = extractUsageFromSsePayload(payload);
                if (usage) {
                  usageFromStream = usage;
                }
              }

              delimiterIndex = bufferedSseChunk.indexOf("\n\n");
            }
          };

          const appendChunk = (value?: Uint8Array) => {
            try {
              if (value) {
                bufferedSseChunk += decoder.decode(value, { stream: true });
              } else {
                bufferedSseChunk += decoder.decode();
              }
              processBufferedSse();
            } catch (parseError) {
              console.error("[anthropic proxy] SSE parse error:", parseError);
            }
          };

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                break;
              }
              controller.enqueue(value);
              if (value) {
                appendChunk(value);
              }
            }
          } catch (error) {
            console.error("[anthropic proxy] Stream error:", error);
            controller.error(error);
          } finally {
            appendChunk();
            trackUsage?.(usageFromStream, streamUsageContext.responseStatus);
          }
        },
      });

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
    trackUsage?.(normalizeUsage(data?.usage), response.status);

    if (!response.ok) {
      console.error("[anthropic proxy] Anthropic error:", data);
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("[anthropic proxy] Error:", error);
    trackUsage?.(undefined, 500);
    return NextResponse.json(
      { error: "Failed to proxy request to Anthropic" },
      { status: 500 }
    );
  }
}

async function getTaskRunTokenIfAvailable(
  request: NextRequest
): Promise<TaskRunTokenPayload | undefined> {
  const token = request.headers.get("x-cmux-token");
  if (!token) {
    return undefined;
  }

  try {
    return await verifyTaskRunToken(token, env.CMUX_TASK_RUN_JWT_SECRET);
  } catch (error) {
    console.warn(
      "[anthropic proxy] Failed to verify optional CMUX token for analytics:",
      error
    );
    return undefined;
  }
}

function createUsageTracker({
  body,
  tokenPayload,
  useOriginalApiKey,
}: {
  body: AnthropicMessagesRequestBody;
  tokenPayload?: TaskRunTokenPayload;
  useOriginalApiKey: boolean;
}): UsageTracker {
  let hasTracked = false;

  return (usage?: UsageTotals, statusOverride?: number) => {
    if (hasTracked) {
      return;
    }
    hasTracked = true;

    void captureAnthropicUsageEvent({
      body,
      tokenPayload,
      usage,
      responseStatus: statusOverride,
      useOriginalApiKey,
    });
  };
}

async function captureAnthropicUsageEvent({
  body,
  tokenPayload,
  usage,
  responseStatus,
  useOriginalApiKey,
}: {
  body: AnthropicMessagesRequestBody;
  tokenPayload?: TaskRunTokenPayload;
  usage?: UsageTotals;
  responseStatus?: number;
  useOriginalApiKey: boolean;
}): Promise<void> {
  try {
    const metadata = body.metadata;
    const distinctId =
      tokenPayload?.userId ??
      toOptionalString(metadata?.distinct_id) ??
      toOptionalString(metadata?.user_id) ??
      "anthropic_proxy_anonymous";

    const messagesCount = Array.isArray(body.messages)
      ? body.messages.length
      : undefined;

    await captureServerPosthogEvent({
      distinctId,
      event: "anthropic_proxy_usage",
      properties: {
        userId: tokenPayload?.userId ?? toOptionalString(metadata?.user_id),
        teamId: tokenPayload?.teamId ?? toOptionalString(metadata?.team_id),
        taskRunId:
          tokenPayload?.taskRunId ?? toOptionalString(metadata?.task_run_id),
        model: typeof body.model === "string" ? body.model : undefined,
        requestedStream: Boolean(body.stream),
        messagesCount,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        responseStatus: responseStatus ?? 0,
        usedOriginalApiKey: useOriginalApiKey,
      },
    });
  } catch (analyticsError) {
    console.error(
      "[anthropic proxy] Failed to capture analytics:",
      analyticsError
    );
  }
}

function normalizeUsage(usage: unknown): UsageTotals | undefined {
  if (!isRecord(usage)) {
    return undefined;
  }

  const inputTokens = getNumberOrUndefined(
    usage.inputTokens ?? usage.input_tokens
  );
  const outputTokens = getNumberOrUndefined(
    usage.outputTokens ?? usage.output_tokens
  );

  if (inputTokens === undefined && outputTokens === undefined) {
    return undefined;
  }

  return { inputTokens, outputTokens };
}

function extractUsageFromSsePayload(payload: string): UsageTotals | undefined {
  try {
    const parsed = JSON.parse(payload);
    const usageFromMessage = isRecord(parsed?.message)
      ? normalizeUsage(parsed.message.usage)
      : undefined;
    const usage =
      usageFromMessage ?? normalizeUsage(parsed?.usage ?? parsed?.delta?.usage);
    return usage ?? undefined;
  } catch {
    return undefined;
  }
}

function getNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
