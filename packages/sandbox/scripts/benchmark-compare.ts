#!/usr/bin/env bun
/**
 * Compare sandbox-agent vs ACP endpoints for all agents
 */

import Sandbox from "@e2b/code-interpreter";

const E2B_TEMPLATE = "oym6vco9zp79w65c7d61";
const AGENTS = ["codex", "claude-code", "opencode"] as const;

interface Result {
  endpoint: string;
  agent: string;
  sessionMs: number;
  ttftMs: number | null;
  error?: string;
}

async function waitHealth(url: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch {}
    await Bun.sleep(500);
  }
  throw new Error("Health timeout");
}

// sandbox-agent endpoint
async function benchSandboxAgent(url: string, agent: string): Promise<Result> {
  const sessionId = `bench-sa-${agent}-${Date.now()}`;

  // Session create
  const sessionStart = performance.now();
  const sessionResp = await fetch(`${url}/api/agents/v1/sessions/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: agent === "claude-code" ? "claude" : agent }),
  });

  if (!sessionResp.ok) {
    const text = await sessionResp.text();
    return { endpoint: "sandbox-agent", agent, sessionMs: 0, ttftMs: null, error: text.slice(0, 100) };
  }
  const sessionMs = performance.now() - sessionStart;

  // Send message and measure TTFT
  const msgStart = performance.now();
  const msgResp = await fetch(`${url}/api/agents/v1/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "what's 1+1? return only the answer." }),
  });
  const ttftMs = performance.now() - msgStart;

  return { endpoint: "sandbox-agent", agent, sessionMs, ttftMs };
}

// ACP endpoint
async function benchAcp(url: string, agent: string): Promise<Result> {
  const sessionId = `bench-acp-${agent}-${Date.now()}`;

  // Map agent names to provider IDs
  const providerMap: Record<string, string> = {
    "codex": "codex",
    "claude-code": "claude",  // ACP uses "claude" not "claude-code"
    "opencode": "opencode",
  };

  // Configure
  const configResp = await fetch(`${url}/api/acp/configure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sandbox_jwt: "test-jwt",
      callback_url: "http://localhost:3000/callback",
      sandbox_id: "test-sandbox",
    }),
  });

  if (!configResp.ok) {
    return { endpoint: "acp", agent, sessionMs: 0, ttftMs: null, error: "Configure failed" };
  }

  // Init session
  const sessionStart = performance.now();
  const initResp = await fetch(`${url}/api/acp/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversation_id: sessionId,
      session_id: sessionId,
      provider_id: providerMap[agent],
      cwd: "/home/user",
    }),
  });

  if (!initResp.ok) {
    const text = await initResp.text();
    return { endpoint: "acp", agent, sessionMs: 0, ttftMs: null, error: text.slice(0, 100) };
  }
  const sessionMs = performance.now() - sessionStart;

  // Send prompt and measure TTFT
  const msgStart = performance.now();
  const promptResp = await fetch(`${url}/api/acp/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversation_id: sessionId,
      message: "Say hi",
    }),
  });
  const ttftMs = performance.now() - msgStart;

  return { endpoint: "acp", agent, sessionMs, ttftMs };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("        SANDBOX-AGENT vs ACP BENCHMARK (E2B Cold Start)");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  // Spawn E2B
  console.log("Spawning E2B sandbox...");
  const spawnStart = performance.now();
  const sb = await Sandbox.create(E2B_TEMPLATE, { timeoutMs: 300000 });
  const url = `https://${sb.getHost(39384)}`;
  console.log(`  Spawned in ${(performance.now() - spawnStart).toFixed(0)}ms`);
  console.log(`  URL: ${url}\n`);

  try {
    // Wait for health
    console.log("Waiting for health...");
    await waitHealth(url);
    console.log("  Ready!\n");

    const results: Result[] = [];

    // Test each agent with both endpoints
    for (const agent of AGENTS) {
      console.log(`--- ${agent} ---`);

      // sandbox-agent
      console.log("  sandbox-agent:");
      const saResult = await benchSandboxAgent(url, agent);
      if (saResult.error) {
        console.log(`    ERROR: ${saResult.error}`);
      } else {
        console.log(`    Session: ${saResult.sessionMs.toFixed(0)}ms, TTFT: ${saResult.ttftMs?.toFixed(0)}ms`);
      }
      results.push(saResult);

      // ACP
      console.log("  acp:");
      const acpResult = await benchAcp(url, agent);
      if (acpResult.error) {
        console.log(`    ERROR: ${acpResult.error}`);
      } else {
        console.log(`    Session: ${acpResult.sessionMs.toFixed(0)}ms, TTFT: ${acpResult.ttftMs?.toFixed(0)}ms`);
      }
      results.push(acpResult);

      console.log();
    }

    // Summary
    console.log("═══════════════════════════════════════════════════════════════════════════════");
    console.log("                              SUMMARY");
    console.log("═══════════════════════════════════════════════════════════════════════════════");
    console.log("Agent        │ Endpoint       │ Session Create │ TTFT");
    console.log("─────────────┼────────────────┼────────────────┼─────────────");

    for (const r of results) {
      if (r.error) {
        console.log(`${r.agent.padEnd(12)} │ ${r.endpoint.padEnd(14)} │ ${"ERROR".padStart(14)} │ -`);
      } else {
        console.log(
          `${r.agent.padEnd(12)} │ ${r.endpoint.padEnd(14)} │ ${(r.sessionMs.toFixed(0) + "ms").padStart(14)} │ ${(r.ttftMs?.toFixed(0) + "ms").padStart(10)}`
        );
      }
    }
    console.log("═══════════════════════════════════════════════════════════════════════════════");

  } finally {
    console.log("\nCleaning up...");
    await Sandbox.kill(sb.sandboxId);
  }
}

main().catch(console.error);
