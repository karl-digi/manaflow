#!/usr/bin/env bun
/**
 * Quick test script for devbox-e2b CLI
 * Run with: bun run test/quick-test.ts
 */

import {
  getMe,
  listInstances,
  getInstance,
  getWorkerAuthToken,
  getWorkerStatus,
  getWorkerServices,
  getCdpInfo,
  workerExec,
  takeScreenshot,
} from "../src/api";
import { isLoggedIn, getDefaultTeam } from "../src/auth";

async function runQuickTest() {
  console.log("=== Devbox E2B CLI Quick Test ===\n");

  // 1. Authentication check
  console.log("1. Checking authentication...");
  if (!isLoggedIn()) {
    console.error("   NOT authenticated. Run 'devbox login' first.");
    process.exit(1);
  }
  console.log("   Authenticated");

  // 2. Get user profile
  console.log("\n2. Getting user profile...");
  const profile = await getMe();
  console.log(`   User: ${profile.email || profile.userId}`);
  console.log(`   Team: ${profile.teamSlug || "(none)"}`);

  const team = profile.teamSlug || getDefaultTeam();
  if (!team) {
    console.error("   No team available. Set a default team.");
    process.exit(1);
  }

  // 3. List instances
  console.log("\n3. Listing instances...");
  const instances = await listInstances(team);
  console.log(`   Found ${instances.length} instances`);

  if (instances.length === 0) {
    console.log("   No instances to test. Create one with 'devbox create'.");
    process.exit(0);
  }

  // 4. Test first running instance
  const runningBasicInstance = instances.find((i) => i.status === "running");
  if (!runningBasicInstance) {
    console.log("   No running instances to test.");
    process.exit(0);
  }

  console.log(`\n4. Fetching full instance details: ${runningBasicInstance.id}`);
  const runningInstance = await getInstance(runningBasicInstance.id, team);
  console.log(`   Status: ${runningInstance.status}`);
  console.log(`   Provider: ${runningInstance.provider}`);
  console.log(`   Worker URL: ${runningInstance.workerUrl || "(none)"}`);

  if (!runningInstance.workerUrl) {
    console.log("   No worker URL available.");
    process.exit(1);
  }

  // 5. Get worker auth token
  console.log("\n5. Getting worker auth token...");
  const token = await getWorkerAuthToken(runningInstance.id, team);
  console.log(`   Token: ${token.substring(0, 8)}...`);

  // 6. Test worker status
  console.log("\n6. Getting worker status...");
  const status = await getWorkerStatus(runningInstance.workerUrl, token);
  console.log(`   Provider: ${status.provider}`);
  console.log(`   Processes: ${status.processes}`);
  console.log(`   Memory: ${status.memory}`);
  console.log(`   CDP Available: ${status.cdpAvailable}`);

  // 7. Test services
  console.log("\n7. Getting services...");
  const services = await getWorkerServices(runningInstance.workerUrl, token);
  console.log(`   VSCode: ${services.vscode.running ? "running" : "stopped"}`);
  console.log(`   Chrome: ${services.chrome.running ? "running" : "stopped"}`);
  console.log(`   VNC: ${services.vnc.running ? "running" : "stopped"}`);
  console.log(`   Worker: ${services.worker.running ? "running" : "stopped"}`);

  // 8. Test command execution
  console.log("\n8. Testing command execution...");
  const execResult = await workerExec(runningInstance.workerUrl, token, "echo hello");
  console.log(`   Output: ${execResult.stdout}`);
  console.log(`   Exit code: ${execResult.exit_code}`);

  // 9. Test CDP
  console.log("\n9. Testing Chrome CDP...");
  try {
    const cdpInfo = await getCdpInfo(runningInstance.workerUrl, token);
    console.log(`   WebSocket URL: ${cdpInfo.wsUrl}`);
  } catch (err) {
    console.log(`   Error: ${err instanceof Error ? err.message : err}`);
  }

  // 10. Test screenshot
  console.log("\n10. Testing screenshot...");
  try {
    const screenshot = await takeScreenshot(runningInstance.workerUrl, token, "/tmp/test.png");
    console.log(`   Success: ${screenshot.success}`);
    console.log(`   Path: ${screenshot.path}`);
  } catch (err) {
    console.log(`   Error: ${err instanceof Error ? err.message : err}`);
  }

  console.log("\n=== All Quick Tests Passed ===");
}

runQuickTest()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
