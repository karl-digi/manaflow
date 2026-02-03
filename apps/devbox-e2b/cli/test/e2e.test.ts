/**
 * End-to-end tests for the devbox-e2b CLI
 *
 * These tests require:
 * - Valid authentication (run `devbox login` first)
 * - Access to a team with E2B instances
 *
 * Run with: bun test test/e2e.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  getMe,
  createInstance,
  listInstances,
  getInstance,
  execCommand,
  getWorkerAuthToken,
  getWorkerStatus,
  getWorkerServices,
  getCdpInfo,
  takeScreenshot,
  workerExec,
  workerReadFile,
  workerWriteFile,
  stopInstance,
  type DevboxInstance,
} from "../src/api";
import { isLoggedIn, getAccessToken, getDefaultTeam } from "../src/auth";

// Test instance that will be created and cleaned up
let testInstance: DevboxInstance | null = null;
let testTeamSlugOrId: string | null = null;

// Skip tests if not authenticated
const skipIfNotLoggedIn = () => {
  if (!isLoggedIn()) {
    throw new Error("Not authenticated. Run 'devbox login' first.");
  }
};

describe("devbox-e2b CLI E2E Tests", () => {
  beforeAll(async () => {
    skipIfNotLoggedIn();

    // Get team from default or user profile
    testTeamSlugOrId = getDefaultTeam();
    if (!testTeamSlugOrId) {
      const profile = await getMe();
      testTeamSlugOrId = profile.teamSlug || null;
    }

    if (!testTeamSlugOrId) {
      throw new Error("No team available. Set a default team with 'devbox config set-team <team>'");
    }

    console.log(`Using team: ${testTeamSlugOrId}`);
  });

  afterAll(async () => {
    // Clean up test instance
    if (testInstance && testTeamSlugOrId) {
      console.log(`Cleaning up test instance: ${testInstance.id}`);
      try {
        await stopInstance(testInstance.id, testTeamSlugOrId);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("Authentication", () => {
    it("should be logged in", () => {
      expect(isLoggedIn()).toBe(true);
    });

    it("should get access token", async () => {
      const token = await getAccessToken();
      expect(token).toBeTruthy();
      expect(typeof token).toBe("string");
    });

    it("should get user profile", async () => {
      const profile = await getMe();
      expect(profile).toBeTruthy();
      expect(profile.userId).toBeTruthy();
    });
  });

  describe("Instance Management", () => {
    it("should list instances", async () => {
      const instances = await listInstances(testTeamSlugOrId!);
      expect(Array.isArray(instances)).toBe(true);
    });

    it("should create a new instance", async () => {
      console.log("Creating test instance...");
      testInstance = await createInstance({
        teamSlugOrId: testTeamSlugOrId!,
        name: `e2e-test-${Date.now()}`,
        ttlSeconds: 600, // 10 minutes
      });

      expect(testInstance).toBeTruthy();
      expect(testInstance.id).toBeTruthy();
      expect(testInstance.status).toBe("running");
      expect(testInstance.provider).toBe("e2b");

      console.log(`Created instance: ${testInstance.id}`);
      console.log(`  VSCode: ${testInstance.vscodeUrl}`);
      console.log(`  Worker: ${testInstance.workerUrl}`);
      console.log(`  VNC: ${testInstance.vncUrl}`);

      // Wait for services to start
      console.log("Waiting for services to start...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    });

    it("should get instance details", async () => {
      if (!testInstance) {
        throw new Error("No test instance available");
      }

      const instance = await getInstance(testInstance.id, testTeamSlugOrId!);
      expect(instance).toBeTruthy();
      expect(instance.id).toBe(testInstance.id);
      expect(instance.status).toBe("running");
    });
  });

  describe("Command Execution", () => {
    it("should execute command via E2B API", async () => {
      if (!testInstance) {
        throw new Error("No test instance available");
      }

      const result = await execCommand(testInstance.id, testTeamSlugOrId!, "echo hello");
      expect(result).toBeTruthy();
      expect(result.stdout).toContain("hello");
      expect(result.exit_code).toBe(0);
    });

    it("should get worker auth token", async () => {
      if (!testInstance) {
        throw new Error("No test instance available");
      }

      const token = await getWorkerAuthToken(testInstance.id, testTeamSlugOrId!);
      expect(token).toBeTruthy();
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(0);
    });
  });

  describe("Worker API", () => {
    let workerUrl: string;
    let workerToken: string;

    beforeAll(async () => {
      if (!testInstance?.workerUrl) {
        throw new Error("No test instance with worker URL available");
      }
      workerUrl = testInstance.workerUrl;
      workerToken = await getWorkerAuthToken(testInstance.id, testTeamSlugOrId!);
    });

    it("should get worker status", async () => {
      const status = await getWorkerStatus(workerUrl, workerToken);
      expect(status).toBeTruthy();
      expect(status.provider).toBe("e2b");
      expect(typeof status.processes).toBe("number");
      expect(typeof status.cdpAvailable).toBe("boolean");
    });

    it("should get worker services", async () => {
      const services = await getWorkerServices(workerUrl, workerToken);
      expect(services).toBeTruthy();
      expect(services.vscode).toBeTruthy();
      expect(services.chrome).toBeTruthy();
      expect(services.worker.running).toBe(true);
    });

    it("should execute command via worker", async () => {
      const result = await workerExec(workerUrl, workerToken, "whoami");
      expect(result).toBeTruthy();
      expect(result.exit_code).toBe(0);
      expect(result.stdout).toBeTruthy();
    });

    it("should write and read file via worker", async () => {
      const testPath = "/tmp/test-file.txt";
      const testContent = `test content ${Date.now()}`;

      await workerWriteFile(workerUrl, workerToken, testPath, testContent);
      const readContent = await workerReadFile(workerUrl, workerToken, testPath);

      expect(readContent).toBe(testContent);
    });
  });

  describe("Chrome CDP", () => {
    let workerUrl: string;
    let workerToken: string;

    beforeAll(async () => {
      if (!testInstance?.workerUrl) {
        throw new Error("No test instance with worker URL available");
      }
      workerUrl = testInstance.workerUrl;
      workerToken = await getWorkerAuthToken(testInstance.id, testTeamSlugOrId!);
    });

    it("should get CDP info", async () => {
      const cdpInfo = await getCdpInfo(workerUrl, workerToken);
      expect(cdpInfo).toBeTruthy();
      expect(cdpInfo.wsUrl).toBeTruthy();
      expect(cdpInfo.httpEndpoint).toBeTruthy();
    });

    it("should take a screenshot", async () => {
      const result = await takeScreenshot(workerUrl, workerToken, "/tmp/test-screenshot.png");
      expect(result).toBeTruthy();
      expect(result.success).toBe(true);
      expect(result.path).toBe("/tmp/test-screenshot.png");
    });
  });

  describe("PTY WebSocket", () => {
    it("should connect to PTY and execute commands", async () => {
      if (!testInstance?.workerUrl) {
        throw new Error("No test instance with worker URL available");
      }

      const workerUrl = testInstance.workerUrl;
      const token = await getWorkerAuthToken(testInstance.id, testTeamSlugOrId!);

      // Connect to PTY WebSocket
      const wsUrl = workerUrl.replace("https://", "wss://").replace("http://", "ws://");
      const ptyUrl = `${wsUrl}/pty?token=${token}&cols=80&rows=24`;

      const WebSocket = (await import("ws")).default;

      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(ptyUrl);
        let output = "";
        let sessionId: string | null = null;
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("PTY test timed out"));
        }, 10000);

        ws.on("open", () => {
          console.log("PTY WebSocket connected");
        });

        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === "session") {
              sessionId = msg.id;
              console.log(`PTY session ID: ${sessionId}`);
              // Send a command
              ws.send(JSON.stringify({ type: "data", data: "echo PTY_TEST_SUCCESS\n" }));
            } else if (msg.type === "data") {
              output += msg.data;
              if (output.includes("PTY_TEST_SUCCESS")) {
                console.log("PTY test passed - received expected output");
                clearTimeout(timeout);
                ws.close();
                resolve();
              }
            } else if (msg.type === "exit") {
              clearTimeout(timeout);
              ws.close();
              reject(new Error(`PTY exited with code ${msg.code}`));
            }
          } catch {
            // Ignore parse errors
          }
        });

        ws.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        ws.on("close", () => {
          clearTimeout(timeout);
          if (!output.includes("PTY_TEST_SUCCESS")) {
            reject(new Error("PTY closed without expected output"));
          }
        });
      });
    });
  });
});

// Quick test runner for manual testing
export async function runQuickTest() {
  console.log("=== Quick Test ===\n");

  if (!isLoggedIn()) {
    console.log("Not authenticated. Run 'devbox login' first.");
    return;
  }

  console.log("1. Getting user profile...");
  const profile = await getMe();
  console.log(`   User: ${profile.email || profile.userId}`);
  console.log(`   Team: ${profile.teamSlug || "(none)"}`);

  const team = profile.teamSlug || getDefaultTeam();
  if (!team) {
    console.log("No team available.");
    return;
  }

  console.log("\n2. Listing instances...");
  const instances = await listInstances(team);
  console.log(`   Found ${instances.length} instances`);

  if (instances.length > 0) {
    const instance = instances[0];
    console.log(`\n3. Testing instance: ${instance.id}`);

    if (instance.workerUrl) {
      console.log("\n4. Getting worker auth token...");
      const token = await getWorkerAuthToken(instance.id, team);
      console.log(`   Token: ${token.substring(0, 8)}...`);

      console.log("\n5. Getting worker status...");
      const status = await getWorkerStatus(instance.workerUrl, token);
      console.log(`   Provider: ${status.provider}`);
      console.log(`   CDP Available: ${status.cdpAvailable}`);

      console.log("\n6. Getting CDP info...");
      try {
        const cdpInfo = await getCdpInfo(instance.workerUrl, token);
        console.log(`   WebSocket URL: ${cdpInfo.wsUrl}`);
      } catch (err) {
        console.log(`   Error: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log("\n=== Quick Test Complete ===");
}

// Run quick test if executed directly (not via bun test)
if (import.meta.main && !process.env.BUN_TEST) {
  runQuickTest()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
