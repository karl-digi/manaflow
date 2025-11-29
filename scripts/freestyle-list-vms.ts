#!/usr/bin/env bun

import process from "node:process";
import {
  DEFAULT_FREESTYLE_BASE_URL,
  createFreestyleClient,
  listVms,
  type VmInfo,
} from "@cmux/freestyle-openapi-client";

const FREESTYLE_API_KEY = process.env.FREESTYLE_API_KEY;
const FREESTYLE_API_BASE_URL =
  process.env.FREESTYLE_API_BASE_URL ?? DEFAULT_FREESTYLE_BASE_URL;

if (!FREESTYLE_API_KEY) {
  console.error(
    "FREESTYLE_API_KEY is required. Export it before running this script."
  );
  process.exit(1);
}

const freestyleClient = createFreestyleClient({
  baseUrl: FREESTYLE_API_BASE_URL,
  headers: {
    Authorization: `Bearer ${FREESTYLE_API_KEY}`,
  },
});

function formatVm(vm: VmInfo) {
  console.log(`- ${vm.id} (${vm.state})`);
  if (vm.createdAt) {
    console.log(`  created: ${vm.createdAt}`);
  }
  if (vm.cpuTimeSeconds != null) {
    console.log(`  cpu time: ${vm.cpuTimeSeconds}s`);
  }
  if (vm.lastNetworkActivity) {
    console.log(`  last network activity: ${vm.lastNetworkActivity}`);
  }
  console.log("");
}

async function main() {
  console.log(
    `[Freestyle] Fetching VMs from ${FREESTYLE_API_BASE_URL.replace(/\/+$/, "")}`
  );

  const response = await listVms({
    client: freestyleClient,
  });

  if (!response.data) {
    console.error("Failed to list VMs:", response.error ?? "Unknown error");
    process.exit(1);
  }

  const { vms, totalCount, runningCount, stoppedCount, startingCount } =
    response.data;

  console.log(
    `Found ${totalCount} VM(s): ${runningCount} running, ${startingCount} starting, ${stoppedCount} stopped\n`
  );

  if (vms.length === 0) {
    console.log("No VMs found.");
    return;
  }

  for (const vm of vms) {
    formatVm(vm);
  }
}

await main().catch((error) => {
  console.error("Unexpected error while listing Freestyle VMs:", error);
  process.exit(1);
});
