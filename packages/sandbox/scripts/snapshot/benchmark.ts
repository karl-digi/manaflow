#!/usr/bin/env bun
/**
 * Benchmark script for sandbox startup time across providers.
 *
 * Measures the time from spawn request to health check passing.
 *
 * Usage:
 *   bun run scripts/snapshot/benchmark.ts                    # All providers
 *   bun run scripts/snapshot/benchmark.ts --provider morph   # Single provider
 *   bun run scripts/snapshot/benchmark.ts --runs 5           # Custom run count
 *
 * Environment:
 *   MORPH_API_KEY      - Required for Morph provider
 *   FREESTYLE_API_KEY  - Required for Freestyle provider
 *   DAYTONA_API_KEY    - Required for Daytona provider
 *   E2B_API_KEY        - Required for E2B provider
 *   BLAXEL_API_KEY     - Required for Blaxel provider
 */

import { parseArgs } from "node:util";
import {
  loadManifest,
  printHeader,
  type ProviderName,
} from "./utils";
import { getProvider } from "./providers";
import { PROVIDER_CAPABILITIES } from "./builders";

/**
 * Result of a single benchmark run.
 */
interface RunResult {
  startupMs: number;
  url: string;
}

/**
 * Aggregated benchmark results for a provider.
 */
interface BenchmarkResult {
  provider: ProviderName;
  strategy: string;
  snapshotId: string;
  runs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  sampleUrl: string;
}

/**
 * Fetch with timeout helper.
 */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Wait for the health endpoint to return OK.
 */
async function waitForHealth(
  url: string,
  maxWaitMs: number = 60000
): Promise<number> {
  const healthUrl = `${url}/health`;
  const start = performance.now();
  const checkIntervalMs = 500;

  while (performance.now() - start < maxWaitMs) {
    try {
      const response = await fetchWithTimeout(healthUrl, 5000);
      const body = await response.text();
      if (response.ok && body.includes('"status":"ok"')) {
        return performance.now() - start;
      }
    } catch {
      // Keep trying
    }
    await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
  }

  throw new Error(`Health check timeout after ${maxWaitMs}ms for ${healthUrl}`);
}

/**
 * Run a single benchmark iteration for a provider.
 */
async function runSingleBenchmark(
  providerName: ProviderName,
  snapshotId: string
): Promise<RunResult> {
  const provider = getProvider(providerName);

  // Spawn sandbox
  const spawnStart = performance.now();
  const { vmId, vm } = await provider.createVm(snapshotId);

  // Get the public URL
  let url: string;
  if (vm.exposeHttp) {
    const exposed = await vm.exposeHttp("acp", 39384);
    url = exposed.url;
  } else {
    // For providers without exposeHttp, construct URL based on vmId
    // This is provider-specific
    url = `https://${vmId}:39384`;
  }

  // Wait for health check to pass
  const healthWaitMs = await waitForHealth(url);
  const totalStartupMs = performance.now() - spawnStart;

  // Clean up
  await provider.deleteVm(vmId);

  return {
    startupMs: totalStartupMs,
    url,
  };
}

/**
 * Calculate percentile from sorted array.
 */
function percentile(sorted: number[], p: number): number {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Run benchmark for a single provider.
 */
async function benchmarkProvider(
  providerName: ProviderName,
  snapshotId: string,
  runs: number,
  verbose: boolean
): Promise<BenchmarkResult> {
  const capabilities = PROVIDER_CAPABILITIES[providerName];
  const times: number[] = [];
  let sampleUrl = "";

  console.log(`\n[${providerName}] Starting ${runs} benchmark runs...`);
  console.log(`  Snapshot: ${snapshotId}`);
  console.log(`  Strategy: ${capabilities.strategy}`);

  for (let i = 0; i < runs; i++) {
    try {
      const result = await runSingleBenchmark(providerName, snapshotId);
      times.push(result.startupMs);
      if (!sampleUrl) sampleUrl = result.url;

      if (verbose) {
        console.log(`  Run ${i + 1}/${runs}: ${result.startupMs.toFixed(0)}ms - ${result.url}`);
      } else {
        process.stdout.write(`  Run ${i + 1}/${runs}: ${result.startupMs.toFixed(0)}ms\n`);
      }
    } catch (error) {
      console.error(`  Run ${i + 1}/${runs}: FAILED -`, error instanceof Error ? error.message : error);
    }
  }

  if (times.length === 0) {
    throw new Error(`All benchmark runs failed for ${providerName}`);
  }

  // Calculate statistics
  const sorted = [...times].sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);

  return {
    provider: providerName,
    strategy: capabilities.strategy,
    snapshotId,
    runs: times.length,
    avgMs: sum / times.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    sampleUrl,
  };
}

