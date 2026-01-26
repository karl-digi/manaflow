/**
 * Integration test for E2B sandbox provider.
 *
 * This test verifies:
 * 1. Sandbox can be created
 * 2. Commands can be executed
 * 3. Files can be uploaded/downloaded
 * 4. Host URLs work
 *
 * Requires E2B_API_KEY environment variable.
 *
 * To run:
 *   E2B_API_KEY=your-key bun test e2b
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Sandbox } from "e2b";

// Skip if no API key or if running in CI without credentials
const E2B_API_KEY = process.env.E2B_API_KEY;
const SKIP_E2E = !E2B_API_KEY || process.env.CI === "true";

describe.skipIf(SKIP_E2E)("E2B Provider E2E", () => {
  let sandbox: Sandbox | null = null;

  afterAll(async () => {
    // Cleanup sandbox if it exists
    if (sandbox) {
      try {
        await sandbox.kill();
        console.log("Cleaned up sandbox:", sandbox.sandboxId);
      } catch (error) {
        console.error("Failed to cleanup sandbox:", error);
      }
    }
  });

  it("should create a sandbox from base template", async () => {
    console.log("Creating sandbox...");
    sandbox = await Sandbox.create("base", {
      timeoutMs: 300_000, // 5 minutes
    });

    expect(sandbox).toBeDefined();
    expect(sandbox.sandboxId).toBeTruthy();
    console.log("Created sandbox:", sandbox.sandboxId);
  }, 60000); // 1 minute timeout for creation

  it("should execute a simple command", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    const result = await sandbox.commands.run("echo 'Hello from E2B'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hello from E2B");
    console.log("Command output:", result.stdout);
  });

  it("should execute command and capture exit code", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    // Test successful command
    const success = await sandbox.commands.run("true");
    expect(success.exitCode).toBe(0);

    // Test failing command - E2B throws CommandExitError for non-zero exit codes
    try {
      await sandbox.commands.run("exit 42");
      // If we get here, check exit code
      expect(true).toBe(false); // Should have thrown
    } catch (error) {
      // E2B throws CommandExitError for non-zero exit codes
      expect(error).toBeDefined();
      expect((error as { result?: { exitCode: number } }).result?.exitCode).toBe(42);
    }
  });

  it("should write and read a file", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    const testContent = `Test file content at ${new Date().toISOString()}`;
    const testPath = "/tmp/test-file.txt";

    // Write file
    await sandbox.files.write(testPath, testContent);

    // Read file back
    const content = await sandbox.files.read(testPath);
    expect(content).toBe(testContent);
  });

  it("should upload binary data", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]);
    const testPath = "/tmp/binary-test.bin";

    // Write binary file
    await sandbox.files.write(testPath, binaryData);

    // Verify via command using od (octal dump) which is more commonly available
    const result = await sandbox.commands.run(`od -A x -t x1 ${testPath}`);
    expect(result.exitCode).toBe(0);
    // od output should contain our hex bytes: 00 01 02 03 ff
    expect(result.stdout).toContain("00");
    expect(result.stdout).toContain("01");
    expect(result.stdout).toContain("ff");
  });

  it("should get host URL for a port", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    // Get host URL for a port
    const host = sandbox.getHost(8080);
    expect(host).toBeTruthy();
    expect(host).toContain(sandbox.sandboxId);
    expect(host).toContain("8080");
    console.log("Host URL:", `https://${host}`);
  });

  it("should list files in directory", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    const result = await sandbox.commands.run("ls -la /tmp");
    expect(result.exitCode).toBe(0);
    // Should see the test file we created earlier
    expect(result.stdout).toContain("test-file.txt");
  });

  it("should check sandbox is running", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    const isRunning = await sandbox.isRunning();
    expect(isRunning).toBe(true);
  });
});
