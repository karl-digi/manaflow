import { verifyTaskRunToken, type TaskRunTokenPayload } from "@cmux/shared";
import { CMUX_ANTHROPIC_PROXY_PLACEHOLDER_API_KEY } from "@cmux/shared/utils/anthropic";
import { env } from "@/lib/utils/www-env";
import { NextRequest, NextResponse } from "next/server";
import {
  trackAnthropicProxyRequest,
  type AnthropicProxySource,
} from "@/lib/analytics/track-anthropic-proxy";

const CLOUDFLARE_ANTHROPIC_API_URL =
  "https://gateway.ai.cloudflare.com/v1/0c1675e0def6de1ab3a50a4e17dc5656/cmux-ai-proxy/anthropic/v1/messages";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSignedThinkingBlock(node: Record<string, unknown>): boolean {
  const blockType = typeof node.type === "string" ? node.type : null;
  return (
    blockType === "thinking" ||
    blockType === "redacted_thinking" ||
    typeof node.signature === "string"
  );
}

function getBearerToken(header: string | null): string | null {
  if (!header) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return null;
  }

  const token = match[1]?.trim();
  return token ? token : null;
}

/**
 * Strip unsupported fields from cache_control objects in the request body.
 * Some clients (e.g. Claude Code) send cache_control with a "scope" field
 * that the Anthropic API rejects. The API only accepts { "type": "ephemeral" }.
 */
function sanitizeCacheControl(body: Record<string, unknown>): void {
  function walk(node: unknown): void {
    if (!isRecord(node)) return;

    // Anthropic requires replaying thinking blocks exactly as received.
    if (isSignedThinkingBlock(node)) {
      return;
    }

    if (isRecord(node.cache_control)) {
      delete (node.cache_control as Record<string, unknown>).scope;
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          walk(item);
        }
      } else if (isRecord(value)) {
        walk(value);
      }
    }
  }

  walk(body);
}

// Toggle between Cloudflare AI Gateway and Convex Anthropic Bedrock endpoint
// Set to true to use Cloudflare AI Gateway, false to use Convex Anthropic Bedrock
const USE_CLOUDFLARE_AI_GATEWAY = false;

const TEMPORARY_DISABLE_AUTH = true;

const hardCodedApiKey = CMUX_ANTHROPIC_PROXY_PLACEHOLDER_API_KEY;

function getAnthropicApiUrl(): string {
  if (USE_CLOUDFLARE_AI_GATEWAY) {
    return CLOUDFLARE_ANTHROPIC_API_URL;
  }
  // Use Convex Anthropic Bedrock endpoint
  // HTTP routes are served from .convex.site, not .convex.cloud
  const convexSiteUrl = env.NEXT_PUBLIC_CONVEX_URL.replace(
    ".convex.cloud",
    ".convex.site"
  );
  return `${convexSiteUrl}/api/anthropic/v1/messages`;
}

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

