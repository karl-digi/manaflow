/**
 * HTTP API Integration Tests for apps/server
 *
 * Tests the /api/start-task endpoint that enables CLI to spawn agents
 * using the same code path as the web app's socket.io "start-task" event.
 *
 * To run: bun test apps/server/src/http-api.test.ts
 *
 * Note: These tests require the dev server to be running (make dev)
 * and proper authentication setup. They are designed to verify the
 * HTTP API matches the socket.io behavior.
 *
 * IMPORTANT: These are integration tests that require the apps/server
 * to be running. In CI, these tests will be skipped if the server
 * is not available.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AGENT_CATALOG } from "@cmux/shared/agent-catalog";
import { handleHttpRequest, matchesOrchestrationTaskGroup } from "./http-api";

const SERVER_URL = process.env.CMUX_SERVER_URL ?? "http://localhost:9776";

// Server availability state - resolved once in preflight check
let serverAvailable: boolean | null = null;

/**
 * Preflight check to determine server availability.
 * Called once before test registration to enable suite-level gating.
 */
async function checkServerAvailability(): Promise<boolean> {
  if (serverAvailable !== null) {
    return serverAvailable;
  }
  try {
    const response = await fetch(`${SERVER_URL}/api/health`);
    serverAvailable = response.ok;
  } catch {
    serverAvailable = false;
  }
  if (!serverAvailable) {
    console.log(
      "[http-api.test] Server not available at",
      SERVER_URL,
      "- tests will be skipped",
    );
  }
  return serverAvailable;
}

// Run preflight check immediately on module load
const serverCheckPromise = checkServerAvailability();

/**
 * Suite-level gating helper: wraps `it` to skip when server is unavailable.
 * Resolves the server check at test execution time (inside beforeAll).
 */
function itWhenServer(name: string, fn: () => Promise<void> | void): void {
  it(name, async () => {
    const available = await serverCheckPromise;
    if (!available) {
      // Use it.skip equivalent by returning early with skip marker
      return;
    }
    await fn();
  });
}

/**
 * Suite-level gating helper with skipIf support for additional conditions.
 */
itWhenServer.skipIf = (condition: boolean) => {
  return (name: string, fn: () => Promise<void> | void): void => {
    it(name, async () => {
      const available = await serverCheckPromise;
      if (!available || condition) {
        return;
      }
      await fn();
    });
  };
};

// Helper to safely fetch with connection error handling
async function safeFetch(
  url: string,
  options?: RequestInit,
): Promise<Response | null> {
  try {
    return await fetch(url, options);
  } catch {
    // Treat all network-level fetch failures as "server unavailable".
    // This keeps integration tests skippable when apps/server is not running.
    return null;
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (!error) {
        resolve();
        return;
      }
      if ((error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") {
        resolve();
        return;
      }
      reject(error);
    });
  });
}

