/**
 * Integration test for Blaxel sandbox provider.
 *
 * This test verifies:
 * 1. Sandbox can be created
 * 2. Commands can be executed
 * 3. Files can be uploaded/downloaded
 * 4. Preview URLs work
 *
 * Requires BLAXEL_API_KEY (or BL_API_KEY) environment variable.
 *
 * To run:
 *   BLAXEL_API_KEY=your-key bun test blaxel
 */

import { describe, it, expect, afterAll } from "vitest";
import { SandboxInstance } from "@blaxel/core";

// Skip if no API key or if running in CI without credentials
const BLAXEL_API_KEY = process.env.BLAXEL_API_KEY || process.env.BL_API_KEY;
const SKIP_E2E = !BLAXEL_API_KEY || process.env.CI === "true";

// Set the API key for the SDK
if (BLAXEL_API_KEY) {
  process.env.BL_API_KEY = BLAXEL_API_KEY;
}

describe.skipIf(SKIP_E2E)("Blaxel Provider E2E", () => {
  let sandbox: SandboxInstance | null = null;
  let sandboxName: string | null = null;

  afterAll(async () => {
    // Cleanup sandbox if it exists
    if (sandboxName) {
      try {
        await SandboxInstance.delete(sandboxName);
        console.log("Cleaned up sandbox:", sandboxName);
      } catch (error) {
        console.error("Failed to cleanup sandbox:", error);
      }
    }
  });

  it("should create a sandbox", async () => {
    console.log("Creating sandbox...");
    const name = `cmux-test-${Date.now()}`;
    sandbox = await SandboxInstance.create({
      name,
      image: "blaxel/base-image:latest",
      memory: 4096,
      ttl: "30m", // 30 minutes for testing
    });

    expect(sandbox).toBeDefined();
    expect(sandbox.metadata?.name).toBeTruthy();
    sandboxName = sandbox.metadata?.name || null;
    console.log("Created sandbox:", sandboxName);
  }, 120000); // 2 minute timeout for creation

  it("should execute a simple command", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    const result = await sandbox.process.exec({
      command: "echo 'Hello from Blaxel'",
      waitForCompletion: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout || result.logs || "").toContain("Hello from Blaxel");
    console.log("Command output:", result.stdout || result.logs);
  });

  it("should execute command and capture exit code", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    // Test successful command
    const success = await sandbox.process.exec({
      command: "true",
      waitForCompletion: true,
    });
    expect(success.exitCode).toBe(0);

    // Test failing command
    const failure = await sandbox.process.exec({
      command: "exit 42",
      waitForCompletion: true,
    });
    expect(failure.exitCode).toBe(42);
  });

  it("should write and read a file", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    const testContent = `Test file content at ${new Date().toISOString()}`;
    const testPath = "/tmp/test-file.txt";

    // Write file
    await sandbox.fs.write(testPath, testContent);

    // Read file back
    const content = await sandbox.fs.read(testPath);
    expect(content).toBe(testContent);
  });

  it("should upload binary data", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]);
    const testPath = "/tmp/binary-test.bin";

    // Write binary file
    await sandbox.fs.writeBinary(testPath, binaryData);

    // Verify via command using od (octal dump)
    const result = await sandbox.process.exec({
      command: `od -A x -t x1 ${testPath}`,
      waitForCompletion: true,
    });
    expect(result.exitCode).toBe(0);
    const output = result.stdout || result.logs || "";
    // od output should contain our hex bytes: 00 01 02 03 ff
    expect(output).toContain("00");
    expect(output).toContain("01");
    expect(output).toContain("ff");
  });

  it("should list files in directory", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    const result = await sandbox.process.exec({
      command: "ls -la /tmp",
      waitForCompletion: true,
    });
    expect(result.exitCode).toBe(0);
    // Should see the test file we created earlier
    const output = result.stdout || result.logs || "";
    expect(output).toContain("test-file.txt");
  });

  it("should get sandbox metadata", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    expect(sandbox.metadata).toBeDefined();
    expect(sandbox.metadata?.name).toBe(sandboxName);
    console.log("Sandbox metadata:", sandbox.metadata);
  });

  it("should create preview URL for a port", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    // Start a simple HTTP server
    await sandbox.process.exec({
      name: "test-server",
      command: "python3 -m http.server 8080 &",
      waitForCompletion: false,
    });

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Create preview
    const preview = await sandbox.previews.create({
      metadata: { name: "test-preview" },
      spec: { port: 8080, public: true },
    });

    expect(preview.spec?.url).toBeTruthy();
    console.log("Preview URL:", preview.spec?.url);
  });
});
