#!/usr/bin/env bun
/**
 * E2E Benchmark: Sandbox spawn → Session create → First token
 *
 * Usage:
 *   bun run scripts/benchmark-e2e.ts --provider morph
 *   bun run scripts/benchmark-e2e.ts --provider e2b
 *   bun run scripts/benchmark-e2e.ts --provider both
 */

import Sandbox from "@e2b/code-interpreter";

const MORPH_SNAPSHOT = "snapshot_onoct0y6";
const E2B_TEMPLATE = "oym6vco9zp79w65c7d61";

interface Timings {
  provider: string;
  spawnMs: number;
  healthMs: number;
  sessionCreateMs: number;
  messageSendMs: number;
  totalMs: number;
}

async function spawnMorph(): Promise<{ id: string; url: string; spawnMs: number }> {
  const start = performance.now();

  // Start instance (HTTP is already exposed from snapshot)
  const startProc = Bun.spawn(["uvx", "morphcloud", "instance", "start", MORPH_SNAPSHOT], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const startOutput = await new Response(startProc.stdout).text();
  await startProc.exited;

  const match = startOutput.match(/morphvm_\w+/);
  if (!match) throw new Error("Failed to parse Morph instance ID: " + startOutput);
  const id = match[0];

  const spawnMs = performance.now() - start;
  const url = `https://acp-${id}.http.cloud.morph.so`;

  return { id, url, spawnMs };
}

async function spawnE2B(): Promise<{ id: string; url: string; spawnMs: number }> {
  const start = performance.now();
  const sandbox = await Sandbox.create(E2B_TEMPLATE, { timeoutMs: 300000 });
  const spawnMs = performance.now() - start;

  return {
    id: sandbox.sandboxId,
    url: `https://${sandbox.getHost(39384)}`,
    spawnMs,
  };
}

async function waitForHealth(url: string, timeoutMs = 60000): Promise<number> {
  const start = performance.now();
  const deadline = start + timeoutMs;
  let lastError = "";

  while (performance.now() < deadline) {
    try {
      const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        return performance.now() - start;
      }
      lastError = `HTTP ${resp.status}`;
    } catch (e: any) {
      lastError = e.message || String(e);
    }
    await Bun.sleep(500);
  }
  throw new Error(`Health check timeout after ${timeoutMs}ms: ${lastError}`);
}

async function createSession(url: string, sessionId: string): Promise<number> {
  const start = performance.now();
  const resp = await fetch(`${url}/api/agents/v1/sessions/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: "codex" }),
  });
  if (!resp.ok) throw new Error(`Session create failed: ${resp.status}`);
  return performance.now() - start;
}

async function sendMessage(url: string, sessionId: string): Promise<number> {
  const start = performance.now();
  await fetch(`${url}/api/agents/v1/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "What is 2+2? Reply with just the number." }),
  });
  return performance.now() - start;
}

async function stopMorph(id: string) {
  const proc = Bun.spawn(["uvx", "morphcloud", "instance", "stop", id], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
}

async function stopE2B(id: string) {
  await Sandbox.kill(id);
}

async function benchmarkProvider(provider: "morph" | "e2b"): Promise<Timings> {
  const totalStart = performance.now();
  console.log(`\n=== ${provider.toUpperCase()} ===`);

  // Spawn
  console.log("Spawning sandbox...");
  const spawn = provider === "morph" ? await spawnMorph() : await spawnE2B();
  console.log(`  Spawn: ${spawn.spawnMs.toFixed(0)}ms (${spawn.id})`);

  try {
    // Health
    console.log("Waiting for health...");
    const healthMs = await waitForHealth(spawn.url);
    console.log(`  Health: ${healthMs.toFixed(0)}ms`);

    // Session
    const sessionId = `bench-${Date.now()}`;
    console.log("Creating session...");
    const sessionCreateMs = await createSession(spawn.url, sessionId);
    console.log(`  Session: ${sessionCreateMs.toFixed(0)}ms`);

    // Message
    console.log("Sending message...");
    const messageSendMs = await sendMessage(spawn.url, sessionId);
    console.log(`  Message: ${messageSendMs.toFixed(0)}ms`);

    const totalMs = performance.now() - totalStart;
    console.log(`  TOTAL: ${totalMs.toFixed(0)}ms`);

    return {
      provider,
      spawnMs: spawn.spawnMs,
      healthMs,
      sessionCreateMs,
      messageSendMs,
      totalMs,
    };
  } finally {
    console.log("Stopping sandbox...");
    if (provider === "morph") {
      await stopMorph(spawn.id);
    } else {
      await stopE2B(spawn.id);
    }
  }
}

async function main() {
  const provider = process.argv[2]?.replace("--provider=", "").replace("--provider", "") ||
                   process.argv[3] || "both";

  const results: Timings[] = [];

  if (provider === "morph" || provider === "both") {
    results.push(await benchmarkProvider("morph"));
  }
  if (provider === "e2b" || provider === "both") {
    results.push(await benchmarkProvider("e2b"));
  }

  // Summary table
  console.log("\n=== SUMMARY ===\n");
  console.log("Provider | Spawn    | Health   | Session  | Message  | TOTAL");
  console.log("---------|----------|----------|----------|----------|----------");
  for (const r of results) {
    console.log(
      `${r.provider.padEnd(8)} | ${(r.spawnMs/1000).toFixed(1)}s`.padEnd(11) +
      `| ${(r.healthMs/1000).toFixed(1)}s`.padEnd(11) +
      `| ${r.sessionCreateMs.toFixed(0)}ms`.padEnd(11) +
      `| ${r.messageSendMs.toFixed(0)}ms`.padEnd(11) +
      `| ${(r.totalMs/1000).toFixed(1)}s`
    );
  }
}

main().catch(console.error);