async function main() {
  // Parse arguments
  const { values } = parseArgs({
    options: {
      provider: { type: "string", short: "p" },
      runs: { type: "string", short: "r" },
      verbose: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`
Sandbox Startup Time Benchmark

Usage:
  bun run scripts/snapshot/benchmark.ts [options]

Options:
  --provider, -p <name>   Provider to benchmark: morph, freestyle, daytona, e2b, blaxel, or all
  --runs, -r <count>      Number of benchmark runs per provider (default: 5)
  --verbose, -v           Show verbose output
  --help, -h              Show this help message

Examples:
  bun run scripts/snapshot/benchmark.ts
  bun run scripts/snapshot/benchmark.ts --provider morph --runs 10
  bun run scripts/snapshot/benchmark.ts --provider e2b --verbose
`);
    process.exit(0);
  }

  const verbose = values.verbose ?? false;
  const runs = parseInt(values.runs ?? "5", 10);

  // Determine providers to benchmark
  const providerArg = values.provider?.toLowerCase();
  let providers: ProviderName[];

  if (providerArg === "all" || !providerArg) {
    providers = ["morph", "freestyle", "daytona", "e2b", "blaxel"];
  } else if (["morph", "freestyle", "daytona", "e2b", "blaxel"].includes(providerArg)) {
    providers = [providerArg as ProviderName];
  } else {
    console.error(`Invalid provider: ${providerArg}`);
    process.exit(1);
  }

  // Load manifest to get snapshot IDs
  const manifest = loadManifest();

  // Filter to available providers
  const availableProviders: Array<{ name: ProviderName; snapshotId: string }> = [];
  for (const p of providers) {
    // Check API key
    const hasApiKey =
      (p === "morph" && process.env.MORPH_API_KEY) ||
      (p === "freestyle" && process.env.FREESTYLE_API_KEY) ||
      (p === "daytona" && process.env.DAYTONA_API_KEY) ||
      (p === "e2b" && process.env.E2B_API_KEY) ||
      (p === "blaxel" && (process.env.BLAXEL_API_KEY || process.env.BL_API_KEY));

    if (!hasApiKey) {
      console.warn(`Warning: No API key for ${p}, skipping`);
      continue;
    }

    // Check snapshot exists
    const snapshotId = manifest.providers[p]?.presets?.standard?.snapshotId;
    if (!snapshotId) {
      console.warn(`Warning: No snapshot found for ${p}, skipping`);
      continue;
    }

    availableProviders.push({ name: p, snapshotId });
  }

  if (availableProviders.length === 0) {
    console.error("Error: No providers available for benchmarking");
    process.exit(1);
  }

  // Print configuration
  printHeader("Sandbox Startup Time Benchmark");
  console.log(`Providers: ${availableProviders.map((p) => p.name).join(", ")}`);
  console.log(`Runs per provider: ${runs}`);
  console.log("");

  // Run benchmarks
  const results: BenchmarkResult[] = [];

  for (const { name, snapshotId } of availableProviders) {
    try {
      const result = await benchmarkProvider(name, snapshotId, runs, verbose);
      results.push(result);
    } catch (error) {
      console.error(`\nFailed to benchmark ${name}:`, error);
    }
  }

  // Print results
  printHeader("Benchmark Results");

  if (results.length === 0) {
    console.log("No results collected.");
    return;
  }

  // Sort by average startup time
  results.sort((a, b) => a.avgMs - b.avgMs);

  // Print table header
  console.log(
    "| Provider   | Strategy   | Avg (ms) | Min (ms) | Max (ms) | P50 (ms) | P95 (ms) | Runs |"
  );
  console.log(
    "|------------|------------|----------|----------|----------|----------|----------|------|"
  );

  for (const r of results) {
    console.log(
      `| ${r.provider.padEnd(10)} | ${r.strategy.padEnd(10)} | ${r.avgMs.toFixed(0).padStart(8)} | ${r.minMs.toFixed(0).padStart(8)} | ${r.maxMs.toFixed(0).padStart(8)} | ${r.p50Ms.toFixed(0).padStart(8)} | ${r.p95Ms.toFixed(0).padStart(8)} | ${String(r.runs).padStart(4)} |`
    );
  }

  console.log("");
  console.log("Sample URLs:");
  for (const r of results) {
    console.log(`  ${r.provider}: ${r.sampleUrl}`);
  }

  // Summary
  console.log("");
  console.log("Strategy comparison:");
  const runtimeResults = results.filter((r) => r.strategy === "runtime");
  const dockerfileResults = results.filter((r) => r.strategy === "dockerfile");

  if (runtimeResults.length > 0) {
    const avgRuntime = runtimeResults.reduce((a, b) => a + b.avgMs, 0) / runtimeResults.length;
    console.log(`  Runtime (RAM snapshot): ${avgRuntime.toFixed(0)}ms avg`);
  }
  if (dockerfileResults.length > 0) {
    const avgDockerfile = dockerfileResults.reduce((a, b) => a + b.avgMs, 0) / dockerfileResults.length;
    console.log(`  Dockerfile (image build): ${avgDockerfile.toFixed(0)}ms avg`);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