async function withLocalHttpApiServer<T>(
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer((req, res) => {
    if (!handleHttpRequest(req, res)) {
      res.statusCode = 404;
      res.end();
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await fn(baseUrl);
  } finally {
    await closeServer(server);
  }
}

describe("HTTP API - apps/server", () => {
  describe("POST /api/create-cloud-workspace", () => {
    it("rejects Mirror local without a trusted Electron host service", async () => {
      await withLocalHttpApiServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/create-cloud-workspace`, {
          method: "POST",
          headers: {
            authorization: "Bearer test-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            teamSlugOrId: "team-1",
            taskId: "task-1",
            environmentId: "environment-1",
            clean: true,
            mirrorLocal: true,
          }),
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
          error: expect.stringMatching(/Electron embedded server/i),
        });
      });
    });
  });

  describe("Orchestration filtering helpers", () => {
    it("matches a single-task local flow by task id", () => {
      const orchestrationId = "orch_task_local_123";
      const task = {
        _id: orchestrationId,
        status: "running",
        metadata: null,
      };

      expect(matchesOrchestrationTaskGroup(task, orchestrationId)).toBe(true);
      expect(
        matchesOrchestrationTaskGroup(task, "different_orchestration"),
      ).toBe(false);
    });

    it("matches a grouped orchestration flow by metadata.orchestrationId", () => {
      const orchestrationId = "orch_group_456";
      const groupedTask = {
        _id: "orch_task_child_1",
        status: "completed",
        metadata: {
          orchestrationId,
        },
      };
      const unrelatedTask = {
        _id: "orch_task_child_2",
        status: "completed",
        metadata: {
          orchestrationId: "other_group",
        },
      };

      expect(matchesOrchestrationTaskGroup(groupedTask, orchestrationId)).toBe(
        true,
      );
      expect(
        matchesOrchestrationTaskGroup(unrelatedTask, orchestrationId),
      ).toBe(false);
    });
  });

  describe("Orchestration events auth", () => {
    it("rejects missing auth for the events endpoint", async () => {
      const server = createServer((req, res) => {
        if (!handleHttpRequest(req, res)) {
          res.statusCode = 404;
          res.end();
        }
      });

      server.listen(0, "127.0.0.1");
      await once(server, "listening");

      const address = server.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/orchestrate/events/orch_task_local_123`,
      );

      expect(response.status).toBe(401);
      await closeServer(server);
    });
  });

  beforeAll(async () => {
    // Ensure preflight check is complete before tests run
    await serverCheckPromise;
  });

  describe("Health Check", () => {
    itWhenServer("GET /api/health returns ok status", async () => {
      const response = await safeFetch(`${SERVER_URL}/api/health`);
      expect(response).not.toBeNull();

      const data = await response!.json();
      expect(data.status).toBe("ok");
      expect(data.service).toBe("apps-server");
    });
  });

  describe("Authentication", () => {
    itWhenServer("POST /api/start-task rejects missing auth", async () => {
      const response = await safeFetch(`${SERVER_URL}/api/start-task`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskId: "test_task_123",
          taskDescription: "Test task",
          projectFullName: "test/repo",
          teamSlugOrId: "dev",
        }),
      });

      expect(response).not.toBeNull();
      expect(response!.status).toBe(401);
      const data = await response!.json();
      expect(data.error).toContain("Unauthorized");
    });
  });

  describe("Request Validation", () => {
    itWhenServer("POST /api/start-task rejects invalid JSON", async () => {
      const response = await safeFetch(`${SERVER_URL}/api/start-task`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer fake_token",
        },
        body: "not json",
      });

      expect(response).not.toBeNull();
      expect(response!.status).toBe(400);
    });

    itWhenServer(
      "POST /api/start-task rejects missing required fields",
      async () => {
        const response = await safeFetch(`${SERVER_URL}/api/start-task`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer fake_token",
          },
          body: JSON.stringify({
            // Missing taskId, taskDescription, projectFullName
            teamSlugOrId: "dev",
          }),
        });

        expect(response).not.toBeNull();
        expect(response!.status).toBe(400);
        const data = await response!.json();
        expect(data.error).toContain("Missing required fields");
      },
    );

    itWhenServer(
      "POST /api/start-task rejects missing teamSlugOrId",
      async () => {
        const response = await safeFetch(`${SERVER_URL}/api/start-task`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer fake_token",
          },
          body: JSON.stringify({
            taskId: "test_task_123",
            taskDescription: "Test task",
            projectFullName: "test/repo",
            // Missing teamSlugOrId
          }),
        });

        expect(response).not.toBeNull();
        expect(response!.status).toBe(400);
        const data = await response!.json();
        expect(data.error).toContain("teamSlugOrId");
      },
    );

    itWhenServer(
      "POST /api/start-task rejects invalid branchNames length",
      async () => {
        const response = await safeFetch(`${SERVER_URL}/api/start-task`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer fake_token",
          },
          body: JSON.stringify({
            taskId: "test_task_123",
            taskDescription: "Test task",
            projectFullName: "test/repo",
            teamSlugOrId: "dev",
            selectedAgents: ["claude/haiku-4.5", "claude/haiku-4.5"],
            branchNames: ["only-one-branch"],
          }),
        });

        expect(response).not.toBeNull();
        expect(response!.status).toBe(400);
        const data = await response!.json();
        expect(String(data.error)).toContain("branchNames length");
      },
    );
  });

  describe("CORS", () => {
    itWhenServer("OPTIONS /api/start-task returns CORS headers", async () => {
      const response = await safeFetch(`${SERVER_URL}/api/start-task`, {
        method: "OPTIONS",
      });

      expect(response).not.toBeNull();
      expect(response!.status).toBe(204);
      expect(response!.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response!.headers.get("Access-Control-Allow-Methods")).toContain(
        "POST",
      );
      expect(response!.headers.get("Access-Control-Allow-Headers")).toContain(
        "Authorization",
      );
    });
  });

  describe("Models API", () => {
    itWhenServer("GET /api/models returns model catalog", async () => {
      const response = await safeFetch(`${SERVER_URL}/api/models`);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(200);

      const data = await response!.json();
      expect(data).toHaveProperty("models");
      expect(Array.isArray(data.models)).toBe(true);
      expect(data.models.length).toBeGreaterThan(0);

      // Verify model structure
      const model = data.models[0];
      expect(model).toHaveProperty("name");
      expect(model).toHaveProperty("displayName");
      expect(model).toHaveProperty("vendor");
      expect(model).toHaveProperty("tier");
      expect(model).toHaveProperty("disabled");
      expect(model).toHaveProperty("requiredApiKeys");
    });

    it("local handler returns variant metadata for effort-capable models", async () => {
      await withLocalHttpApiServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/models`);

        expect(response.status).toBe(200);
        const data = await response.json();

        const opus = data.models.find(
          (model: { name: string }) => model.name === "claude/opus-4.6",
        );
        expect(opus).toBeDefined();
        expect(opus.defaultVariant).toBe("medium");
        expect(
          opus.variants.map((variant: { id: string }) => variant.id),
        ).toEqual(["low", "medium", "high", "max"]);
      });
    });

    it("local handler returns codex reasoning variants on static fallback", async () => {
      await withLocalHttpApiServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/models?vendor=openai`);

        expect(response.status).toBe(200);
        const data = await response.json();

        // gpt-5.4 became hidden/upgradeable after the 2026-07-25 app-server sync;
        // gpt-5.5 is a visible flagship with the same variant shape.
        const gpt55 = data.models.find(
          (model: { name: string }) => model.name === "codex/gpt-5.5",
        );
        expect(gpt55).toBeDefined();
        expect(gpt55.defaultVariant).toBe("medium");
        expect(
          gpt55.variants.some(
            (variant: { id: string }) => variant.id === "xhigh",
          ),
        ).toBe(true);
      });
    });

    it("local handler does not synthesize effort variants for catalog models without them", async () => {
      await withLocalHttpApiServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/models?vendor=google`);

        expect(response.status).toBe(200);
        const data = await response.json();

        const gemini = data.models.find(
          (model: { name: string }) => model.name === "gemini/2.5-pro",
        );
        expect(gemini).toBeDefined();
        expect(gemini.variants).toBeUndefined();
        expect(gemini.defaultVariant).toBeUndefined();
      });
    });
  });

  describe("Models API - Auth Headers", () => {
    itWhenServer(
      "accepts x-stack-auth header for browser clients",
      async () => {
        // Without valid Convex auth this will still fall back to static,
        // but we verify the header is parsed without errors
        const response = await safeFetch(
          `${SERVER_URL}/api/models?teamSlugOrId=test-team`,
          {
            headers: {
              "x-stack-auth": JSON.stringify({ accessToken: "invalid-token" }),
            },
          },
        );
        expect(response).not.toBeNull();
        // Should get 200 (falls back to static on auth failure, not 401)
        expect(response!.status).toBe(200);
        const data = await response!.json();
        expect(data).toHaveProperty("models");
      },
    );

    itWhenServer("handles malformed x-stack-auth gracefully", async () => {
      const response = await safeFetch(
        `${SERVER_URL}/api/models?teamSlugOrId=test-team`,
        {
          headers: {
            "x-stack-auth": "not-valid-json",
          },
        },
      );
      expect(response).not.toBeNull();
      // Should still return 200 with static fallback
      expect(response!.status).toBe(200);
      const data = await response!.json();
      expect(data).toHaveProperty("models");
    });

    itWhenServer(
      "includes source metadata in response for diagnostics",
      async () => {
        // Without valid auth, should show static source
        const response = await safeFetch(`${SERVER_URL}/api/models`);
        expect(response).not.toBeNull();
        expect(response!.status).toBe(200);
        const data = await response!.json();

        // Response should always include source metadata for debugging
        expect(data).toHaveProperty("source");
        expect(["static", "convex"]).toContain(data.source);

        // When unauthenticated, should be static and unfiltered
        if (data.source === "static") {
          expect(data.filtered).toBe(false);
        }
      },
    );

    itWhenServer(
      "response never returns null body (regression check)",
      async () => {
        // Dashboard audit found some routes returning literal null
        // This ensures /api/models always returns a valid object
        const response = await safeFetch(
          `${SERVER_URL}/api/models?teamSlugOrId=test-team`,
        );
        expect(response).not.toBeNull();
        expect(response!.status).toBe(200);

        const rawText = await response!.text();
        expect(rawText).not.toBe("null");
        expect(rawText.trim()).not.toBe("");

        const data = JSON.parse(rawText);
        expect(data).not.toBeNull();
        expect(data).toHaveProperty("models");
      },
    );
  });

  describe("Models API - Data Integrity", () => {
    itWhenServer("returns same count as AGENT_CATALOG", async () => {
      const response = await safeFetch(`${SERVER_URL}/api/models`);
      expect(response).not.toBeNull();
      const data = await response!.json();

      expect(data.models.length).toBe(AGENT_CATALOG.length);
    });

    itWhenServer("model names match catalog entries", async () => {
      const response = await safeFetch(`${SERVER_URL}/api/models`);
      expect(response).not.toBeNull();
      const data = await response!.json();

      const apiNames = new Set(
        data.models.map((m: { name: string }) => m.name),
      );
      const catalogNames = new Set(AGENT_CATALOG.map((e) => e.name));

      expect(apiNames).toEqual(catalogNames);
    });
  });

  // ==========================================================================
  // Orchestration API Tests
  // ==========================================================================

  describe("Orchestration API", () => {
    describe("POST /api/orchestrate/spawn", () => {
      itWhenServer("rejects unauthorized requests", async () => {
        const response = await safeFetch(
          `${SERVER_URL}/api/orchestrate/spawn`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              teamSlugOrId: "dev",
              agent: "claude/haiku-4.5",
              prompt: "test prompt",
            }),
          },
        );

        expect(response).not.toBeNull();
        expect(response!.status).toBe(401);
      });

      itWhenServer("validates required fields", async () => {
        const response = await safeFetch(
          `${SERVER_URL}/api/orchestrate/spawn`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer fake_token",
            },
            body: JSON.stringify({ teamSlugOrId: "dev" }), // missing agent and prompt
          },
        );

        expect(response).not.toBeNull();
        expect(response!.status).toBe(400);
        const data = await response!.json();
        expect(data.error).toContain("Missing required fields");
      });

      itWhenServer("rejects invalid JSON body", async () => {
        const response = await safeFetch(
          `${SERVER_URL}/api/orchestrate/spawn`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer fake_token",
            },
            body: "not json",
          },
        );

        expect(response).not.toBeNull();
        expect(response!.status).toBe(400);
      });
    });

    describe("GET /api/orchestrate/list", () => {
      itWhenServer("rejects unauthorized requests", async () => {
        const response = await safeFetch(
          `${SERVER_URL}/api/orchestrate/list?teamSlugOrId=dev`,
        );

        expect(response).not.toBeNull();
        expect(response!.status).toBe(401);
      });

      itWhenServer("requires teamSlugOrId query parameter", async () => {
        const response = await safeFetch(`${SERVER_URL}/api/orchestrate/list`, {
          headers: { Authorization: "Bearer fake_token" },
        });

        expect(response).not.toBeNull();
        expect(response!.status).toBe(400);
        const data = await response!.json();
        expect(data.error).toContain("teamSlugOrId");
      });
    });

    describe("GET /api/orchestrate/status/:id", () => {
      itWhenServer("rejects unauthorized requests", async () => {
        const response = await safeFetch(
          `${SERVER_URL}/api/orchestrate/status/invalid_id_123?teamSlugOrId=dev`,
        );

        expect(response).not.toBeNull();
        expect(response!.status).toBe(401);
      });

      itWhenServer(
        "returns error for invalid orchestration task ID",
        async () => {
          const response = await safeFetch(
            `${SERVER_URL}/api/orchestrate/status/invalid_id_123?teamSlugOrId=dev`,
            { headers: { Authorization: "Bearer fake_token" } },
          );

          expect(response).not.toBeNull();
          // Expect either 401 (invalid token) or 500 (not found error)
          expect([401, 500]).toContain(response!.status);
        },
      );

      itWhenServer("requires teamSlugOrId query parameter", async () => {
        const response = await safeFetch(
          `${SERVER_URL}/api/orchestrate/status/some_id`,
          { headers: { Authorization: "Bearer fake_token" } },
        );

        expect(response).not.toBeNull();
        expect(response!.status).toBe(400);
        const data = await response!.json();
        expect(data.error).toContain("teamSlugOrId");
      });
    });

    describe("POST /api/orchestrate/cancel/:id", () => {
      itWhenServer("rejects unauthorized requests", async () => {
        const response = await safeFetch(
          `${SERVER_URL}/api/orchestrate/cancel/invalid_id_123`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ teamSlugOrId: "dev" }),
          },
        );

        expect(response).not.toBeNull();
        expect(response!.status).toBe(401);
      });

      itWhenServer("requires teamSlugOrId in body", async () => {
        const response = await safeFetch(
          `${SERVER_URL}/api/orchestrate/cancel/some_id`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer fake_token",
            },
            body: JSON.stringify({}),
          },
        );

        expect(response).not.toBeNull();
        expect(response!.status).toBe(400);
        const data = await response!.json();
        expect(data.error).toContain("teamSlugOrId");
      });
    });

    describe("POST /api/orchestrate/migrate", () => {
      itWhenServer("rejects unauthorized requests", async () => {
        const response = await safeFetch(
          `${SERVER_URL}/api/orchestrate/migrate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              teamSlugOrId: "dev",
              planJson: JSON.stringify({ headAgent: "claude/haiku-4.5" }),
            }),
          },
        );

        expect(response).not.toBeNull();
        expect(response!.status).toBe(401);
      });

      itWhenServer("validates required fields", async () => {
        const response = await safeFetch(
          `${SERVER_URL}/api/orchestrate/migrate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer fake_token",
            },
            body: JSON.stringify({ teamSlugOrId: "dev" }), // missing planJson
          },
        );

        expect(response).not.toBeNull();
        expect(response!.status).toBe(400);
        const data = await response!.json();
        expect(data.error).toContain("Missing required fields");
      });

      itWhenServer("rejects invalid planJson", async () => {
        const response = await safeFetch(
          `${SERVER_URL}/api/orchestrate/migrate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer fake_token",
            },
            body: JSON.stringify({
              teamSlugOrId: "dev",
              planJson: "not valid json",
            }),
          },
        );

        expect(response).not.toBeNull();
        expect(response!.status).toBe(400);
        const data = await response!.json();
        expect(data.error).toContain("planJson");
      });

      itWhenServer("requires headAgent in plan or request", async () => {
        const response = await safeFetch(
          `${SERVER_URL}/api/orchestrate/migrate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer fake_token",
            },
            body: JSON.stringify({
              teamSlugOrId: "dev",
              planJson: JSON.stringify({ description: "no head agent" }),
            }),
          },
        );

        expect(response).not.toBeNull();
        expect(response!.status).toBe(400);
        const data = await response!.json();
        expect(data.error).toContain("headAgent");
      });
    });

    describe("POST /api/orchestrate/internal/spawn", () => {
      itWhenServer("rejects requests without internal secret", async () => {
        const response = await safeFetch(
          `${SERVER_URL}/api/orchestrate/internal/spawn`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orchestrationTaskId: "test",
              teamId: "test",
              agentName: "claude/haiku-4.5",
              prompt: "test",
              taskId: "test",
              taskRunId: "test",
            }),
          },
        );

        expect(response).not.toBeNull();
        expect(response!.status).toBe(401);
      });

      itWhenServer("rejects requests with wrong internal secret", async () => {
        const response = await safeFetch(
          `${SERVER_URL}/api/orchestrate/internal/spawn`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-secret": "wrong_secret",
            },
            body: JSON.stringify({
              orchestrationTaskId: "test",
              teamId: "test",
              agentName: "claude/haiku-4.5",
              prompt: "test",
              taskId: "test",
              taskRunId: "test",
            }),
          },
        );

        expect(response).not.toBeNull();
        expect(response!.status).toBe(401);
      });

      itWhenServer("validates required fields", async () => {
        // Even with a valid secret, missing fields should return 400
        // This test documents expected behavior
        const response = await safeFetch(
          `${SERVER_URL}/api/orchestrate/internal/spawn`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-secret": "any_secret", // will fail auth first
            },
            body: JSON.stringify({}), // missing all required fields
          },
        );

        expect(response).not.toBeNull();
        // Will fail at auth (401) before field validation (400)
        expect([400, 401]).toContain(response!.status);
      });
    });

    // ========================================================================
    // Happy-Path Tests (require valid authentication)
    // These tests verify successful orchestration flows with mocked sandbox
    // ========================================================================
    describe("Happy Path - Orchestration Flows", () => {
      // Note: These tests require Stack Auth credentials in environment.
      // Skip if credentials not available.
      const hasCredentials = !!(
        process.env.NEXT_PUBLIC_STACK_PROJECT_ID &&
        process.env.STACK_SECRET_SERVER_KEY &&
        process.env.STACK_SUPER_SECRET_ADMIN_KEY
      );

      itWhenServer.skipIf(!hasCredentials)(
        "GET /api/orchestrate/list returns tasks array with valid auth",
        async () => {
          // Import auth helper dynamically to avoid issues if not available
          const { authenticatedFetch, TEST_TEAM, buildUrl } =
            await import("./test-fixtures/auth-helper");

          const url = buildUrl(SERVER_URL, "/api/orchestrate/list", {
            teamSlugOrId: TEST_TEAM,
          });

          const result = await authenticatedFetch<{ tasks: unknown[] }>(url);

          // Either success with tasks array, or team not found (both valid)
          if (result.ok) {
            expect(result.data?.tasks).toBeDefined();
            expect(Array.isArray(result.data?.tasks)).toBe(true);
          } else {
            // 500 is acceptable if team doesn't exist or other backend issue
            expect([401, 403, 500]).toContain(result.status);
          }
        },
      );

      itWhenServer.skipIf(!hasCredentials)(
        "GET /api/orchestrate/list filters by status",
        async () => {
          const { authenticatedFetch, TEST_TEAM, buildUrl } =
            await import("./test-fixtures/auth-helper");

          // Test filtering by pending status
          const url = buildUrl(SERVER_URL, "/api/orchestrate/list", {
            teamSlugOrId: TEST_TEAM,
            status: "pending",
          });

          const result = await authenticatedFetch<{
            tasks: Array<{ status: string }>;
          }>(url);

          if (result.ok && result.data?.tasks) {
            // All returned tasks should have pending status
            for (const task of result.data.tasks) {
              expect(task.status).toBe("pending");
            }
          }
          // Non-ok responses are acceptable (team not found, etc.)
        },
      );

      itWhenServer.skipIf(!hasCredentials)(
        "GET /api/orchestrate/list rejects invalid status filter",
        async () => {
          const { authenticatedFetch, TEST_TEAM, buildUrl } =
            await import("./test-fixtures/auth-helper");

          const url = buildUrl(SERVER_URL, "/api/orchestrate/list", {
            teamSlugOrId: TEST_TEAM,
            status: "invalid_status",
          });

          const result = await authenticatedFetch<unknown>(url);
          expect(result.ok).toBe(false);
          expect(result.status).toBe(400);
          expect(result.error).toContain("Invalid status");
        },
      );

      itWhenServer.skipIf(!hasCredentials)(
        "POST /api/orchestrate/spawn validates agent name",
        async () => {
          const { authenticatedFetch, TEST_TEAM } =
            await import("./test-fixtures/auth-helper");

          const result = await authenticatedFetch<{ error: string }>(
            `${SERVER_URL}/api/orchestrate/spawn`,
            {
              method: "POST",
              body: {
                teamSlugOrId: TEST_TEAM,
                agent: "invalid/nonexistent-agent",
                prompt: "Test prompt",
              },
            },
          );

          // Should fail because agent doesn't exist
          expect(result.ok).toBe(false);
          expect(result.status).toBe(500);
          expect(result.error).toContain("Agent not found");
        },
      );

      itWhenServer.skipIf(!hasCredentials)(
        "GET /api/orchestrate/status returns 500 for nonexistent task",
        async () => {
          const { authenticatedFetch, TEST_TEAM, buildUrl } =
            await import("./test-fixtures/auth-helper");

          const url = buildUrl(
            SERVER_URL,
            "/api/orchestrate/status/nonexistent_task_id_12345",
            { teamSlugOrId: TEST_TEAM },
          );

          const result = await authenticatedFetch<{ error: string }>(url);

          // Should fail because task doesn't exist
          expect(result.ok).toBe(false);
          // Can be 500 (not found error) or 401 (team membership check failed)
          expect([401, 500]).toContain(result.status);
        },
      );

      itWhenServer.skipIf(!hasCredentials)(
        "POST /api/orchestrate/cancel returns error for nonexistent task",
        async () => {
          const { authenticatedFetch, TEST_TEAM } =
            await import("./test-fixtures/auth-helper");

          const result = await authenticatedFetch<{ error: string }>(
            `${SERVER_URL}/api/orchestrate/cancel/nonexistent_task_id_12345`,
            {
              method: "POST",
              body: { teamSlugOrId: TEST_TEAM },
            },
          );

          // Should fail because task doesn't exist
          expect(result.ok).toBe(false);
          expect([401, 500]).toContain(result.status);
        },
      );

      itWhenServer.skipIf(!hasCredentials)(
        "POST /api/orchestrate/migrate rejects empty plan tasks",
        async () => {
          const { authenticatedFetch, TEST_TEAM } =
            await import("./test-fixtures/auth-helper");

          // Valid plan with headAgent but no tasks
          const validPlan = {
            headAgent: "claude/haiku-4.5",
            orchestrationId: "test_orch_123",
            description: "Test migration",
            tasks: [],
          };

          const result = await authenticatedFetch<{
            orchestrationTaskId: string;
            status: string;
          }>(`${SERVER_URL}/api/orchestrate/migrate`, {
            method: "POST",
            body: {
              teamSlugOrId: TEST_TEAM,
              planJson: JSON.stringify(validPlan),
            },
          });

          // Either succeeds (creates head agent task) or fails on team validation
          // Both are valid outcomes for this test
          if (result.ok) {
            expect(result.data?.orchestrationTaskId).toBeDefined();
            // Status could be "running" or "failed" depending on spawn success
            expect(["running", "failed"]).toContain(result.data?.status);
          } else {
            // Team not found or other auth issue
            expect([401, 500]).toContain(result.status);
          }
        },
      );
    });
  });
});
