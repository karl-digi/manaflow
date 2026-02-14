#!/usr/bin/env bun

/**
 * Cleanup old PVE LXC snapshot versions from manifest and delete corresponding templates.
 *
 * Cleans up two types of snapshots:
 * 1. Normal preset versions (VMID >= 9000) - stored in pve-lxc-snapshots.json
 * 2. Custom environment versions (VMID 200-8999) - stored in Convex environmentSnapshotVersions
 *
 * Dry-run by default. Use --execute to apply changes.
 *
 * Usage:
 *   bun scripts/pve/pve-lxc-snapshot-cleanup.ts
 *   bun scripts/pve/pve-lxc-snapshot-cleanup.ts --keep 5 --verbose
 *   bun scripts/pve/pve-lxc-snapshot-cleanup.ts --env-file .env.production --execute
 *   bun scripts/pve/pve-lxc-snapshot-cleanup.ts --presets-only
 *   bun scripts/pve/pve-lxc-snapshot-cleanup.ts --custom-only
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import {
  pveLxcTemplateManifestSchema,
  type PveLxcTemplateManifest,
} from "@cmux/shared/pve-lxc-snapshots";

type Options = {
  envFile: string;
  keep: number;
  execute: boolean;
  verbose: boolean;
  presetsOnly: boolean;
  customOnly: boolean;
};

type VersionToDelete = {
  presetId: string;
  presetLabel: string;
  version: number;
  snapshotId: string;
  templateVmid: number;
  capturedAt: string;
};

type PresetPlan = {
  presetId: string;
  presetLabel: string;
  totalVersions: number;
  keptVersions: number[];
  protectedVersions: number[];
  deletedVersions: number[];
};

type CleanupPlan = {
  presetPlans: PresetPlan[];
  versionsToDelete: VersionToDelete[];
  protectedVersions: VersionToDelete[];
  vmidsReferencedByDeletedVersions: number[];
  vmidsRetainedByRemainingReference: number[];
  vmidsToDelete: number[];
  vmidsMissingOnPve: number[];
};

type ExecuteResult = {
  deletedVmids: number[];
  failedDeletes: Array<{ vmid: number; error: string }>;
  removedVersionCount: number;
};

type PveContainer = {
  vmid: number;
  template?: number;
  name?: string;
};

type PveTaskStatus = {
  status?: string;
  exitstatus?: string;
};

type CustomEnvVersion = {
  _id: string;
  environmentId: string;
  teamId: string;
  version: number;
  templateVmid?: number;
  snapshotProvider?: string;
  createdAt: number;
  label?: string;
};

type CustomEnvVersionToDelete = {
  convexDocId: string;
  environmentId: string;
  version: number;
  templateVmid: number;
  createdAt: number;
};

type CustomEnvPlan = {
  environmentId: string;
  totalVersions: number;
  keptVersions: number[];
  deletedVersions: number[];
};

type CustomEnvCleanupPlan = {
  envPlans: CustomEnvPlan[];
  versionsToDelete: CustomEnvVersionToDelete[];
  vmidsToDelete: number[];
  vmidsMissingOnPve: number[];
  // Orphan templates: exist on PVE but not tracked in Convex
  orphanVmids: number[];
  orphanTemplates: Array<{ vmid: number; hostname: string }>;
};

const WORKSPACE_ROOT = resolve(import.meta.dir, "../..");
const CONVEX_ROOT = resolve(WORKSPACE_ROOT, "packages/convex");
const MANIFEST_PATH = resolve(
  WORKSPACE_ROOT,
  "packages/shared/src/pve-lxc-snapshots.json",
);
const DEFAULT_ENV_FILE = ".env.production";
const DEFAULT_KEEP = 3;
const CONVEX_QUERY_LIMIT = 10000;
const PVE_TEMPLATE_MIN_VMID = 9000;

function parseArgs(argv: string[]): Options {
  const options: Options = {
    envFile: DEFAULT_ENV_FILE,
    keep: DEFAULT_KEEP,
    execute: false,
    verbose: false,
    presetsOnly: false,
    customOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--env-file") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--env-file requires a value");
      }
      options.envFile = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--env-file=")) {
      options.envFile = arg.split("=", 2)[1] ?? options.envFile;
      continue;
    }

    if (arg === "--keep") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--keep requires a value");
      }
      options.keep = parseKeepValue(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--keep=")) {
      options.keep = parseKeepValue(arg.split("=", 2)[1]);
      continue;
    }

    if (arg === "--execute") {
      options.execute = true;
      continue;
    }

    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }

    if (arg === "--presets-only") {
      options.presetsOnly = true;
      continue;
    }

    if (arg === "--custom-only") {
      options.customOnly = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parseKeepValue(value: string | undefined): number {
  if (!value) {
    throw new Error("--keep requires a numeric value");
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--keep must be an integer >= 1");
  }

  return parsed;
}

function printHelp(): void {
  console.log("PVE-LXC Snapshot Cleanup");
  console.log("");
  console.log("Cleans up two types of snapshots:");
  console.log("  1. Normal preset versions (VMID >= 9000) - in pve-lxc-snapshots.json");
  console.log("  2. Custom environment versions (VMID >= 9000, hostname: cmux-template-*)");
  console.log("     - Stored in Convex environmentSnapshotVersions table");
  console.log("");
  console.log("Usage:");
  console.log("  bun scripts/pve/pve-lxc-snapshot-cleanup.ts [options]");
  console.log("");
  console.log("Options:");
  console.log(`  --env-file <path>   Environment file (default: ${DEFAULT_ENV_FILE})`);
  console.log(`  --keep <n>          Versions to keep per preset/environment (default: ${DEFAULT_KEEP})`);
  console.log("  --execute           Actually delete (dry-run by default)");
  console.log("  --verbose           Show detailed output");
  console.log("  --presets-only      Only clean up normal preset versions (skip custom envs)");
  console.log("  --custom-only       Only clean up custom environment versions (skip presets)");
}

function loadEnvFile(envFilePath: string): void {
  const resolvedPath = resolve(WORKSPACE_ROOT, envFilePath);
  const result = dotenv.config({
    path: resolvedPath,
    override: true,
  });

  if (result.error) {
    throw new Error(`Failed to load env file: ${resolvedPath}\n${result.error.message}`);
  }
}

function readManifest(): PveLxcTemplateManifest {
  const raw = readFileSync(MANIFEST_PATH, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  return pveLxcTemplateManifestSchema.parse(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function pveApiRequest<T>(
  apiUrl: string,
  apiToken: string,
  method: string,
  path: string,
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `PVEAPIToken=${apiToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PVE API error ${response.status}: ${text}`);
  }

  const json = (await response.json()) as unknown;
  if (!isRecord(json) || !("data" in json)) {
    throw new Error("Unexpected PVE API response format");
  }
  return json.data as T;
}

async function resolvePveNode(
  apiUrl: string,
  apiToken: string,
  configuredNode?: string,
): Promise<string> {
  if (configuredNode && configuredNode.trim() !== "") {
    return configuredNode;
  }

  const nodes = await pveApiRequest<Array<{ node: string }>>(
    apiUrl,
    apiToken,
    "GET",
    "/api2/json/nodes",
  );

  const firstNode = nodes[0]?.node;
  if (!firstNode) {
    throw new Error("No PVE nodes found");
  }
  return firstNode;
}

function normalizeUpid(rawUpid: unknown): string | null {
  let candidate: string | null = null;

  if (typeof rawUpid === "string") {
    candidate = rawUpid;
  } else if (isRecord(rawUpid) && typeof rawUpid.upid === "string") {
    candidate = rawUpid.upid;
  }

  if (!candidate) {
    return null;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.includes("%3A") ? decodeURIComponent(trimmed) : trimmed;
}

async function waitForTask(
  apiUrl: string,
  apiToken: string,
  node: string,
  upid: string,
  timeoutMs: number = 300000,
): Promise<void> {
  const start = Date.now();
  const intervalMs = 2000;

  while (Date.now() - start < timeoutMs) {
    const status = await pveApiRequest<PveTaskStatus>(
      apiUrl,
      apiToken,
      "GET",
      `/api2/json/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`,
    );

    if (status.status === "stopped") {
      if (status.exitstatus !== "OK") {
        throw new Error(`Task failed: ${status.exitstatus ?? "unknown exit status"}`);
      }
      return;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }

  throw new Error(`Task timeout waiting for ${upid}`);
}

function parseConvexRows(raw: string): unknown[] {
  const parsed = JSON.parse(raw) as unknown;

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (isRecord(parsed) && Array.isArray(parsed.data)) {
    return parsed.data;
  }

  if (isRecord(parsed) && Array.isArray(parsed.items)) {
    return parsed.items;
  }

  throw new Error("Unexpected convex data output format");
}

function coercePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function parseNumericArray(raw: string): number[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Expected JSON array");
  }
  return parsed
    .map((item) => coercePositiveInt(item))
    .filter((item): item is number => item !== null);
}

function runConvexCommand(
  args: string[],
  cwd: string,
): string {
  return execFileSync("bunx", args, {
    cwd,
    env: process.env,
    encoding: "utf-8",
  });
}

function fetchUsedTemplateVmids(): Set<number> {
  try {
    const stdout = runConvexCommand(
      [
        "convex",
        "run",
        "environments:getUsedTemplateVmidsInternal",
        "{}",
      ],
      CONVEX_ROOT,
    );
    return new Set(parseNumericArray(stdout));
  } catch (runError) {
    try {
      const stdout = runConvexCommand(
        [
          "convex",
          "data",
          "environmentSnapshotVersions",
          "--format",
          "json",
          "--limit",
          String(CONVEX_QUERY_LIMIT),
        ],
        WORKSPACE_ROOT,
      );
      const rows = parseConvexRows(stdout);
      const usedVmids = new Set<number>();
      for (const row of rows) {
        if (!isRecord(row)) {
          continue;
        }
        const vmid = coercePositiveInt(row.templateVmid);
        if (vmid !== null) {
          usedVmids.add(vmid);
        }
      }
      return usedVmids;
    } catch (dataError) {
      throw new Error(
        "Failed to fetch environmentSnapshotVersions.\n" +
          `convex run error: ${formatExecError(runError)}\n` +
          `convex data error: ${formatExecError(dataError)}`,
      );
    }
  }
}

function formatExecError(error: unknown): string {
  if (!isRecord(error)) {
    return String(error);
  }

  const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
  const message = typeof error.message === "string" ? error.message : String(error);
  if (stderr) {
    return `${message}\n${stderr}`;
  }
  return message;
}

async function listPveTemplateVmids(
  apiUrl: string,
  apiToken: string,
  node: string,
): Promise<Set<number>> {
  const containers = await pveApiRequest<PveContainer[]>(
    apiUrl,
    apiToken,
    "GET",
    `/api2/json/nodes/${node}/lxc`,
  );

  const vmids = new Set<number>();
  for (const container of containers) {
    if (container.template === 1 && container.vmid >= PVE_TEMPLATE_MIN_VMID) {
      vmids.add(container.vmid);
    }
  }
  return vmids;
}

type PveCustomEnvTemplate = {
  vmid: number;
  hostname: string;
};

async function listPveCustomEnvTemplates(
  apiUrl: string,
  apiToken: string,
  node: string,
): Promise<PveCustomEnvTemplate[]> {
  const containers = await pveApiRequest<PveContainer[]>(
    apiUrl,
    apiToken,
    "GET",
    `/api2/json/nodes/${node}/lxc`,
  );

  const templates: PveCustomEnvTemplate[] = [];
  for (const container of containers) {
    // Custom environment templates: VMID >= 9000, is a template, has cmux-template-* hostname
    if (
      container.template === 1 &&
      container.vmid >= PVE_TEMPLATE_MIN_VMID &&
      container.name?.startsWith("cmux-template-")
    ) {
      templates.push({
        vmid: container.vmid,
        hostname: container.name,
      });
    }
  }
  return templates;
}

function fetchCustomEnvVersions(): CustomEnvVersion[] {
  try {
    const stdout = runConvexCommand(
      [
        "convex",
        "data",
        "environmentSnapshotVersions",
        "--format",
        "json",
        "--limit",
        String(CONVEX_QUERY_LIMIT),
      ],
      WORKSPACE_ROOT,
    );
    const rows = parseConvexRows(stdout);
    const versions: CustomEnvVersion[] = [];
    for (const row of rows) {
      if (!isRecord(row)) {
        continue;
      }
      // Only include PVE-LXC snapshots with templateVmid
      if (row.snapshotProvider !== "pve-lxc") {
        continue;
      }
      const templateVmid = coercePositiveInt(row.templateVmid);
      if (templateVmid === null) {
        continue;
      }
      // Custom env templates use VMID >= 9000 (same as normal presets, but distinguished by hostname)
      if (templateVmid < PVE_TEMPLATE_MIN_VMID) {
        continue;
      }
      versions.push({
        _id: typeof row._id === "string" ? row._id : "",
        environmentId: typeof row.environmentId === "string" ? row.environmentId : "",
        teamId: typeof row.teamId === "string" ? row.teamId : "",
        version: typeof row.version === "number" ? row.version : 0,
        templateVmid,
        snapshotProvider: typeof row.snapshotProvider === "string" ? row.snapshotProvider : undefined,
        createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
        label: typeof row.label === "string" ? row.label : undefined,
      });
    }
    return versions;
  } catch (error) {
    console.error("Failed to fetch custom environment versions:", formatExecError(error));
    return [];
  }
}

function analyzeCustomEnvVersions(
  versions: CustomEnvVersion[],
  keep: number,
  pveTemplates: PveCustomEnvTemplate[],
): CustomEnvCleanupPlan {
  // Build set of VMIDs that exist on PVE
  const pveTemplateVmids = new Set(pveTemplates.map((t) => t.vmid));

  // Group versions by environmentId
  const versionsByEnv = new Map<string, CustomEnvVersion[]>();
  for (const version of versions) {
    const existing = versionsByEnv.get(version.environmentId) ?? [];
    existing.push(version);
    versionsByEnv.set(version.environmentId, existing);
  }

  const envPlans: CustomEnvPlan[] = [];
  const versionsToDelete: CustomEnvVersionToDelete[] = [];
  const vmidsToDeleteSet = new Set<number>();

  // Track all VMIDs that are referenced by Convex records (to find orphans)
  const convexReferencedVmids = new Set<number>();

  for (const [environmentId, envVersions] of versionsByEnv) {
    // Sort by version descending
    const sortedDesc = [...envVersions].sort((a, b) => b.version - a.version);
    const kept = sortedDesc.slice(0, keep);
    const candidates = sortedDesc.slice(keep);

    const keptVersions = kept.map((v) => v.version);
    const deletedVersions: number[] = [];
    const keptVmids = new Set(kept.map((v) => v.templateVmid).filter((v): v is number => v !== undefined));

    // Track all VMIDs referenced by this environment (kept + deleted)
    for (const version of sortedDesc) {
      if (version.templateVmid !== undefined) {
        convexReferencedVmids.add(version.templateVmid);
      }
    }

    for (const version of candidates) {
      if (version.templateVmid === undefined) {
        continue;
      }
      deletedVersions.push(version.version);
      versionsToDelete.push({
        convexDocId: version._id,
        environmentId: version.environmentId,
        version: version.version,
        templateVmid: version.templateVmid,
        createdAt: version.createdAt,
      });
      // Only mark for PVE deletion if not referenced by kept versions
      if (!keptVmids.has(version.templateVmid)) {
        vmidsToDeleteSet.add(version.templateVmid);
      }
    }

    envPlans.push({
      environmentId,
      totalVersions: envVersions.length,
      keptVersions,
      deletedVersions,
    });
  }

  const vmidsToDeleteCandidates = [...vmidsToDeleteSet];
  const vmidsMissingOnPve = vmidsToDeleteCandidates.filter(
    (vmid) => !pveTemplateVmids.has(vmid),
  );
  const vmidsToDelete = vmidsToDeleteCandidates.filter((vmid) =>
    pveTemplateVmids.has(vmid),
  );

  // Find orphan templates: exist on PVE but NOT tracked in Convex
  // These are likely created by dev server or failed operations
  const orphanTemplates: Array<{ vmid: number; hostname: string }> = [];
  for (const template of pveTemplates) {
    if (!convexReferencedVmids.has(template.vmid)) {
      orphanTemplates.push(template);
    }
  }
  const orphanVmids = orphanTemplates.map((t) => t.vmid);

  return {
    envPlans,
    versionsToDelete,
    vmidsToDelete,
    vmidsMissingOnPve,
    orphanVmids,
    orphanTemplates,
  };
}

function createVersionKey(
  presetId: string,
  version: number,
  snapshotId: string,
): string {
  return `${presetId}:${version}:${snapshotId}`;
}

function createDeleteKey(entry: VersionToDelete): string {
  return createVersionKey(entry.presetId, entry.version, entry.snapshotId);
}

function analyzeManifest(
  manifest: PveLxcTemplateManifest,
  keep: number,
  usedVmids: ReadonlySet<number>,
  pveTemplateVmids: ReadonlySet<number>,
): CleanupPlan {
  const versionsToDelete: VersionToDelete[] = [];
  const protectedVersions: VersionToDelete[] = [];
  const presetPlans: PresetPlan[] = [];

  for (const preset of manifest.presets) {
    const sortedDesc = [...preset.versions].sort((a, b) => b.version - a.version);
    const kept = sortedDesc.slice(0, keep);
    const candidates = sortedDesc.slice(keep);

    const keptVersions: number[] = [];
    const protectedVersionNumbers: number[] = [];
    const deletedVersionNumbers: number[] = [];

    for (const version of kept) {
      keptVersions.push(version.version);
    }

    for (const version of candidates) {
      const entry: VersionToDelete = {
        presetId: preset.presetId,
        presetLabel: preset.label,
        version: version.version,
        snapshotId: version.snapshotId,
        templateVmid: version.templateVmid,
        capturedAt: version.capturedAt,
      };

      if (usedVmids.has(version.templateVmid)) {
        protectedVersions.push(entry);
        protectedVersionNumbers.push(version.version);
      } else {
        versionsToDelete.push(entry);
        deletedVersionNumbers.push(version.version);
      }
    }

    presetPlans.push({
      presetId: preset.presetId,
      presetLabel: preset.label,
      totalVersions: preset.versions.length,
      keptVersions,
      protectedVersions: protectedVersionNumbers,
      deletedVersions: deletedVersionNumbers,
    });
  }

  const deleteVersionKeys = new Set(versionsToDelete.map(createDeleteKey));

  const remainingVmids = new Set<number>();
  for (const preset of manifest.presets) {
    for (const version of preset.versions) {
      const key = createVersionKey(preset.presetId, version.version, version.snapshotId);
      if (!deleteVersionKeys.has(key)) {
        remainingVmids.add(version.templateVmid);
      }
    }
  }

  const vmidsReferencedByDeletedVersions = sortedUniqueNumbers(
    versionsToDelete.map((entry) => entry.templateVmid),
  );

  const vmidsRetainedByRemainingReference = vmidsReferencedByDeletedVersions.filter(
    (vmid) => remainingVmids.has(vmid),
  );

  const vmidsToDeleteCandidates = vmidsReferencedByDeletedVersions.filter(
    (vmid) => !remainingVmids.has(vmid) && !usedVmids.has(vmid),
  );

  const vmidsMissingOnPve = vmidsToDeleteCandidates.filter(
    (vmid) => !pveTemplateVmids.has(vmid),
  );
  const vmidsToDelete = vmidsToDeleteCandidates.filter((vmid) =>
    pveTemplateVmids.has(vmid),
  );

  return {
    presetPlans,
    versionsToDelete,
    protectedVersions,
    vmidsReferencedByDeletedVersions,
    vmidsRetainedByRemainingReference,
    vmidsToDelete,
    vmidsMissingOnPve,
  };
}

function sortedUniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function formatVersionRanges(values: number[]): string {
  const numbers = sortedUniqueNumbers(values);
  if (numbers.length === 0) {
    return "none";
  }

  const ranges: string[] = [];
  let start = numbers[0];
  let previous = numbers[0];

  for (let index = 1; index < numbers.length; index += 1) {
    const current = numbers[index];
    if (current === undefined || previous === undefined || start === undefined) {
      continue;
    }
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push(formatRange(start, previous));
    start = current;
    previous = current;
  }

  if (start !== undefined && previous !== undefined) {
    ranges.push(formatRange(start, previous));
  }

  return ranges.join(", ");
}

function formatRange(start: number, end: number): string {
  return start === end ? `v${start}` : `v${start}-v${end}`;
}

function printPresetReport(
  options: Options,
  usedVmids: ReadonlySet<number>,
  plan: CleanupPlan,
): void {
  console.log("=== Normal Preset Versions ===");
  console.log("");

  for (const preset of plan.presetPlans) {
    console.log(`Preset: ${preset.presetId} (${preset.presetLabel})`);
    console.log(`  Total versions: ${preset.totalVersions}`);
    console.log(`  Keeping: ${formatVersionRanges(preset.keptVersions)}`);
    if (preset.protectedVersions.length > 0) {
      console.log(
        `  Protected by environments: ${preset.protectedVersions.length} (${formatVersionRanges(
          preset.protectedVersions,
        )})`,
      );
    }
    console.log(
      `  Deleting: ${preset.deletedVersions.length} (${formatVersionRanges(preset.deletedVersions)})`,
    );
    console.log("");
  }

  console.log("Preset Summary:");
  console.log(`  - Versions removed from manifest: ${plan.versionsToDelete.length}`);
  console.log(`  - Protected versions skipped: ${plan.protectedVersions.length}`);
  console.log(
    `  - Unique VMIDs referenced by deleted versions: ${plan.vmidsReferencedByDeletedVersions.length}`,
  );
  console.log(
    `  - VMIDs retained by remaining references: ${plan.vmidsRetainedByRemainingReference.length}`,
  );
  console.log(`  - VMIDs missing on PVE: ${plan.vmidsMissingOnPve.length}`);
  console.log(`  - Templates to delete from PVE: ${plan.vmidsToDelete.length}`);
  console.log(`  - Protected VMIDs in use by environments: ${usedVmids.size}`);

  if (options.verbose) {
    if (plan.vmidsRetainedByRemainingReference.length > 0) {
      console.log(
        `  - Retained-by-reference VMIDs: ${plan.vmidsRetainedByRemainingReference.join(", ")}`,
      );
    }
    if (plan.vmidsMissingOnPve.length > 0) {
      console.log(`  - Missing-on-PVE VMIDs: ${plan.vmidsMissingOnPve.join(", ")}`);
    }
    if (plan.vmidsToDelete.length > 0) {
      console.log(`  - VMIDs scheduled for delete: ${plan.vmidsToDelete.join(", ")}`);
    }
  }
  console.log("");
}

function printCustomEnvReport(
  options: Options,
  plan: CustomEnvCleanupPlan,
): void {
  console.log("=== Custom Environment Versions ===");
  console.log("");

  if (plan.envPlans.length === 0 && plan.orphanTemplates.length === 0) {
    console.log("No custom environment versions or orphans found.");
    console.log("");
    return;
  }

  if (plan.envPlans.length > 0) {
    console.log("Tracked in Convex (production):");
    for (const envPlan of plan.envPlans) {
      console.log(`  Environment: ${envPlan.environmentId}`);
      console.log(`    Total versions: ${envPlan.totalVersions}`);
      console.log(`    Keeping: ${formatVersionRanges(envPlan.keptVersions)}`);
      console.log(`    Deleting: ${envPlan.deletedVersions.length} (${formatVersionRanges(envPlan.deletedVersions)})`);
    }
    console.log("");
  }

  if (plan.orphanTemplates.length > 0) {
    console.log("Orphan templates (on PVE but NOT in Convex - likely from dev server):");
    for (const orphan of plan.orphanTemplates) {
      console.log(`  - VMID ${orphan.vmid}: ${orphan.hostname}`);
    }
    console.log("");
  }

  console.log("Custom Env Summary:");
  console.log(`  - Convex records to delete: ${plan.versionsToDelete.length}`);
  console.log(`  - VMIDs missing on PVE: ${plan.vmidsMissingOnPve.length}`);
  console.log(`  - Templates to delete (old versions): ${plan.vmidsToDelete.length}`);
  console.log(`  - Orphan templates to delete: ${plan.orphanVmids.length}`);

  if (options.verbose) {
    if (plan.vmidsToDelete.length > 0) {
      console.log(`  - Version VMIDs scheduled for delete: ${plan.vmidsToDelete.join(", ")}`);
    }
    if (plan.orphanVmids.length > 0) {
      console.log(`  - Orphan VMIDs scheduled for delete: ${plan.orphanVmids.join(", ")}`);
    }
  }
  console.log("");
}

function printDryRunReport(
  options: Options,
  node: string,
  usedVmids: ReadonlySet<number>,
  presetPlan: CleanupPlan | null,
  customEnvPlan: CustomEnvCleanupPlan | null,
): void {
  console.log(`PVE-LXC Snapshot Cleanup (${options.execute ? "execute" : "dry-run"})`);
  console.log("==========================================");
  console.log(`Config: keep=${options.keep}, env=${options.envFile}`);
  console.log(`PVE Node: ${node}`);
  console.log("");

  if (presetPlan) {
    printPresetReport(options, usedVmids, presetPlan);
  }

  if (customEnvPlan) {
    printCustomEnvReport(options, customEnvPlan);
  }

  // Total summary
  const presetTemplates = presetPlan?.vmidsToDelete.length ?? 0;
  const customVersionTemplates = customEnvPlan?.vmidsToDelete.length ?? 0;
  const customOrphanTemplates = customEnvPlan?.orphanVmids.length ?? 0;
  const totalTemplates = presetTemplates + customVersionTemplates + customOrphanTemplates;

  console.log("=== Total Summary ===");
  if (presetPlan) {
    console.log(`  Normal presets: ${presetPlan.versionsToDelete.length} versions, ${presetTemplates} templates`);
  }
  if (customEnvPlan) {
    console.log(`  Custom environments: ${customEnvPlan.versionsToDelete.length} versions, ${customVersionTemplates} templates`);
    if (customOrphanTemplates > 0) {
      console.log(`  Orphan templates (dev server): ${customOrphanTemplates} templates`);
    }
  }
  console.log(`  Total templates to delete: ${totalTemplates}`);

  if (!options.execute) {
    console.log("");
    console.log("Run with --execute to perform these deletions.");
  }
}

async function deleteTemplate(
  apiUrl: string,
  apiToken: string,
  node: string,
  vmid: number,
): Promise<void> {
  const rawUpid = await pveApiRequest<unknown>(
    apiUrl,
    apiToken,
    "DELETE",
    `/api2/json/nodes/${node}/lxc/${vmid}`,
  );

  const upid = normalizeUpid(rawUpid);
  if (!upid) {
    return;
  }

  await waitForTask(apiUrl, apiToken, node, upid);
}

function pruneManifestVersions(
  manifest: PveLxcTemplateManifest,
  versionsToDelete: VersionToDelete[],
): PveLxcTemplateManifest {
  const deleteVersionKeys = new Set(versionsToDelete.map(createDeleteKey));
  const updatedPresets = manifest.presets.map((preset) => {
    const versions = preset.versions.filter((version) => {
      const key = createVersionKey(preset.presetId, version.version, version.snapshotId);
      return !deleteVersionKeys.has(key);
    });
    return {
      ...preset,
      versions,
    };
  });

  const updatedManifestCandidate: PveLxcTemplateManifest = {
    ...manifest,
    updatedAt: new Date().toISOString(),
    presets: updatedPresets,
  };

  return pveLxcTemplateManifestSchema.parse(updatedManifestCandidate);
}

function writeManifest(manifest: PveLxcTemplateManifest): void {
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

async function executePresetCleanup(
  apiUrl: string,
  apiToken: string,
  node: string,
  options: Options,
  manifest: PveLxcTemplateManifest,
  plan: CleanupPlan,
): Promise<ExecuteResult> {
  const deletedVmids: number[] = [];
  const failedDeletes: Array<{ vmid: number; error: string }> = [];

  for (const vmid of plan.vmidsToDelete) {
    try {
      if (options.verbose) {
        console.log(`Deleting PVE preset template VMID ${vmid}...`);
      }
      await deleteTemplate(apiUrl, apiToken, node, vmid);
      deletedVmids.push(vmid);
      if (options.verbose) {
        console.log(`Deleted VMID ${vmid}`);
      }
    } catch (error) {
      failedDeletes.push({
        vmid,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`Failed to delete VMID ${vmid}: ${error}`);
    }
  }

  const updatedManifest = pruneManifestVersions(manifest, plan.versionsToDelete);
  writeManifest(updatedManifest);

  return {
    deletedVmids,
    failedDeletes,
    removedVersionCount: plan.versionsToDelete.length,
  };
}

type CustomEnvExecuteResult = {
  deletedVmids: number[];
  failedDeletes: Array<{ vmid: number; error: string }>;
  deletedConvexRecords: number;
  failedConvexDeletes: Array<{ docId: string; error: string }>;
  deletedOrphanVmids: number[];
  failedOrphanDeletes: Array<{ vmid: number; error: string }>;
};

function deleteConvexSnapshotVersion(docId: string): void {
  runConvexCommand(
    [
      "convex",
      "run",
      "environments:deleteSnapshotVersionInternal",
      JSON.stringify({ docId }),
    ],
    CONVEX_ROOT,
  );
}

async function executeCustomEnvCleanup(
  apiUrl: string,
  apiToken: string,
  node: string,
  options: Options,
  plan: CustomEnvCleanupPlan,
): Promise<CustomEnvExecuteResult> {
  const deletedVmids: number[] = [];
  const failedDeletes: Array<{ vmid: number; error: string }> = [];
  const failedConvexDeletes: Array<{ docId: string; error: string }> = [];
  const deletedOrphanVmids: number[] = [];
  const failedOrphanDeletes: Array<{ vmid: number; error: string }> = [];
  let deletedConvexRecords = 0;

  // Delete PVE templates for old versions
  for (const vmid of plan.vmidsToDelete) {
    try {
      if (options.verbose) {
        console.log(`Deleting PVE custom env template VMID ${vmid} (old version)...`);
      }
      await deleteTemplate(apiUrl, apiToken, node, vmid);
      deletedVmids.push(vmid);
      if (options.verbose) {
        console.log(`Deleted VMID ${vmid}`);
      }
    } catch (error) {
      failedDeletes.push({
        vmid,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`Failed to delete VMID ${vmid}: ${error}`);
    }
  }

  // Delete orphan templates (not tracked in Convex)
  for (const orphan of plan.orphanTemplates) {
    try {
      if (options.verbose) {
        console.log(`Deleting orphan template VMID ${orphan.vmid} (${orphan.hostname})...`);
      }
      await deleteTemplate(apiUrl, apiToken, node, orphan.vmid);
      deletedOrphanVmids.push(orphan.vmid);
      if (options.verbose) {
        console.log(`Deleted orphan VMID ${orphan.vmid}`);
      }
    } catch (error) {
      failedOrphanDeletes.push({
        vmid: orphan.vmid,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`Failed to delete orphan VMID ${orphan.vmid}: ${error}`);
    }
  }

  // Delete Convex records
  for (const version of plan.versionsToDelete) {
    try {
      if (options.verbose) {
        console.log(`Deleting Convex record ${version.convexDocId} (env=${version.environmentId}, v${version.version})...`);
      }
      deleteConvexSnapshotVersion(version.convexDocId);
      deletedConvexRecords += 1;
      if (options.verbose) {
        console.log(`Deleted Convex record ${version.convexDocId}`);
      }
    } catch (error) {
      failedConvexDeletes.push({
        docId: version.convexDocId,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`Failed to delete Convex record ${version.convexDocId}: ${error}`);
    }
  }

  return {
    deletedVmids,
    failedDeletes,
    deletedConvexRecords,
    failedConvexDeletes,
    deletedOrphanVmids,
    failedOrphanDeletes,
  };
}

function assertRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function printFailureSummary(result: ExecuteResult): void {
  if (result.failedDeletes.length === 0) {
    return;
  }

  console.error("");
  console.error("Some template deletions failed:");
  for (const failure of result.failedDeletes) {
    console.error(`  - VMID ${failure.vmid}: ${failure.error}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.presetsOnly && options.customOnly) {
    throw new Error("Cannot use both --presets-only and --custom-only");
  }

  loadEnvFile(options.envFile);

  const apiUrl = assertRequiredEnvVar("PVE_API_URL");
  const apiToken = assertRequiredEnvVar("PVE_API_TOKEN");
  const configuredNode = process.env.PVE_NODE;

  const node = await resolvePveNode(apiUrl, apiToken, configuredNode);
  const usedVmids = fetchUsedTemplateVmids();

  let presetPlan: CleanupPlan | null = null;
  let customEnvPlan: CustomEnvCleanupPlan | null = null;
  let manifest: PveLxcTemplateManifest | null = null;

  // Analyze normal preset versions
  if (!options.customOnly) {
    manifest = readManifest();
    const pveTemplateVmids = await listPveTemplateVmids(apiUrl, apiToken, node);
    presetPlan = analyzeManifest(manifest, options.keep, usedVmids, pveTemplateVmids);
  }

  // Analyze custom environment versions
  if (!options.presetsOnly) {
    const customEnvVersions = fetchCustomEnvVersions();
    const pveCustomEnvTemplates = await listPveCustomEnvTemplates(apiUrl, apiToken, node);
    customEnvPlan = analyzeCustomEnvVersions(customEnvVersions, options.keep, pveCustomEnvTemplates);
  }

  printDryRunReport(options, node, usedVmids, presetPlan, customEnvPlan);

  if (!options.execute) {
    return;
  }

  const hasPresetChanges = presetPlan && presetPlan.versionsToDelete.length > 0;
  const hasCustomEnvChanges = customEnvPlan && (
    customEnvPlan.versionsToDelete.length > 0 || customEnvPlan.orphanVmids.length > 0
  );

  if (!hasPresetChanges && !hasCustomEnvChanges) {
    console.log("");
    console.log("No changes needed.");
    return;
  }

  console.log("");
  console.log("Executing cleanup...");

  let presetResult: ExecuteResult | null = null;
  let customEnvResult: CustomEnvExecuteResult | null = null;
  let hasFailures = false;

  // Execute preset cleanup
  if (hasPresetChanges && presetPlan && manifest) {
    console.log("");
    console.log("Cleaning up normal preset versions...");
    presetResult = await executePresetCleanup(
      apiUrl,
      apiToken,
      node,
      options,
      manifest,
      presetPlan,
    );

    console.log("");
    console.log("Preset cleanup summary:");
    console.log(`  - Versions removed from manifest: ${presetResult.removedVersionCount}`);
    console.log(`  - Templates deleted from PVE: ${presetResult.deletedVmids.length}`);
    console.log(`  - Templates missing on PVE: ${presetPlan.vmidsMissingOnPve.length}`);
    console.log(`  - Template delete failures: ${presetResult.failedDeletes.length}`);
    console.log(`  - Manifest updated: ${MANIFEST_PATH}`);

    if (presetResult.failedDeletes.length > 0) {
      hasFailures = true;
      printFailureSummary(presetResult);
    }
  }

  // Execute custom environment cleanup
  if (hasCustomEnvChanges && customEnvPlan) {
    console.log("");
    console.log("Cleaning up custom environment versions...");
    customEnvResult = await executeCustomEnvCleanup(
      apiUrl,
      apiToken,
      node,
      options,
      customEnvPlan,
    );

    console.log("");
    console.log("Custom env cleanup summary:");
    console.log(`  - Convex records deleted: ${customEnvResult.deletedConvexRecords}`);
    console.log(`  - Templates deleted (old versions): ${customEnvResult.deletedVmids.length}`);
    console.log(`  - Orphan templates deleted: ${customEnvResult.deletedOrphanVmids.length}`);
    console.log(`  - Templates missing on PVE: ${customEnvPlan.vmidsMissingOnPve.length}`);
    console.log(`  - Template delete failures: ${customEnvResult.failedDeletes.length}`);
    console.log(`  - Orphan delete failures: ${customEnvResult.failedOrphanDeletes.length}`);
    console.log(`  - Convex record delete failures: ${customEnvResult.failedConvexDeletes.length}`);

    const hasCustomEnvFailures =
      customEnvResult.failedDeletes.length > 0 ||
      customEnvResult.failedOrphanDeletes.length > 0 ||
      customEnvResult.failedConvexDeletes.length > 0;

    if (hasCustomEnvFailures) {
      hasFailures = true;
      if (customEnvResult.failedDeletes.length > 0) {
        console.error("");
        console.error("Some PVE template deletions failed:");
        for (const failure of customEnvResult.failedDeletes) {
          console.error(`  - VMID ${failure.vmid}: ${failure.error}`);
        }
      }
      if (customEnvResult.failedOrphanDeletes.length > 0) {
        console.error("");
        console.error("Some orphan template deletions failed:");
        for (const failure of customEnvResult.failedOrphanDeletes) {
          console.error(`  - VMID ${failure.vmid}: ${failure.error}`);
        }
      }
      if (customEnvResult.failedConvexDeletes.length > 0) {
        console.error("");
        console.error("Some Convex record deletions failed:");
        for (const failure of customEnvResult.failedConvexDeletes) {
          console.error(`  - Doc ${failure.docId}: ${failure.error}`);
        }
      }
    }
  }

  if (hasFailures) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
