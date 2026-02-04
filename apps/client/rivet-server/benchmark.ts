#!/usr/bin/env bun
/**
 * Rivet Chat Benchmark Script
 *
 * Measures Time To First Token (TTFT) and timing for each step in the chat flow.
 *
 * Usage:
 *   bun apps/client/rivet-server/benchmark.ts [--sandbox-url <url>]
 *
 * If no sandbox URL is provided, you'll need to provide one or the script will
 * skip the actual message sending and just test connection setup.
 */

import { createClient } from "rivetkit/client";
import type { registry } from "./registry";

// Parse args
const args = process.argv.slice(2);
const sandboxUrlIndex = args.indexOf("--sandbox-url");
const sandboxUrl = sandboxUrlIndex !== -1 ? args[sandboxUrlIndex + 1] : null;

const RIVET_ENDPOINT = process.env.RIVET_ENDPOINT ?? "http://localhost:6421";
const TEST_MESSAGE = "What is 2 + 2? Reply with just the number.";

interface Timing {
  step: string;
  duration: number;
  timestamp: number;
}

class Timer {
  private startTime: number;
  private lastTime: number;
  private timings: Timing[] = [];

  constructor() {
    this.startTime = performance.now();
    this.lastTime = this.startTime;
  }

  mark(step: string): number {
    const now = performance.now();
    const duration = now - this.lastTime;
    this.timings.push({
      step,
      duration,
      timestamp: now - this.startTime,
    });
    this.lastTime = now;
    return duration;
  }

  total(): number {
    return performance.now() - this.startTime;
  }

  print(): void {
    console.log("\n" + "=".repeat(60));
    console.log("TIMING BREAKDOWN");
    console.log("=".repeat(60));

    const maxStepLen = Math.max(...this.timings.map((t) => t.step.length));

    for (const t of this.timings) {
      const stepPadded = t.step.padEnd(maxStepLen);
      const durationStr = `${t.duration.toFixed(2)}ms`.padStart(10);
      const cumulative = `@ ${t.timestamp.toFixed(0)}ms`;
      console.log(`  ${stepPadded}  ${durationStr}  ${cumulative}`);
    }

    console.log("-".repeat(60));
    console.log(`  ${"TOTAL".padEnd(maxStepLen)}  ${this.total().toFixed(2).padStart(10)}ms`);
    console.log("=".repeat(60) + "\n");
  }
}

async function main() {
  console.log("🚀 Rivet Chat Benchmark");
  console.log(`   Endpoint: ${RIVET_ENDPOINT}`);
  console.log(`   Sandbox:  ${sandboxUrl ?? "(none - will skip message test)"}`);
  console.log(`   Message:  "${TEST_MESSAGE}"`);
  console.log("");

  const timer = new Timer();

  // Step 1: Create client
  const client = createClient<typeof registry>({
    endpoint: RIVET_ENDPOINT,
  });
  timer.mark("Create client");

  // Step 2: Generate IDs
  const visitorId = crypto.randomUUID();
  const chatId = crypto.randomUUID();
  timer.mark("Generate IDs");

  console.log(`   Visitor:  ${visitorId}`);
  console.log(`   Chat:     ${chatId}`);
  console.log("");

  // Step 3: Get actor handle
  const chatHandle = client.aiChat.getOrCreate([visitorId, chatId], {
    params: { visitorId },
  });
  timer.mark("Get actor handle");

  // Step 4: Call getInfo to verify connection (via HTTP, no WS yet)
  const info = await chatHandle.getInfo();
  timer.mark("HTTP getInfo()");
  console.log(`   Initial info: ${JSON.stringify(info)}`);

  if (!sandboxUrl) {
    console.log("\n⚠️  No sandbox URL provided. Skipping message test.");
    console.log("   Run with: --sandbox-url <url>");
    timer.print();
    return;
  }

  // Step 5: Connect to actor via WebSocket for real-time events
  console.log("\n🔌 Establishing WebSocket connection...");
  const conn = chatHandle.connect();

  // Wait for connection to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Connection timeout")), 10000);

    const unsubStatus = conn.onStatusChange((status) => {
      console.log(`   Connection status: ${status}`);
      if (status === "connected") {
        clearTimeout(timeout);
        unsubStatus();
        resolve();
      }
    });

    conn.onError((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
  timer.mark("WebSocket connected");

  // Step 6: Configure with sandbox
  console.log("\n📦 Configuring sandbox...");
  await conn.configure({
    sandboxUrl,
    providerID: "opencode",
    modelID: "trinity-large-preview-free",
  });
  timer.mark("Configure sandbox");
  console.log("   Sandbox configured.");

  // Step 7: Send message and measure TTFT
  console.log("\n💬 Sending message...");
  const sendStart = performance.now();

  let ttft: number | null = null;
  let fullContent = "";

  const messagePromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timeout waiting for message completion (60s)"));
    }, 60000);

    // Subscribe to streaming events
    conn.on("messageStart", () => {
      timer.mark("messageStart event");
      console.log("   Assistant started responding...");
    });

    conn.on("messageStream", (data: { id: string; delta: string; content: string }) => {
      if (ttft === null) {
        ttft = performance.now() - sendStart;
        timer.mark(`TTFT (first token)`);
        console.log(`   ⚡ First token received! TTFT: ${ttft.toFixed(2)}ms`);
      }
      fullContent = data.content ?? "";
    });

    conn.on("messageComplete", (msg: { content: string }) => {
      fullContent = msg.content ?? fullContent;
      timer.mark("messageComplete event");
      clearTimeout(timeout);
      resolve();
    });

    // Send the message
    conn.send(TEST_MESSAGE).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  timer.mark("Send initiated");

  try {
    await messagePromise;
  } finally {
    // Cleanup: dispose the connection
    conn.dispose();
  }

  // Print results
  console.log("\n" + "=".repeat(60));
  console.log("RESULTS");
  console.log("=".repeat(60));
  console.log(`  Response: "${fullContent.slice(0, 100)}${fullContent.length > 100 ? "..." : ""}"`);
  console.log("");

  if (ttft !== null) {
    console.log(`  ⚡ TTFT (Time To First Token): ${(ttft as number).toFixed(2)}ms`);
  } else {
    console.log(`  ⚠️  No streaming tokens received (response may have been instant)`);
  }

  timer.print();
}

main().catch((err) => {
  console.error("❌ Benchmark failed:", err);
  process.exit(1);
});
