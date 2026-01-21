/**
 * Minimal test script for Claude Agent SDK with structured output via Anthropic proxy.
 *
 * Usage:
 *   bun scripts/test-claude-agent-sdk.ts
 *
 * Environment variables:
 *   CONVEX_SITE_URL - The Convex site URL (e.g., https://xxx.convex.site)
 *   ANTHROPIC_API_KEY - Optional: Direct Anthropic API key (bypasses proxy)
 *
 * This script tests:
 * 1. Claude Agent SDK's query function
 * 2. Structured JSON output format (json_schema)
 * 3. Routing through the Anthropic proxy at ${CONVEX_SITE_URL}/api/anthropic
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";

export {};

// IMPORTANT: Set environment variables BEFORE importing the SDK
// The SDK may cache the API client at import time
const convexSiteUrlRaw =
  process.env.CONVEX_SITE_URL?.trim() ??
  process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
const envAnthropicBaseUrl = process.env.ANTHROPIC_BASE_URL?.trim();
const directApiKey = process.env.ANTHROPIC_API_KEY?.trim();
// Convert .convex.cloud to .convex.site for HTTP endpoints
const normalizedConvexSiteUrl = convexSiteUrlRaw
  ? convexSiteUrlRaw.replace(/\/+$/, "").replace(".convex.cloud", ".convex.site")
  : undefined;
const proxyBaseUrl =
  envAnthropicBaseUrl ??
  (normalizedConvexSiteUrl
    ? `${normalizedConvexSiteUrl}/api/anthropic`
    : undefined);

console.log("=== Claude Agent SDK Test ===\n");

// Log all relevant env vars
console.log("=== Current Environment (before modification) ===");
console.log("CONVEX_SITE_URL:", process.env.CONVEX_SITE_URL ?? "(not set)");
console.log("ANTHROPIC_API_KEY:", process.env.ANTHROPIC_API_KEY ? `${process.env.ANTHROPIC_API_KEY.slice(0, 10)}...` : "(not set)");
console.log("ANTHROPIC_BASE_URL:", process.env.ANTHROPIC_BASE_URL ?? "(not set)");
console.log("");

const claudeConfigDir = join(tmpdir(), "cmux-claude-agent-sdk");
mkdirSync(claudeConfigDir, { recursive: true });

// Create empty settings in CLAUDE_CONFIG_DIR
const emptySettings = {
  $schema: "https://json.schemastore.org/claude-code-settings.json",
  hooks: {},
};
writeFileSync(
  join(claudeConfigDir, "settings.json"),
  JSON.stringify(emptySettings, null, 2)
);

// Also create a .claude directory with empty settings in the cwd
// The SDK loads project settings from {cwd}/.claude/settings.json
const claudeProjectDir = join(claudeConfigDir, ".claude");
mkdirSync(claudeProjectDir, { recursive: true });
writeFileSync(
  join(claudeProjectDir, "settings.json"),
  JSON.stringify(emptySettings, null, 2)
);

// Create a fake home directory with empty .claude settings
// The SDK loads user settings from $HOME/.claude/settings.json
const fakeHomeDir = join(claudeConfigDir, "home");
const fakeHomeClaude = join(fakeHomeDir, ".claude");
mkdirSync(fakeHomeClaude, { recursive: true });
writeFileSync(
  join(fakeHomeClaude, "settings.json"),
  JSON.stringify(emptySettings, null, 2)
);

process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
// Override HOME to use our fake home with empty hooks
process.env.HOME = fakeHomeDir;
// Override CLAUDE_PROJECT_DIR to prevent loading project hooks
process.env.CLAUDE_PROJECT_DIR = claudeConfigDir;

type ProxySetup = {
  baseUrl: string;
  close: () => Promise<void>;
};

async function startCountTokensShim(upstreamBaseUrl: string): Promise<ProxySetup> {
  // Normalize upstream URL - remove trailing slash if present
  const normalizedUpstream = upstreamBaseUrl.replace(/\/+$/, "");
  console.log(`[shim] Upstream base URL: ${normalizedUpstream}`);
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

  const server = createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.statusCode = 400;
        res.end("Missing request URL");
        return;
      }

      const requestUrl = new URL(req.url, "http://127.0.0.1");
      if (requestUrl.pathname.endsWith("/v1/messages/count_tokens")) {
        console.log(`[shim] Intercepted count_tokens request, returning mock response`);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ input_tokens: 0 }));
        return;
      }

      if (requestUrl.pathname.startsWith("/api/event_logging/")) {
        res.statusCode = 204;
        res.end();
        return;
      }

      // Build target URL by appending the request path to the upstream base URL
      // new URL() with absolute path replaces the base path, so we concatenate manually
      const targetUrl = new URL(`${normalizedUpstream}${requestUrl.pathname}${requestUrl.search}`);
      console.log(`[shim] ${req.method} ${req.url} -> ${targetUrl.href}`);

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      const contentTypeHeader = req.headers["content-type"];
      const contentType = Array.isArray(contentTypeHeader)
        ? contentTypeHeader.join(",")
        : contentTypeHeader ?? "";
      if (requestUrl.pathname.endsWith("/v1/messages") && body && contentType.includes("application/json")) {
        try {
          const parsed = JSON.parse(body.toString("utf8"));
          if (isRecord(parsed)) {
            const streamValue = parsed.stream;
            const modelValue = parsed.model;
            console.log(
              `[shim] Request details: model=${typeof modelValue === "string" ? modelValue : "unknown"}, stream=${streamValue === true ? "true" : streamValue === false ? "false" : "unset"}`
            );
          }
        } catch (error) {
          console.error("[shim] Failed to parse request body:", error);
        }
      }

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (!value) {
          continue;
        }
        const lowerKey = key.toLowerCase();
        if (
          lowerKey === "host" ||
          lowerKey === "content-length" ||
          lowerKey === "accept-encoding"
        ) {
          continue;
        }
        headers.set(key, Array.isArray(value) ? value.join(",") : value);
      }
      headers.set("accept-encoding", "identity");

      const upstreamResponse = await fetch(targetUrl, {
        method: req.method,
        headers,
        body,
      });

      console.log(`[shim] Upstream response: ${upstreamResponse.status}`);
      res.statusCode = upstreamResponse.status;
      upstreamResponse.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      if (!upstreamResponse.body) {
        res.end();
        return;
      }

      const shouldPreview =
        requestUrl.pathname.endsWith("/v1/messages") ||
        requestUrl.pathname.endsWith("/v1/messages/stream");
      const previewLimit = 2000;
      const previewChunks: Buffer[] = [];
      let previewSize = 0;

      const reader = upstreamResponse.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (shouldPreview && previewSize < previewLimit) {
          const chunkBuffer = Buffer.from(value);
          const remaining = previewLimit - previewSize;
          previewChunks.push(chunkBuffer.subarray(0, remaining));
          previewSize += Math.min(chunkBuffer.length, remaining);
        }
        res.write(Buffer.from(value));
      }
      res.end();
      if (shouldPreview && previewChunks.length > 0) {
        const previewText = Buffer.concat(previewChunks).toString("utf8");
        console.log(`[shim] Response preview: ${previewText}`);
      }
    } catch (error) {
      console.error("[shim] Proxy error:", error);
      res.statusCode = 502;
      res.end("Proxy error");
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind local proxy server.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

let proxySetup: ProxySetup | null = null;

// Set up environment for the proxy BEFORE importing SDK
if (proxyBaseUrl) {
  proxySetup = await startCountTokensShim(proxyBaseUrl);
  console.log(`Using Anthropic proxy (via local shim): ${proxySetup.baseUrl}`);
  process.env.ANTHROPIC_BASE_URL = proxySetup.baseUrl;
  process.env.ANTHROPIC_API_KEY = "sk_placeholder_cmux_anthropic_api_key";
  console.log(
    `Set ANTHROPIC_API_KEY to placeholder (parent had: ${directApiKey ? "set" : "not set"})`
  );
} else if (directApiKey) {
  console.log("Using direct Anthropic API key");
  // Already set in env
} else {
  console.error(
    "Error: Set ANTHROPIC_BASE_URL or CONVEX_SITE_URL (for proxy) or ANTHROPIC_API_KEY (for direct API)"
  );
  process.exit(1);
}

// Log process.env to verify it's set correctly
console.log("\n=== process.env (after modification, before SDK import) ===");
console.log("process.env.ANTHROPIC_BASE_URL:", process.env.ANTHROPIC_BASE_URL ?? "(not set)");
console.log("process.env.ANTHROPIC_API_KEY:", process.env.ANTHROPIC_API_KEY ? `${process.env.ANTHROPIC_API_KEY.slice(0, 20)}...` : "(not set)");
console.log("");

async function main() {
  // Change to temp directory to prevent SDK from finding project hooks
  const originalCwd = process.cwd();
  process.chdir(claudeConfigDir);
  console.log(`Changed cwd from ${originalCwd} to ${process.cwd()}`);

  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  // Set up environment for spawned subprocesses
  const claudeEnv: Record<string, string> = {};

  // Copy only essential env vars (PATH, etc.) but NOT Anthropic-related ones
  // Use temp dir as HOME to prevent loading ~/.claude/settings.json with hooks
  const essentialVars = ["PATH", "USER", "SHELL", "TERM", "LANG", "NODE_ENV", "BUN_INSTALL"];
  for (const key of essentialVars) {
    if (process.env[key]) {
      claudeEnv[key] = process.env[key];
    }
  }
  // Override HOME to use fake home with empty .claude/settings.json
  if (process.env.HOME) {
    claudeEnv.HOME = process.env.HOME;
  }

  // Copy the Anthropic env vars we setccl
  if (process.env.ANTHROPIC_BASE_URL) {
    claudeEnv.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
  }
  if (process.env.ANTHROPIC_API_KEY) {
    claudeEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.ANTHROPIC_CUSTOM_HEADERS) {
    claudeEnv.ANTHROPIC_CUSTOM_HEADERS = process.env.ANTHROPIC_CUSTOM_HEADERS;
  }
  if (process.env.CLAUDE_CONFIG_DIR) {
    claudeEnv.CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
  }
  if (process.env.CLAUDE_PROJECT_DIR) {
    claudeEnv.CLAUDE_PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR;
  }
  claudeEnv.DEBUG_CLAUDE_AGENT_SDK = "1";

  // Log what we're passing to the SDK
  console.log("=== SDK Environment (claudeEnv for subprocess) ===");
  console.log("ANTHROPIC_BASE_URL:", claudeEnv.ANTHROPIC_BASE_URL ?? "(not set)");
  console.log("ANTHROPIC_API_KEY:", claudeEnv.ANTHROPIC_API_KEY ? `${claudeEnv.ANTHROPIC_API_KEY.slice(0, 20)}...` : "(not set)");
  console.log(
    "ANTHROPIC_CUSTOM_HEADERS:",
    claudeEnv.ANTHROPIC_CUSTOM_HEADERS ? "[set]" : "(not set)"
  );
  console.log("");

  // Define JSON schema for structured output
  const outputSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    additionalProperties: false,
    required: ["greeting", "favoriteNumber", "facts"],
    properties: {
      greeting: { type: "string", description: "A friendly greeting" },
      favoriteNumber: { type: "number", description: "A random number between 1 and 100" },
      facts: {
        type: "array",
        items: { type: "string" },
        description: "Two interesting facts about programming",
        minItems: 2,
        maxItems: 2,
      },
    },
  } as const;

  const prompt = `Respond with a greeting, a random number between 1 and 100, and two interesting facts about programming.`;

  console.log("\nSending query to Claude with structured output...\n");

  try {
    let structuredOutput: unknown = null;

    for await (const message of query({
      prompt,
      options: {
        model: "claude-opus-4-5",
        maxTurns: 1,
        allowDangerouslySkipPermissions: true,
        permissionMode: "bypassPermissions",
        // Empty array = SDK isolation mode, disables loading user/project settings (including hooks)
        settingSources: [],
        // Explicitly override hooks to prevent project hooks from running
        hooks: {},
        // Run from temp dir to avoid picking up project hooks from .claude/settings.json
        cwd: claudeConfigDir,
        env: claudeEnv,
        outputFormat: {
          type: "json_schema",
          schema: outputSchema,
        },
        stderr: (data) => {
          // Log all stderr for debugging
          console.error(`[stderr] ${data}`);
        },
      },
    })) {
      // Log message types for visibility
      if (message.type === "assistant") {
        console.log(`[assistant] Received assistant message`);
      } else if (message.type === "result") {
        console.log(`[result] Received result message`);
        if ("structured_output" in message && message.structured_output) {
          structuredOutput = message.structured_output;
          console.log("\n=== Structured Output ===");
          console.log(JSON.stringify(structuredOutput, null, 2));
        }
        console.log("\n=== Result Summary ===");
        console.log(`  subtype: ${message.subtype}`);
        console.log(`  is_error: ${message.is_error}`);
        const errors = "errors" in message ? message.errors : undefined;
        console.log(`  errors: ${JSON.stringify(errors ?? [])}`);
      } else if (message.type === "system") {
        console.log(`[system] ${message.subtype}`);
      }
    }

    if (structuredOutput) {
      console.log("\n=== Test PASSED: Structured output received ===");
    } else {
      console.log("\n=== Test FAILED: No structured output ===");
      process.exit(1);
    }
  } catch (error) {
    console.error("\nQuery failed:", error);
    process.exit(1);
  } finally {
    if (proxySetup) {
      await proxySetup.close();
    }
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
