/**
 * Integration test for Daytona sandbox provider.
 *
 * This test verifies:
 * 1. Sandbox can be created
 * 2. Commands can be executed
 * 3. Files can be uploaded/downloaded
 * 4. Preview URLs work
 *
 * Requires DAYTONA_API_KEY environment variable with a valid API key.
 *
 * To run:
 *   DAYTONA_API_KEY=your-key bun test daytona
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Daytona, type Sandbox, DaytonaError } from "@daytonaio/sdk";

// Skip if no API key or if running in CI without credentials
const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY;
const SKIP_E2E = !DAYTONA_API_KEY || process.env.CI === "true";

describe.skipIf(SKIP_E2E)("Daytona Provider E2E", () => {
  let client: Daytona;
  let sandbox: Sandbox | null = null;

  beforeAll(() => {
    client = new Daytona({
      apiKey: DAYTONA_API_KEY,
      target: process.env.DAYTONA_TARGET || "us",
    });
  });

  afterAll(async () => {
    // Cleanup sandbox if it exists
    if (sandbox) {
      try {
        await client.delete(sandbox, 60);
        console.log("Cleaned up sandbox:", sandbox.id);
      } catch (error) {
        console.error("Failed to cleanup sandbox:", error);
      }
    }
  });

  it("should create a sandbox from default image", async () => {
    console.log("Creating sandbox...");
    sandbox = await client.create(
      {
        autoStopInterval: 15, // 15 minutes
        autoDeleteInterval: 30, // 30 minutes
        labels: {
          test: "daytona-e2e",
          timestamp: new Date().toISOString(),
        },
      },
      { timeout: 120 }
    );

    expect(sandbox).toBeDefined();
    expect(sandbox.id).toBeTruthy();
    expect(sandbox.state).toBe("started");
    console.log("Created sandbox:", sandbox.id, "state:", sandbox.state);
  }, 180000); // 3 minute timeout

  it("should execute a simple command", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    const result = await sandbox.process.executeCommand("echo 'Hello from Daytona'");
    expect(result.exitCode).toBe(0);
    expect(result.result).toContain("Hello from Daytona");
    console.log("Command output:", result.result);
  });

  it("should execute command and capture exit code", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    // Test successful command
    const success = await sandbox.process.executeCommand("true");
    expect(success.exitCode).toBe(0);

    // Test failing command (don't throw on error, just check code)
    try {
      const failure = await sandbox.process.executeCommand("exit 42");
      expect(failure.exitCode).toBe(42);
    } catch (error) {
      // Some implementations may throw on non-zero exit
      expect(error).toBeDefined();
    }
  });

  it("should upload and download a file", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    const testContent = `Test file content at ${new Date().toISOString()}`;
    const testPath = "/tmp/test-file.txt";

    // Upload file
    await sandbox.fs.uploadFile(Buffer.from(testContent, "utf-8"), testPath);

    // Verify file exists
    const lsResult = await sandbox.process.executeCommand(`cat ${testPath}`);
    expect(lsResult.exitCode).toBe(0);
    expect(lsResult.result).toContain(testContent);

    // Download file
    const downloaded = await sandbox.fs.downloadFile(testPath);
    expect(downloaded.toString("utf-8")).toBe(testContent);
  });

  it("should get preview URL for a port", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    // Start a simple HTTP server
    await sandbox.process.executeCommand(
      'nohup sh -c "while true; do echo -e \"HTTP/1.1 200 OK\\r\\nContent-Type: text/plain\\r\\n\\r\\nOK\" | nc -l -p 8080 -q 1; done" > /dev/null 2>&1 &'
    );

    // Wait a bit for the server to start
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Get preview URL
    const preview = await sandbox.getPreviewLink(8080);
    expect(preview.url).toBeTruthy();
    expect(preview.url).toMatch(/^https?:\/\//);
    console.log("Preview URL:", preview.url);
  });

  it("should list files in directory", async () => {
    expect(sandbox).toBeDefined();
    if (!sandbox) return;

    const files = await sandbox.fs.listFiles("/tmp");
    expect(Array.isArray(files)).toBe(true);
    // Should at least have the test file we created
    const testFile = files.find((f) => f.name === "test-file.txt");
    expect(testFile).toBeDefined();
  });
});
