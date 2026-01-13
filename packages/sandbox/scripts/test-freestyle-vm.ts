#!/usr/bin/env bun
/**
 * Binary search Freestyle VM creation arguments to find what causes the API error.
 * Run with: FREESTYLE_API_KEY=... bun run scripts/test-freestyle-vm.ts
 */
import { freestyle } from "freestyle-sandboxes";

// Test 1: Absolutely minimal - empty object
async function test1() {
  console.log("\n=== Test 1: Empty object ===");
  try {
    const result = await freestyle.vms.create({});
    console.log("SUCCESS:", result.vmId);
    await freestyle.vms.delete({ vmId: result.vmId });
  } catch (e) {
    console.log("FAILED:", e instanceof Error ? e.message : e);
  }
}

// Test 2: Just idleTimeoutSeconds
async function test2() {
  console.log("\n=== Test 2: Just idleTimeoutSeconds ===");
  try {
    const result = await freestyle.vms.create({
      idleTimeoutSeconds: 60,
    });
    console.log("SUCCESS:", result.vmId);
    await freestyle.vms.delete({ vmId: result.vmId });
  } catch (e) {
    console.log("FAILED:", e instanceof Error ? e.message : e);
  }
}

// Test 3: Just persistence
async function test3() {
  console.log("\n=== Test 3: Just persistence ===");
  try {
    const result = await freestyle.vms.create({
      persistence: { type: "ephemeral" as const },
    });
    console.log("SUCCESS:", result.vmId);
    await freestyle.vms.delete({ vmId: result.vmId });
  } catch (e) {
    console.log("FAILED:", e instanceof Error ? e.message : e);
  }
}

// Test 4: Both idleTimeoutSeconds and persistence
async function test4() {
  console.log("\n=== Test 4: idleTimeoutSeconds + persistence ===");
  try {
    const result = await freestyle.vms.create({
      idleTimeoutSeconds: 60,
      persistence: { type: "ephemeral" as const },
    });
    console.log("SUCCESS:", result.vmId);
    await freestyle.vms.delete({ vmId: result.vmId });
  } catch (e) {
    console.log("FAILED:", e instanceof Error ? e.message : e);
  }
}

// Test 5: What the snapshot script uses (long timeout)
async function test5() {
  console.log("\n=== Test 5: 7200s timeout (like snapshot script) ===");
  try {
    const result = await freestyle.vms.create({
      idleTimeoutSeconds: 7200,
      persistence: { type: "ephemeral" as const },
    });
    console.log("SUCCESS:", result.vmId);
    await freestyle.vms.delete({ vmId: result.vmId });
  } catch (e) {
    console.log("FAILED:", e instanceof Error ? e.message : e);
  }
}

// Test 6: With snapshotId (empty string)
async function test6() {
  console.log("\n=== Test 6: With empty snapshotId ===");
  try {
    const result = await freestyle.vms.create({
      idleTimeoutSeconds: 60,
      persistence: { type: "ephemeral" as const },
      snapshotId: "",
    });
    console.log("SUCCESS:", result.vmId);
    await freestyle.vms.delete({ vmId: result.vmId });
  } catch (e) {
    console.log("FAILED:", e instanceof Error ? e.message : e);
  }
}

// Test 7: Check if list works (validates API key)
async function testList() {
  console.log("\n=== Test: List VMs (validates API key) ===");
  try {
    const vms = await freestyle.vms.list();
    console.log("SUCCESS: List returned", vms.length, "VMs");
    return true;
  } catch (e) {
    console.log("FAILED:", e instanceof Error ? e.message : e);
    return false;
  }
}

// Test 8: Check if serverless works
async function testServerless() {
  console.log("\n=== Test: Serverless run ===");
  try {
    const { result } = await freestyle.serverless.runs.create({
      code: `return { test: "hello" };`,
    });
    console.log("SUCCESS:", result);
    return true;
  } catch (e) {
    console.log("FAILED:", e instanceof Error ? e.message : e);
    return false;
  }
}

// Run all tests sequentially
console.log("Testing Freestyle VM creation with different argument combinations...");
console.log("API Key present:", !!process.env.FREESTYLE_API_KEY);

// First check if API key is valid
const listWorks = await testList();
if (!listWorks) {
  console.log("\nAPI key may be invalid - list failed");
  process.exit(1);
}

const serverlessWorks = await testServerless();
console.log("\nServerless works:", serverlessWorks);

console.log("\nNow testing VM creation...");
await test1();
await test2();
await test3();
await test4();
await test5();
await test6();

console.log("\n=== Done ===");
