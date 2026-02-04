#!/usr/bin/env bun
/**
 * Simple E2E Benchmark: Sandbox spawn → Session create → Message send
 */

import Sandbox from "@e2b/code-interpreter";

const MORPH_SNAPSHOT = "snapshot_onoct0y6";
const E2B_TEMPLATE = "oym6vco9zp79w65c7d61";

async function benchE2B() {
  console.log("\n=== E2B ===");
  const total = performance.now();

  // Spawn
  const spawnStart = performance.now();
  const sb = await Sandbox.create(E2B_TEMPLATE, { timeoutMs: 300000 });
  const spawnMs = performance.now() - spawnStart;
  const url = `https://${sb.getHost(39384)}`;
  console.log(`Spawn: ${spawnMs.toFixed(0)}ms (${sb.sandboxId})`);

  // Health
  const healthStart = performance.now();
  await fetch(`${url}/health`);
  console.log(`Health: ${(performance.now() - healthStart).toFixed(0)}ms`);

  // Session
  const sessionStart = performance.now();
  await fetch(`${url}/api/agents/v1/sessions/bench`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: "codex" }),
  });
  console.log(`Session: ${(performance.now() - sessionStart).toFixed(0)}ms`);

  // Message
  const msgStart = performance.now();
  await fetch(`${url}/api/agents/v1/sessions/bench/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hi" }),
  });
  console.log(`Message: ${(performance.now() - msgStart).toFixed(0)}ms`);

  console.log(`TOTAL: ${(performance.now() - total).toFixed(0)}ms`);

  await Sandbox.kill(sb.sandboxId);
  return {
    provider: "e2b",
    spawnMs,
    total: performance.now() - total,
  };
}

async function benchMorph() {
  console.log("\n=== MORPH ===");
  const total = performance.now();

  // Spawn
  const spawnStart = performance.now();
  const proc = Bun.spawn(["uvx", "morphcloud", "instance", "start", MORPH_SNAPSHOT], {
    stdout: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  const spawnMs = performance.now() - spawnStart;

  const match = output.match(/morphvm_\w+/);
  if (!match) throw new Error("No instance ID");
  const id = match[0];
  const url = `https://acp-${id}.http.cloud.morph.so`;
  console.log(`Spawn: ${spawnMs.toFixed(0)}ms (${id})`);

  // Health (with retries)
  const healthStart = performance.now();
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) break;
    } catch {}
    await Bun.sleep(500);
  }
  console.log(`Health: ${(performance.now() - healthStart).toFixed(0)}ms`);

  // Session
  const sessionStart = performance.now();
  await fetch(`${url}/api/agents/v1/sessions/bench`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: "codex" }),
  });
  console.log(`Session: ${(performance.now() - sessionStart).toFixed(0)}ms`);

  // Message
  const msgStart = performance.now();
  await fetch(`${url}/api/agents/v1/sessions/bench/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hi" }),
  });
  console.log(`Message: ${(performance.now() - msgStart).toFixed(0)}ms`);

  console.log(`TOTAL: ${(performance.now() - total).toFixed(0)}ms`);

  // Cleanup
  const stop = Bun.spawn(["uvx", "morphcloud", "instance", "stop", id], { stdout: "ignore" });
  await stop.exited;

  return {
    provider: "morph",
    spawnMs,
    total: performance.now() - total,
  };
}

async function main() {
  const arg = process.argv[2] || "both";

  const results = [];
  if (arg === "e2b" || arg === "both") {
    results.push(await benchE2B());
  }
  if (arg === "morph" || arg === "both") {
    results.push(await benchMorph());
  }

  console.log("\n=== SUMMARY ===");
  for (const r of results) {
    console.log(`${r.provider}: spawn=${(r.spawnMs/1000).toFixed(1)}s, total=${(r.total/1000).toFixed(1)}s`);
  }
}

main().catch(console.error);