function getSource(request: NextRequest): AnthropicProxySource {
  const sourceHeader = request.headers.get("x-cmux-source");
  if (sourceHeader === "preview-new") {
    return "preview-new";
  }
  return "cmux";
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const source = getSource(request);
  let tokenPayload: TaskRunTokenPayload | null = null;

  // Try to extract token payload for tracking (even if auth is disabled)
  try {
    tokenPayload = await requireTaskRunToken(request);
  } catch {
    // Token extraction failed - will use defaults for tracking
  }

  if (!TEMPORARY_DISABLE_AUTH && !tokenPayload) {
    console.error("[anthropic proxy] Auth error: Missing or invalid token");
    // Only track in www when using Cloudflare directly (not forwarding to Convex)
    // Convex proxy handles tracking for the Convex path to avoid double counting
    if (USE_CLOUDFLARE_AI_GATEWAY) {
      void trackAnthropicProxyRequest({
        teamId: "unknown",
        userId: "unknown",
        taskRunId: "unknown",
        source,
        model: "unknown",
        stream: false,
        isOAuthToken: false,
        responseStatus: 401,
        latencyMs: Date.now() - startTime,
        errorType: "auth_error",
      });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const beta = searchParams.get("beta");

    const xApiKeyHeader = request.headers.get("x-api-key");
    const authorizationHeader = request.headers.get("authorization");
    const bearerToken = getBearerToken(authorizationHeader);
    const providedApiKey =
      xApiKeyHeader ?? (bearerToken && !getIsOAuthToken(bearerToken) ? bearerToken : null);
    const isOAuthToken = getIsOAuthToken(providedApiKey || bearerToken || "");
    const body = await request.json();
    sanitizeCacheControl(body);

    // Build headers
    // Forward the user's actual API key to Convex so it can properly route:
    // - User key (any non-placeholder) -> Anthropic/Cloudflare
    // - Placeholder key -> Bedrock (platform credits)
    const apiKeyForRequest = USE_CLOUDFLARE_AI_GATEWAY
      ? (env.ANTHROPIC_API_KEY ?? "")
      : (providedApiKey ?? hardCodedApiKey);

    const filteredHeaders = new Headers();
    request.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (
        ![
          "host",
          "content-length",
          "connection",
          "transfer-encoding",
        ].includes(lowerKey)
      ) {
        filteredHeaders.set(key, value);
      }
    });

    filteredHeaders.set("content-type", "application/json");
    if (!filteredHeaders.has("anthropic-version")) {
      filteredHeaders.set("anthropic-version", "2023-06-01");
    }
    if (!filteredHeaders.has("x-api-key")) {
      filteredHeaders.set("x-api-key", apiKeyForRequest);
    }

    // Forward cmux headers to Convex so it can extract auth for tracking
    if (!USE_CLOUDFLARE_AI_GATEWAY) {
      const cmuxToken = request.headers.get("x-cmux-token");
      const cmuxSource = request.headers.get("x-cmux-source");
      if (cmuxToken) {
        filteredHeaders.set("x-cmux-token", cmuxToken);
      }
      if (cmuxSource) {
        filteredHeaders.set("x-cmux-source", cmuxSource);
      }
    }

    // Preserve caller betas when present, otherwise add the legacy beta fallback.
    if (beta === "true" && !filteredHeaders.has("anthropic-beta")) {
      filteredHeaders.set("anthropic-beta", "messages-2023-12-15");
    }

    const response = await fetch(getAnthropicApiUrl(), {
      method: "POST",
      headers: Object.fromEntries(filteredHeaders.entries()),
      body: JSON.stringify(body),
    });

    console.log(
      "[anthropic proxy] Anthropic response status:",
      response.status
    );

    // Handle streaming responses
    if (body.stream && response.ok) {
      // Only track in www when using Cloudflare directly (not forwarding to Convex)
      // Convex proxy handles tracking for the Convex path to avoid double counting
      if (USE_CLOUDFLARE_AI_GATEWAY) {
        void trackAnthropicProxyRequest({
          teamId: tokenPayload?.teamId ?? "unknown",
          userId: tokenPayload?.userId ?? "unknown",
          taskRunId: tokenPayload?.taskRunId ?? "unknown",
          source,
          model: body.model ?? "unknown",
          stream: true,
          isOAuthToken,
          responseStatus: response.status,
          latencyMs: Date.now() - startTime,
        });
      }

      // Create a TransformStream to pass through the SSE data
      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader();
          if (!reader) {
            controller.close();
            return;
          }

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                break;
              }
              controller.enqueue(value);
            }
          } catch (error) {
            console.error("[anthropic proxy] Stream error:", error);
            controller.error(error);
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

    if (!response.ok) {
      console.error("[anthropic proxy] Anthropic error:", data);
      // Only track in www when using Cloudflare directly (not forwarding to Convex)
      // Convex proxy handles tracking for the Convex path to avoid double counting
      if (USE_CLOUDFLARE_AI_GATEWAY) {
        void trackAnthropicProxyRequest({
          teamId: tokenPayload?.teamId ?? "unknown",
          userId: tokenPayload?.userId ?? "unknown",
          taskRunId: tokenPayload?.taskRunId ?? "unknown",
          source,
          model: body.model ?? "unknown",
          stream: false,
          isOAuthToken,
          responseStatus: response.status,
          latencyMs: Date.now() - startTime,
          errorType: data?.error?.type ?? "anthropic_error",
        });
      }
      return NextResponse.json(data, { status: response.status });
    }

    // Only track in www when using Cloudflare directly (not forwarding to Convex)
    // Convex proxy handles tracking for the Convex path to avoid double counting
    if (USE_CLOUDFLARE_AI_GATEWAY) {
      void trackAnthropicProxyRequest({
        teamId: tokenPayload?.teamId ?? "unknown",
        userId: tokenPayload?.userId ?? "unknown",
        taskRunId: tokenPayload?.taskRunId ?? "unknown",
        source,
        model: data.model ?? body.model ?? "unknown",
        stream: false,
        isOAuthToken,
        responseStatus: response.status,
        latencyMs: Date.now() - startTime,
        inputTokens: data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
        cacheCreationInputTokens: data.usage?.cache_creation_input_tokens,
        cacheReadInputTokens: data.usage?.cache_read_input_tokens,
      });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("[anthropic proxy] Error:", error);
    // Only track in www when using Cloudflare directly (not forwarding to Convex)
    // Convex proxy handles tracking for the Convex path to avoid double counting
    if (USE_CLOUDFLARE_AI_GATEWAY) {
      void trackAnthropicProxyRequest({
        teamId: tokenPayload?.teamId ?? "unknown",
        userId: tokenPayload?.userId ?? "unknown",
        taskRunId: tokenPayload?.taskRunId ?? "unknown",
        source,
        model: "unknown",
        stream: false,
        isOAuthToken: false,
        responseStatus: 500,
        latencyMs: Date.now() - startTime,
        errorType: "proxy_error",
      });
    }
    return NextResponse.json(
      { error: "Failed to proxy request to Anthropic" },
      { status: 500 }
    );
  }
}
