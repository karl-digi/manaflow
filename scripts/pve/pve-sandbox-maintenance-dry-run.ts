#!/usr/bin/env bun

/**
 * Dry-run PVE sandbox maintenance (pause/stop/orphan cleanup).
 *
 * Examples:
 *   bun scripts/pve/pve-sandbox-maintenance-dry-run.ts --env-file .env
 *   bun scripts/pve/pve-sandbox-maintenance-dry-run.ts --env-file .env.production
 *   bun scripts/pve/pve-sandbox-maintenance-dry-run.ts --env-file .env.production --mode stop
 *   bun scripts/pve/pve-sandbox-maintenance-dry-run.ts --env-file .env --ignore-production-gate
 *
 * Notes:
 * - Uses CONVEX_DEPLOY_KEY from the env file to read sandboxInstanceActivity via `bunx convex data`.
 * - If CONVEX_DEPLOY_KEY is missing or the fetch fails, activity is treated as empty.
 * - Mirrors the same filters used by the Convex maintenance cron:
 *   name starts with "cmux-", template != 1, vmid < 9000.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import dotenv from "dotenv";

type Mode = "all" | "pause" | "stop" | "cleanup";

type Options = {
  envFile: string;
  mode: Mode;
  ignoreProductionGate: boolean;
  verbose: boolean;
};

type PveContainer = {
  vmid: number;
  status: string;
  name?: string;
  template?: number;
};

type ActivityRecord = {
  instanceId: string;
  createdAt?: number;
  lastPausedAt?: number;
  lastResumedAt?: number;
  stoppedAt?: number;
};

type ProviderInstance = {
  id: string;
  vmid: number;
  name?: string;
  status: string;
  rawStatus: string;
  created: number;
};

type ActivityInfo = {
  timestamp?: number;
  source: "lastResumedAt" | "lastPausedAt" | "createdAt" | "instanceCreatedAt" | "unknown";
};

const PAUSE_HOURS_THRESHOLD = 20;
const STOP_DAYS_THRESHOLD = 7;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

function parseArgs(argv: string[]): Options {
  const options: Options = {
    envFile: ".env",
    mode: "all",
    ignoreProductionGate: false,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--env-file") {
      options.envFile = argv[i + 1] ?? options.envFile;
      i += 1;
    } else if (arg.startsWith("--env-file=")) {
      options.envFile = arg.split("=", 2)[1] ?? options.envFile;
    } else if (arg === "--mode") {
      options.mode = parseMode(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith("--mode=")) {
      options.mode = parseMode(arg.split("=", 2)[1]);
    } else if (arg === "--ignore-production-gate") {
      options.ignoreProductionGate = true;
    } else if (arg === "--verbose") {
      options.verbose = true;
    }
  }

  return options;
}

function parseMode(value: string | undefined): Mode {
  if (!value) return "all";
  const normalized = value.toLowerCase();
  if (normalized === "pause" || normalized === "stop" || normalized === "cleanup" || normalized === "all") {
    return normalized;
  }
  console.error(`Invalid mode: ${value}`);
  printHelp();
  process.exit(1);
}

function printHelp(): void {
  console.log("Dry-run PVE sandbox maintenance (pause/stop/orphan cleanup)");
  console.log("");
  console.log("Usage:");
  console.log("  bun scripts/pve/pve-sandbox-maintenance-dry-run.ts [options]");
  console.log("");
  console.log("Options:");
  console.log("  --env-file <path>         Env file to load (default: .env)");
  console.log("  --mode <all|pause|stop|cleanup>");
  console.log("  --ignore-production-gate  Compute pause/stop even if CONVEX_IS_PRODUCTION is empty");
  console.log("  --verbose                 Print excluded containers and activity details");
}

async function pveApiRequest<T>(
  apiUrl: string,
  apiToken: string,
  method: string,
  path: string
): Promise<T> {
  const url = `${apiUrl}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `PVEAPIToken=${apiToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PVE API error ${response.status}: ${text}`);
  }

  const json = (await response.json()) as { data: T };
  return json.data;
}

async function resolvePveNode(
  apiUrl: string,
  apiToken: string,
  configuredNode?: string
): Promise<string> {
  if (configuredNode) return configuredNode;
  const nodes = await pveApiRequest<Array<{ node: string }>>(
    apiUrl,
    apiToken,
    "GET",
    "/api2/json/nodes"
  );
  if (!nodes.length) {
    throw new Error("No PVE nodes found");
  }
  return nodes[0].node;
}

function loadEnvFile(envFile: string): void {
  const resolved = resolve(envFile);
  const result = dotenv.config({ path: resolved, override: true });
  if (result.error) {
    console.error(`Failed to load env file: ${resolved}`);
    throw result.error;
  }
}

function formatDuration(ms: number): string {
  const clamped = Math.max(ms, 0);
  const totalMinutes = Math.floor(clamped / (60 * 1000));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h`;
  const totalDays = Math.floor(totalHours / 24);
  return `${totalDays}d`;
}

function formatTimestamp(ts?: number): string {
  if (!ts) return "unknown";
  return new Date(ts).toISOString();
}

function fetchSandboxInstanceActivity(): ActivityRecord[] {
  const deployKey = process.env.CONVEX_DEPLOY_KEY;
  if (!deployKey || deployKey.trim() === "") {
    console.warn("CONVEX_DEPLOY_KEY missing; treating activity table as empty.");
    return [];
  }

  const tmpFile = join(
    tmpdir(),
    `convex-sandboxInstanceActivity-${Date.now()}.json`
  );

  try {
    const command = `bunx convex data sandboxInstanceActivity --format json --limit 10000 > "${tmpFile}"`;
    execSync(command, {
      encoding: "utf-8",
      shell: "/bin/bash",
      stdio: "ignore",
      env: {
        ...process.env,
        CONVEX_DEPLOY_KEY: deployKey,
      },
    });
    const raw = readFileSync(tmpFile, "utf-8");
    return JSON.parse(raw) as ActivityRecord[];
  } catch (error) {
    console.warn(
      "Failed to fetch sandboxInstanceActivity via convex data; treating as empty."
    );
    return [];
  } finally {
    if (existsSync(tmpFile)) {
      try {
        unlinkSync(tmpFile);
      } catch {
        // ignore
      }
    }
  }
}

function getLastActivityInfo(
  activity: ActivityRecord | undefined,
  instance: ProviderInstance
): ActivityInfo {
  if (activity?.lastResumedAt) {
    return { timestamp: activity.lastResumedAt, source: "lastResumedAt" };
  }
  if (activity?.lastPausedAt) {
    return { timestamp: activity.lastPausedAt, source: "lastPausedAt" };
  }
  if (activity?.createdAt) {
    return { timestamp: activity.createdAt, source: "createdAt" };
  }
  if (instance.created > 0) {
    return { timestamp: instance.created * 1000, source: "instanceCreatedAt" };
  }
  return { source: "unknown" };
}

function printCandidateList(
  title: string,
  items: Array<{
    instance: ProviderInstance;
    note?: string;
    activity?: ActivityRecord;
    lastActivity?: ActivityInfo;
    inactiveMs?: number;
  }>
): void {
  console.log(`${title}: ${items.length}`);
  for (const item of items) {
    const inst = item.instance;
    const parts = [
      `${inst.id} (vmid=${inst.vmid}, status=${inst.status}, name=${inst.name ?? "unknown"})`,
    ];

    if (item.activity?.createdAt) {
      parts.push(`createdAt=${formatTimestamp(item.activity.createdAt)}`);
    } else {
      parts.push("createdAt=missing");
    }

    if (item.lastActivity) {
      const lastTime = item.lastActivity.timestamp
        ? formatTimestamp(item.lastActivity.timestamp)
        : "unknown";
      parts.push(`lastActivity=${lastTime} (${item.lastActivity.source})`);
    }

    if (item.inactiveMs !== undefined) {
      parts.push(`inactive=${formatDuration(item.inactiveMs)}`);
    }

    if (item.note) {
      parts.push(`note=${item.note}`);
    }

    console.log(`  - ${parts.join(" | ")}`);
  }
  console.log("");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  loadEnvFile(options.envFile);

  const apiUrl = process.env.PVE_API_URL;
  const apiToken = process.env.PVE_API_TOKEN;
  const pveNode = process.env.PVE_NODE;
  const verifyTls = process.env.PVE_VERIFY_TLS;
  const isProductionGate = !!process.env.CONVEX_IS_PRODUCTION;

  if (!apiUrl || !apiToken) {
    console.error("Missing PVE_API_URL or PVE_API_TOKEN in env file.");
    process.exit(1);
  }

  if (!verifyTls || verifyTls === "false") {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  const node = await resolvePveNode(apiUrl, apiToken, pveNode);
  const containers = await pveApiRequest<PveContainer[]>(
    apiUrl,
    apiToken,
    "GET",
    `/api2/json/nodes/${node}/lxc`
  );

  const managedContainers = containers.filter(
    (c) => c.name?.startsWith("cmux-") || c.name?.startsWith("pvelxc-")
  );
  const excludedTemplates = managedContainers.filter((c) => c.template === 1);
  const excludedVmidRange = managedContainers.filter((c) => c.vmid >= 9000);
  const included = managedContainers
    .filter((c) => c.template !== 1)
    .filter((c) => c.vmid < 9000);

  const instances: ProviderInstance[] = included.map((c) => ({
    id: c.name ?? "",
    vmid: c.vmid,
    name: c.name,
    status: c.status === "running" ? "ready" : c.status,
    rawStatus: c.status,
    created: 0,
  }));

  const activities = fetchSandboxInstanceActivity();
  const activityMap = new Map(
    activities.map((activity) => [activity.instanceId, activity])
  );

  console.log("Sandbox maintenance dry-run (pve-lxc)");
  console.log(`Env file: ${resolve(options.envFile)}`);
  console.log(`CONVEX_IS_PRODUCTION: ${process.env.CONVEX_IS_PRODUCTION ?? "unset"}`);
  console.log(`Production gate active: ${isProductionGate ? "yes" : "no"}`);
  console.log(`PVE node: ${node}`);
  console.log("");
  console.log(`Total LXC containers: ${containers.length}`);
  console.log(`cmux-/pvelxc- containers: ${managedContainers.length}`);
  console.log(`Excluded templates: ${excludedTemplates.length}`);
  console.log(`Excluded VMID >= 9000: ${excludedVmidRange.length}`);
  console.log(`Included for maintenance: ${instances.length}`);
  console.log("");

  if (options.verbose) {
    if (excludedTemplates.length > 0) {
      console.log("Excluded templates:");
      for (const c of excludedTemplates) {
        console.log(`  - vmid=${c.vmid} name=${c.name ?? "unknown"} status=${c.status}`);
      }
      console.log("");
    }
    if (excludedVmidRange.length > 0) {
      console.log("Excluded VMID >= 9000:");
      for (const c of excludedVmidRange) {
        console.log(`  - vmid=${c.vmid} name=${c.name ?? "unknown"} status=${c.status}`);
      }
      console.log("");
    }
  }

  const now = Date.now();
  const pauseThresholdMs = PAUSE_HOURS_THRESHOLD * MILLISECONDS_PER_HOUR;
  const stopThresholdMs = STOP_DAYS_THRESHOLD * 24 * MILLISECONDS_PER_HOUR;

  const shouldRunPauseStop =
    options.ignoreProductionGate || isProductionGate;

  if (options.mode === "all" || options.mode === "pause") {
    if (!shouldRunPauseStop) {
      console.log("Pause candidates: skipped (CONVEX_IS_PRODUCTION is empty)");
      console.log("");
    } else {
      const pauseCandidates: Array<{
        instance: ProviderInstance;
        activity?: ActivityRecord;
        note?: string;
      }> = [];

      const staleInstances = instances
        .filter((inst) => inst.status === "ready" || inst.status === "running")
        .filter((inst) => {
          if (inst.created > 0) {
            return now - inst.created * 1000 > pauseThresholdMs;
          }
          return true;
        });

      for (const inst of staleInstances) {
        const activity = activityMap.get(inst.id);
        const createdAt = activity?.createdAt;
        if (!createdAt || now - createdAt > pauseThresholdMs) {
          pauseCandidates.push({
            instance: inst,
            activity,
            note: createdAt ? undefined : "missing activity record",
          });
        }
      }

      printCandidateList(
        `Pause candidates (> ${PAUSE_HOURS_THRESHOLD}h)`,
        pauseCandidates.map((entry) => ({
          instance: entry.instance,
          activity: entry.activity,
          note: entry.note,
        }))
      );
    }
  }

  if (options.mode === "all" || options.mode === "stop") {
    if (!shouldRunPauseStop) {
      console.log("Stop candidates: skipped (CONVEX_IS_PRODUCTION is empty)");
      console.log("");
    } else {
      const stopCandidates: Array<{
        instance: ProviderInstance;
        activity?: ActivityRecord;
        lastActivity: ActivityInfo;
        inactiveMs: number;
        note?: string;
      }> = [];

      const pausedInstances = instances.filter(
        (inst) => inst.status === "paused" || inst.status === "stopped"
      );

      for (const inst of pausedInstances) {
        const activity = activityMap.get(inst.id);
        if (activity?.stoppedAt) {
          continue;
        }
        const lastActivity = getLastActivityInfo(activity, inst);
        const lastActivityAt = lastActivity.timestamp ?? 0;
        const inactiveMs = now - lastActivityAt;
        if (inactiveMs >= stopThresholdMs) {
          stopCandidates.push({
            instance: inst,
            activity,
            lastActivity,
            inactiveMs,
            note: lastActivity.source === "unknown" ? "missing activity record" : undefined,
          });
        }
      }

      printCandidateList(
        `Stop candidates (> ${STOP_DAYS_THRESHOLD}d inactive)`,
        stopCandidates.map((entry) => ({
          instance: entry.instance,
          activity: entry.activity,
          lastActivity: entry.lastActivity,
          inactiveMs: entry.inactiveMs,
          note: entry.note,
        }))
      );
    }
  }

  if (options.mode === "all" || options.mode === "cleanup") {
    const orphanCandidates: Array<{
      instance: ProviderInstance;
      activity?: ActivityRecord;
      note?: string;
    }> = [];

    for (const inst of instances) {
      const activity = activityMap.get(inst.id);
      if (activity) continue;
      if (inst.status === "ready" || inst.status === "running") {
        continue;
      }
      orphanCandidates.push({
        instance: inst,
        activity: undefined,
        note: "no activity record",
      });
    }

    printCandidateList("Orphan cleanup candidates", orphanCandidates);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
