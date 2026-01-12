#!/usr/bin/env bun
/**
 * Freestyle snapshot provisioning script.
 *
 * Creates VM snapshots configured for cmux ACP server.
 *
 * Usage:
 *   bun run scripts/freestyle-snapshot.ts
 *   bun run scripts/freestyle-snapshot.ts --preset standard
 *   bun run scripts/freestyle-snapshot.ts --base-snapshot snap_xxx
 *
 * Prerequisites:
 *   - FREESTYLE_API_KEY environment variable set
 *   - freestyle-sandboxes@beta package installed
 */

import { freestyle } from "freestyle-sandboxes";
import fs from "node:fs";
import path from "node:path";

// Constants
const MANIFEST_PATH = path.join(
  import.meta.dirname,
  "../packages/shared/src/freestyle-snapshots.json"
);

interface Preset {
  presetId: string;
  label: string;
  vcpus: number;
  memoryMb: number;
  diskGb: number;
}

const PRESETS: Preset[] = [
  { presetId: "standard", label: "Standard", vcpus: 2, memoryMb: 4096, diskGb: 20 },
  { presetId: "boosted", label: "Boosted", vcpus: 4, memoryMb: 8192, diskGb: 40 },
];

interface ManifestVersion {
  version: number;
  snapshotId: string;
  capturedAt: string;
}

interface ManifestPreset {
  presetId: string;
  label: string;
  versions: ManifestVersion[];
}

interface Manifest {
  schemaVersion: number;
  updatedAt: string;
  presets: ManifestPreset[];
}

function loadManifest(): Manifest {
  if (fs.existsSync(MANIFEST_PATH)) {
    const content = fs.readFileSync(MANIFEST_PATH, "utf-8");
    return JSON.parse(content);
  }
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    presets: [],
  };
}

function saveManifest(manifest: Manifest): void {
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`Manifest saved to ${MANIFEST_PATH}`);
}

function updateManifest(presetId: string, snapshotId: string): void {
  const manifest = loadManifest();

  let preset = manifest.presets.find((p) => p.presetId === presetId);
  if (!preset) {
    const presetDef = PRESETS.find((p) => p.presetId === presetId);
    preset = {
      presetId,
      label: presetDef?.label ?? presetId,
      versions: [],
    };
    manifest.presets.push(preset);
  }

  // Add new version at the beginning
  preset.versions.unshift({
    version: preset.versions.length + 1,
    snapshotId,
    capturedAt: new Date().toISOString(),
  });

  // Keep only last 5 versions
  preset.versions = preset.versions.slice(0, 5);

  saveManifest(manifest);
}

