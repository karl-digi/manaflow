#!/usr/bin/env bun
/**
 * Benchmark each agent (claude, codex, opencode) on E2B and Morph
 * Creates fresh sandbox for each combination
 */

import Sandbox from "@e2b/code-interpreter";

const MORPH_SNAPSHOT = "snapshot_onoct0y6";
const E2B_TEMPLATE = "oym6vco9zp79w65c7d61";
const AGENTS = ["codex", "claude", "opencode"] as const;

interface Result {
  provider: string;
  agent: string;
  spawnMs: number;
  healthMs: number;
  sessionMs: number;
  messageMs: number;
  totalMs: number;
}

async function spawnE2B(): Promise<{ id: string; url: string; spawnMs: number; cleanup: () => Promise<void> }> {
  const start = performance.now();
  const sb = await Sandbox.create(E2B_TEMPLATE, { timeoutMs: 300000 });
  return {
    id: sb.sandboxId,
    url: `https://${sb.getHost(39384)}`,
    spawnMs: performance.now() - start,
    cleanup: () => Sandbox.kill(sb.sandboxId),
  };
}

async function spawnMorph(): Promise<{ id: string; url: string; spawnMs: number; cleanup: () => Promise<void> }> {
  const start = performance.now();
  const proc = Bun.spawn(["uvx", "morphcloud", "instance", "start", MORPH_SNAPSHOT], { stdout: "pipe" });
  const output = await new Response(proc.stdout).text();
  await proc.exited;

  const match = output.match(/morphvm_\w+/);
  if (!match) throw new Error("No instance ID");
  const id = match[0];

  return {
    id,
    url: `https://acp-${id}.http.cloud.morph.so`,
    spawnMs: performance.now() - start,
    cleanup: async () => {
      const stop = Bun.spawn(["uvx", "morphcloud", "instance", "stop", id], { stdout: "ignore", stderr: "ignore" });
      await stop.exited;
    },
  };
}

async function waitHealth(url: string): Promise<number> {
  const start = performance.now();
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return performance.now() - start;
    } catch {}
    await Bun.sleep(500);
  }
  throw new Error("Health timeout");
}

async function benchAgent(provider: "e2b" | "morph", agent: string): Promise<Result> {
  const totalStart = performance.now();

  // Spawn
  const sb = provider === "e2b" ? await spawnE2B() : await spawnMorph();

  try {
    // Health
    const healthMs = await waitHealth(sb.url);

    // Session
    const sessionStart = performance.now();
    const sessionResp = await fetch(`${sb.url}/api/agents/v1/sessions/bench-${agent}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent }),
    });
    if (!sessionResp.ok) {
      const text = await sessionResp.text();
      throw new Error(`Session failed: ${sessionResp.status} ${text}`);
    }
    const sessionMs = performance.now() - sessionStart;

    // Message
    const msgStart = performance.now();
    await fetch(`${sb.url}/api/agents/v1/sessions/bench-${agent}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    const messageMs = performance.now() - msgStart;

    return {
      provider,
      agent,
      spawnMs: sb.spawnMs,
      healthMs,
      sessionMs,
      messageMs,
      totalMs: performance.now() - totalStart,
    };
  } finally {
    await sb.cleanup();
  }
}

async function main() {
  const results: Result[] = [];

  for (const provider of ["e2b", "morph"] as const) {
    for (const agent of AGENTS) {
      console.log(`\n=== ${provider.toUpperCase()} + ${agent} ===`);
      try {
        const r = await benchAgent(provider, agent);
        console.log(`  Spawn:   ${r.spawnMs.toFixed(0)}ms`);
        console.log(`  Health:  ${r.healthMs.toFixed(0)}ms`);
        console.log(`  Session: ${r.sessionMs.toFixed(0)}ms`);
        console.log(`  Message: ${r.messageMs.toFixed(0)}ms`);
        console.log(`  TOTAL:   ${r.totalMs.toFixed(0)}ms`);
        results.push(r);
      } catch (e: any) {
        console.log(`  ERROR: ${e.message}`);
      }
    }
  }

  // Summary table
  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log("Provider | Agent    | Spawn   | Health  | Session | Message | TOTAL");
  console.log("-".repeat(80));
  for (const r of results) {
    console.log(
      `${r.provider.padEnd(8)} | ${r.agent.padEnd(8)} | ` +
      `${(r.spawnMs/1000).toFixed(1)}s`.padStart(7) + " | " +
      `${(r.healthMs/1000).toFixed(1)}s`.padStart(7) + " | " +
      `${r.sessionMs.toFixed(0)}ms`.padStart(7) + " | " +
      `${r.messageMs.toFixed(0)}ms`.padStart(7) + " | " +
      `${(r.totalMs/1000).toFixed(1)}s`.padStart(6)
    );
  }
}

main().catch(console.error);
