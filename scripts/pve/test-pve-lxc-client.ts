#!/usr/bin/env bun
/**
 * Test script for PVE LXC Client
 *
 * Usage: bun run scripts/pve/test-pve-lxc-client.ts
 *
 * Required environment variables:
 *   PVE_API_URL - Proxmox API endpoint (e.g., https://pve.example.com:8006)
 *   PVE_API_TOKEN - API token in format: user@realm!tokenid=secret
 *   PVE_NODE - (optional) Node name, will auto-detect if not set
 */

import { PveLxcClient } from "../../apps/www/lib/utils/pve-lxc-client";

async function main() {
  console.log("==========================================");
  console.log("  PVE LXC Client Test");
  console.log("==========================================\n");

  // Check environment
  const apiUrl = process.env.PVE_API_URL;
  const apiToken = process.env.PVE_API_TOKEN;
  const node = process.env.PVE_NODE;

  console.log("Configuration:");
  console.log(`  PVE_API_URL: ${apiUrl || "<not set>"}`);
  console.log(`  PVE_API_TOKEN: ${apiToken ? "<set>" : "<not set>"}`);
  console.log(`  PVE_NODE: ${node || "<auto-detect>"}`);
  console.log("");

  if (!apiUrl || !apiToken) {
    console.error("ERROR: PVE_API_URL and PVE_API_TOKEN are required");
    process.exit(1);
  }

  // Create client
  console.log("Creating PVE LXC client...");
  const client = new PveLxcClient({
    apiUrl,
    apiToken,
    node,
  });

  // Test 1: Auto-detect node (via getNode which is private, but we can test via list)
  console.log("\n--- Test 1: List containers (triggers node auto-detection) ---");
  try {
    const instances = await client.instances.list();
    console.log(`SUCCESS: Found ${instances.length} cmux containers`);
    for (const instance of instances) {
      console.log(`  - ${instance.id} (vmid=${instance.vmid}, status=${instance.status})`);
    }
  } catch (error) {
    console.error("FAILED:", error instanceof Error ? error.message : error);
  }

  // Test 2: Try to parse a snapshot ID
  console.log("\n--- Test 2: Parse snapshot ID format ---");
  const testSnapshotId = "pve_102_cmux-4vcpu_6gb_32gb-20251227-030007";
  try {
    // We'll manually test the parsing logic
    const match = testSnapshotId.match(/^pve_(\d+)_(.+)$/);
    if (match) {
      console.log(`SUCCESS: Parsed snapshot ID`);
      console.log(`  Source VMID: ${match[1]}`);
      console.log(`  Snapshot name: ${match[2]}`);
    } else {
      console.log("FAILED: Could not parse snapshot ID");
    }
  } catch (error) {
    console.error("FAILED:", error instanceof Error ? error.message : error);
  }

  // Test 3: Test starting a container from snapshot (dry run - parse only)
  console.log("\n--- Test 3: Validate snapshot ID for start operation ---");
  try {
    const testSnapshotId2 = "pve_102_cmux-4vcpu_6gb_32gb-20251227-030007";
    console.log(`  Input: ${testSnapshotId2}`);

    // This would trigger: client.instances.start({ snapshotId: testSnapshotId2 })
    // For now just validate the format is correct
    const match = testSnapshotId2.match(/^pve_(\d+)_(.+)$/);
    if (match) {
      const sourceVmid = parseInt(match[1], 10);
      const snapshotName = match[2];
      console.log(`SUCCESS: Ready to clone from VMID ${sourceVmid}, snapshot "${snapshotName}"`);
    } else {
      console.log("FAILED: Invalid snapshot ID format");
    }
  } catch (error) {
    console.error("FAILED:", error instanceof Error ? error.message : error);
  }

  console.log("\n==========================================");
  console.log("  Test completed");
  console.log("==========================================\n");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