async function runSnapshotWorkflow(
  preset: Preset,
  baseSnapshotId?: string
): Promise<string> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Creating snapshot for preset: ${preset.label}`);
  console.log(`${"=".repeat(60)}\n`);

  // 1. Create VM from base snapshot or fresh
  console.log("Creating VM...");
  const createOptions: Parameters<typeof freestyle.vms.create>[0] = {
    ...(baseSnapshotId ? { snapshotId: baseSnapshotId } : {}),
    idleTimeoutSeconds: 7200, // 2 hours for provisioning
    rootfsSizeGb: preset.diskGb,
    persistence: { type: "ephemeral" as const },
  };

  const { vm, vmId, domains } = await freestyle.vms.create(createOptions);
  console.log(`Created VM: ${vmId}`);
  if (domains?.length) {
    console.log(`Domains: ${domains.join(", ")}`);
  }

  try {
    // 2. Run provisioning commands
    console.log("\nRunning provisioning commands...\n");

    const provisioningCommands = [
      // Basic system setup
      "apt-get update",
      "apt-get install -y curl git build-essential pkg-config libssl-dev",

      // Install Node.js (for Claude Code ACP)
      "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
      "apt-get install -y nodejs",
      "node --version && npm --version",

      // Install Bun
      "curl -fsSL https://bun.sh/install | bash",
      'export PATH="$HOME/.bun/bin:$PATH" && bun --version',

      // Install Rust (for cmux-acp-server)
      "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
      'source "$HOME/.cargo/env" && rustc --version',

      // Install uv/Python
      "curl -LsSf https://astral.sh/uv/install.sh | sh",
      'export PATH="$HOME/.local/bin:$PATH" && uv --version',

      // Install Claude Code ACP
      "npm install -g @zed-industries/claude-code-acp",
      "which claude || echo 'claude not in PATH yet'",

      // Create cmux directories
      "mkdir -p /etc/cmux /var/log/cmux /workspace",

      // Verify installations
      "node --version",
      "npm --version",
      '$HOME/.bun/bin/bun --version || echo "bun not found"',
      '$HOME/.cargo/bin/rustc --version || echo "rustc not found"',
    ];

    for (const cmd of provisioningCommands) {
      console.log(`> ${cmd}`);
      try {
        const result = await vm.exec(cmd);
        if (result) {
          console.log(result);
        }
      } catch (error) {
        console.error(`  Command failed: ${error}`);
        // Continue with other commands
      }
    }

    // 3. Create snapshot
    console.log("\nCreating snapshot...");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const { snapshotId } = await vm.snapshot();
    console.log(`Snapshot created: ${snapshotId}`);

    // 4. Update manifest
    updateManifest(preset.presetId, snapshotId);

    return snapshotId;
  } finally {
    // 5. Clean up VM
    console.log("\nCleaning up VM...");
    try {
      await freestyle.vms.delete({ vmId });
      console.log("VM deleted");
    } catch (error) {
      console.error(`Failed to delete VM: ${error}`);
    }
  }
}

async function main() {
  // Parse args
  const args = process.argv.slice(2);
  let selectedPreset: string | null = null;
  let baseSnapshotId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--preset" && args[i + 1]) {
      selectedPreset = args[i + 1];
      i++;
    } else if (args[i] === "--base-snapshot" && args[i + 1]) {
      baseSnapshotId = args[i + 1];
      i++;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
Usage: bun run scripts/freestyle-snapshot.ts [options]

Options:
  --preset <name>        Run only the specified preset (standard, boosted, all)
  --base-snapshot <id>   Start from an existing snapshot ID
  --help, -h            Show this help message

Examples:
  bun run scripts/freestyle-snapshot.ts
  bun run scripts/freestyle-snapshot.ts --preset standard
  bun run scripts/freestyle-snapshot.ts --base-snapshot snap_xxx
`);
      process.exit(0);
    }
  }

  // Check API key
  if (!process.env.FREESTYLE_API_KEY) {
    console.error("Error: FREESTYLE_API_KEY environment variable not set");
    console.error("Set it in your environment or use: source ~/.secrets/cmux.env");
    process.exit(1);
  }

  // Determine which presets to run
  const presetsToRun =
    selectedPreset && selectedPreset !== "all"
      ? PRESETS.filter((p) => p.presetId === selectedPreset)
      : PRESETS;

  if (presetsToRun.length === 0) {
    console.error(`Error: Unknown preset '${selectedPreset}'`);
    console.error(`Available presets: ${PRESETS.map((p) => p.presetId).join(", ")}, all`);
    process.exit(1);
  }

  console.log("Freestyle Snapshot Provisioning");
  console.log("================================\n");
  console.log(`Presets to run: ${presetsToRun.map((p) => p.label).join(", ")}`);
  if (baseSnapshotId) {
    console.log(`Base snapshot: ${baseSnapshotId}`);
  }

  const results: Array<{ presetId: string; snapshotId: string }> = [];

  for (const preset of presetsToRun) {
    try {
      const snapshotId = await runSnapshotWorkflow(preset, baseSnapshotId);
      results.push({ presetId: preset.presetId, snapshotId });
    } catch (error) {
      console.error(`\nFailed to create snapshot for ${preset.label}:`, error);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));

  if (results.length > 0) {
    console.log("\nCreated snapshots:");
    for (const r of results) {
      console.log(`  - ${r.presetId}: ${r.snapshotId}`);
    }
    console.log(`\nManifest updated: ${MANIFEST_PATH}`);
  } else {
    console.log("\nNo snapshots created.");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
