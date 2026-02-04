#!/usr/bin/env bun
/**
 * End-to-end benchmark: Time from nothing to getting a response
 * Using sandbox-agent (fastest path based on previous benchmarks)
 */

import Sandbox from "@e2b/code-interpreter";

const E2B_TEMPLATE = "201rhgg6615obmd0v4bu";
const PROMPT = "what's 1+1? return only the answer.";

async function benchAgent(agent: string): Promise<{ total: number; breakdown: Record<string, number> }> {
  const t0 = performance.now();

  // 1. Spawn E2B
  const sb = await Sandbox.create(E2B_TEMPLATE, { timeoutMs: 300000 });
  const url = `https://${sb.getHost(39384)}`;
  const t1 = performance.now();

  try {
    // 2. Wait for health
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) break;
      } catch {}
      await Bun.sleep(500);
    }
    const t2 = performance.now();

    // 3. Create session
    const sessionId = `bench-${agent}-${Date.now()}`;
    await fetch(`${url}/api/agents/v1/sessions/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent }),
    });
    const t3 = performance.now();

    // 4. Send message and get response
    const resp = await fetch(`${url}/api/agents/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: PROMPT }),
    });
    const t4 = performance.now();

    return {
      total: t4 - t0,
      breakdown: {
        spawn: t1 - t0,
        health: t2 - t1,
        session: t3 - t2,
        response: t4 - t3,
      },
    };
  } finally {
    await Sandbox.kill(sb.sandboxId);
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  E2E BENCHMARK: Nothing → Response (sandbox-agent on E2B)");
  console.log("  Prompt: \"what's 1+1? return only the answer.\"");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const agents = ["opencode", "codex", "claude"];
  const results: Record<string, { total: number; breakdown: Record<string, number> }> = {};

  for (const agent of agents) {
    console.log(`Testing ${agent}...`);
    try {
      const r = await benchAgent(agent);
      results[agent] = r;
      console.log(`  ✓ Total: ${(r.total / 1000).toFixed(2)}s`);
      console.log(`    Spawn: ${r.breakdown.spawn.toFixed(0)}ms | Health: ${r.breakdown.health.toFixed(0)}ms | Session: ${r.breakdown.session.toFixed(0)}ms | Response: ${r.breakdown.response.toFixed(0)}ms\n`);
    } catch (e: any) {
      console.log(`  ✗ Error: ${e.message}\n`);
    }
  }

  // Summary
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("                         RESULTS");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("Agent     │ Total     │ Spawn   │ Health  │ Session │ Response");
  console.log("──────────┼───────────┼─────────┼─────────┼─────────┼─────────");

  const sorted = Object.entries(results).sort((a, b) => a[1].total - b[1].total);
  for (const [agent, r] of sorted) {
    console.log(
      `${agent.padEnd(9)} │ ${(r.total / 1000).toFixed(2).padStart(6)}s   │ ${(r.breakdown.spawn / 1000).toFixed(1).padStart(5)}s  │ ${(r.breakdown.health / 1000).toFixed(1).padStart(5)}s  │ ${(r.breakdown.session / 1000).toFixed(1).padStart(5)}s  │ ${(r.breakdown.response / 1000).toFixed(1).padStart(5)}s`
    );
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`\n🏆 FASTEST: ${sorted[0][0].toUpperCase()} (${(sorted[0][1].total / 1000).toFixed(2)}s total)`);
}

main().catch(console.error);
