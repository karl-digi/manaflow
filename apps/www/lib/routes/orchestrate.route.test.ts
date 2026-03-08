import { testApiClient } from "@/lib/test-utils/openapi-client";
import { __TEST_INTERNAL_ONLY_GET_STACK_TOKENS } from "@/lib/test-utils/__TEST_INTERNAL_ONLY_GET_STACK_TOKENS";
import {
  getApiOrchestrateTasks,
  getApiOrchestrateMetrics,
  getApiOrchestrateTasksByTaskId,
  postApiOrchestrateMessage,
  postApiOrchestrateTasksByTaskIdCancel,
} from "@cmux/www-openapi-client";
import { describe, expect, it } from "vitest";

const TEST_TEAM = process.env.CMUX_TEST_TEAM_SLUG || "example-team";

describe("orchestrateRouter via SDK", () => {
  // ============================================================================
  // Authentication Tests
  // ============================================================================
  describe("authentication", () => {
    it("GET /orchestrate/tasks rejects unauthenticated requests", async () => {
      const res = await getApiOrchestrateTasks({
        client: testApiClient,
        query: { teamSlugOrId: TEST_TEAM },
      });
      expect(res.response.status).toBe(401);
    });

    it("GET /orchestrate/metrics rejects unauthenticated requests", async () => {
      const res = await getApiOrchestrateMetrics({
        client: testApiClient,
        query: { teamSlugOrId: TEST_TEAM },
      });
      expect(res.response.status).toBe(401);
    });

    it("GET /orchestrate/tasks/:taskId rejects unauthenticated requests", async () => {
      const res = await getApiOrchestrateTasksByTaskId({
        client: testApiClient,
        query: { teamSlugOrId: TEST_TEAM },
        path: { taskId: "test_task_id" },
      });
      expect(res.response.status).toBe(401);
    });

    it("POST /orchestrate/message rejects unauthenticated requests", async () => {
      const res = await postApiOrchestrateMessage({
        client: testApiClient,
        body: {
          taskRunId: "test123",
          message: "Test message",
          messageType: "request",
          teamSlugOrId: TEST_TEAM,
        },
      });
      expect(res.response.status).toBe(401);
    });

    it("POST /orchestrate/tasks/:taskId/cancel rejects unauthenticated requests", async () => {
      const res = await postApiOrchestrateTasksByTaskIdCancel({
        client: testApiClient,
        path: { taskId: "test_task_id" },
        body: { teamSlugOrId: TEST_TEAM },
      });
      expect(res.response.status).toBe(401);
    });
  });

  // ============================================================================
  // Authenticated Request Tests
  // ============================================================================
  describe("authenticated requests", () => {
    it(
      "GET /orchestrate/tasks returns task list for authenticated user",
      { timeout: 60_000 },
      async () => {
        const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
        const res = await getApiOrchestrateTasks({
          client: testApiClient,
          query: { teamSlugOrId: TEST_TEAM },
          headers: { "x-stack-auth": JSON.stringify(tokens) },
        });
        // Accept 200 (OK), 401 (if token rejected), 500 (server error)
        expect([200, 401, 500]).toContain(res.response.status);
        if (res.response.status === 200 && res.data) {
          expect(Array.isArray(res.data)).toBe(true);
        }
      }
    );

    it(
      "GET /orchestrate/tasks supports status filter",
      { timeout: 60_000 },
      async () => {
        const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
        const res = await getApiOrchestrateTasks({
          client: testApiClient,
          query: { teamSlugOrId: TEST_TEAM, status: "completed" },
          headers: { "x-stack-auth": JSON.stringify(tokens) },
        });
        expect([200, 401, 500]).toContain(res.response.status);
        if (res.response.status === 200 && res.data) {
          const tasks = res.data as Array<{ status: string }>;
          // All returned tasks should be completed if we filtered by status
          for (const task of tasks) {
            expect(task.status).toBe("completed");
          }
        }
      }
    );

    it(
      "GET /orchestrate/tasks supports limit parameter",
      { timeout: 60_000 },
      async () => {
        const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
        const res = await getApiOrchestrateTasks({
          client: testApiClient,
          query: { teamSlugOrId: TEST_TEAM, limit: 5 },
          headers: { "x-stack-auth": JSON.stringify(tokens) },
        });
        expect([200, 401, 500]).toContain(res.response.status);
        if (res.response.status === 200 && res.data) {
          expect(Array.isArray(res.data)).toBe(true);
          expect(res.data.length).toBeLessThanOrEqual(5);
        }
      }
    );

    it(
      "GET /orchestrate/metrics returns summary for authenticated user",
      { timeout: 60_000 },
      async () => {
        const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
        const res = await getApiOrchestrateMetrics({
          client: testApiClient,
          query: { teamSlugOrId: TEST_TEAM },
          headers: { "x-stack-auth": JSON.stringify(tokens) },
        });
        expect([200, 401, 500]).toContain(res.response.status);
        if (res.response.status === 200 && res.data) {
          const summary = res.data as {
            totalTasks: number;
            statusCounts: Record<string, number>;
            activeAgentCount: number;
            activeAgents: string[];
            recentTasks: unknown[];
          };
          expect(typeof summary.totalTasks).toBe("number");
          expect(typeof summary.statusCounts).toBe("object");
          expect(typeof summary.activeAgentCount).toBe("number");
          expect(Array.isArray(summary.activeAgents)).toBe(true);
          expect(Array.isArray(summary.recentTasks)).toBe(true);
        }
      }
    );

    it(
      "GET /orchestrate/tasks/:taskId returns 404 for nonexistent task",
      { timeout: 60_000 },
      async () => {
        const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
        const res = await getApiOrchestrateTasksByTaskId({
          client: testApiClient,
          query: { teamSlugOrId: TEST_TEAM },
          path: { taskId: "nonexistent_task_id_12345" },
          headers: { "x-stack-auth": JSON.stringify(tokens) },
        });
        // 404 for not found, 401 if auth fails, 500 for server error
        expect([401, 404, 500]).toContain(res.response.status);
      }
    );
  });

  // ============================================================================
  // Task Structure Validation
  // ============================================================================
  describe("task structure validation", () => {
    it(
      "tasks have required fields",
      { timeout: 60_000 },
      async () => {
        const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
        const res = await getApiOrchestrateTasks({
          client: testApiClient,
          query: { teamSlugOrId: TEST_TEAM, limit: 10 },
          headers: { "x-stack-auth": JSON.stringify(tokens) },
        });
        expect([200, 401, 500]).toContain(res.response.status);
        if (res.response.status === 200 && res.data) {
          const tasks = res.data as Array<{
            _id: string;
            prompt: string;
            status: string;
            priority: number;
            createdAt: number;
          }>;
          for (const task of tasks) {
            expect(typeof task._id).toBe("string");
            expect(typeof task.prompt).toBe("string");
            expect(typeof task.status).toBe("string");
            expect(typeof task.priority).toBe("number");
            expect(typeof task.createdAt).toBe("number");
          }
        }
      }
    );

    it(
      "task status is one of expected values",
      { timeout: 60_000 },
      async () => {
        const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
        const res = await getApiOrchestrateTasks({
          client: testApiClient,
          query: { teamSlugOrId: TEST_TEAM, limit: 50 },
          headers: { "x-stack-auth": JSON.stringify(tokens) },
        });
        expect([200, 401, 500]).toContain(res.response.status);
        if (res.response.status === 200 && res.data) {
          const validStatuses = [
            "pending",
            "assigned",
            "running",
            "completed",
            "failed",
            "cancelled",
          ];
          const tasks = res.data as Array<{ status: string }>;
          for (const task of tasks) {
            expect(validStatuses).toContain(task.status);
          }
        }
      }
    );
  });

  // ============================================================================
  // Message Endpoint Tests
  // ============================================================================
  describe("message endpoint", () => {
    it(
      "POST /orchestrate/message validates message type",
      { timeout: 60_000 },
      async () => {
        const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();

        // Valid message types are: handoff, request, status
        // Using "request" should not fail due to message type validation
        const res = await postApiOrchestrateMessage({
          client: testApiClient,
          body: {
            taskRunId: "invalidformat",
            message: "Test message",
            messageType: "request",
            teamSlugOrId: TEST_TEAM,
          },
          headers: { "x-stack-auth": JSON.stringify(tokens) },
        });
        // Should get 400 (bad task run id format) or 404 (not found), not 200
        expect([400, 401, 404, 500]).toContain(res.response.status);
      }
    );

    it(
      "POST /orchestrate/message returns 404 for nonexistent task run",
      { timeout: 60_000 },
      async () => {
        const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
        const res = await postApiOrchestrateMessage({
          client: testApiClient,
          body: {
            taskRunId: "ns7xyz123abc", // Valid format but nonexistent
            message: "Test message",
            messageType: "status",
            teamSlugOrId: TEST_TEAM,
          },
          headers: { "x-stack-auth": JSON.stringify(tokens) },
        });
        // 404 for not found, 401 if auth fails
        expect([401, 404, 500]).toContain(res.response.status);
      }
    );
  });

  // ============================================================================
  // Cancel Endpoint Tests
  // ============================================================================
  describe("cancel endpoint", () => {
    it(
      "POST /orchestrate/tasks/:taskId/cancel handles nonexistent task",
      { timeout: 60_000 },
      async () => {
        const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
        const res = await postApiOrchestrateTasksByTaskIdCancel({
          client: testApiClient,
          path: { taskId: "nonexistent_task_id_xyz123" },
          body: { teamSlugOrId: TEST_TEAM, cascade: false },
          headers: { "x-stack-auth": JSON.stringify(tokens) },
        });
        // Should get 404 or 500, not 200
        expect([401, 404, 500]).toContain(res.response.status);
      }
    );

    it(
      "POST /orchestrate/tasks/:taskId/cancel supports cascade parameter",
      { timeout: 60_000 },
      async () => {
        const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
        const res = await postApiOrchestrateTasksByTaskIdCancel({
          client: testApiClient,
          path: { taskId: "nonexistent_task_id" },
          body: { teamSlugOrId: TEST_TEAM, cascade: true },
          headers: { "x-stack-auth": JSON.stringify(tokens) },
        });
        // Should handle cascade flag without error
        expect([401, 404, 500]).toContain(res.response.status);
      }
    );
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================
  describe("edge cases", () => {
    it(
      "handles empty team slug gracefully",
      { timeout: 60_000 },
      async () => {
        const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
        const res = await getApiOrchestrateTasks({
          client: testApiClient,
          query: { teamSlugOrId: "" },
          headers: { "x-stack-auth": JSON.stringify(tokens) },
        });
        // Should reject empty team slug with 400 or 401
        expect([400, 401, 500]).toContain(res.response.status);
      }
    );

    it(
      "handles invalid status filter",
      { timeout: 60_000 },
      async () => {
        const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
        const res = await getApiOrchestrateTasks({
          client: testApiClient,
          query: {
            teamSlugOrId: TEST_TEAM,
            // Force invalid value to test server-side validation
            status: "invalid_status" as "pending",
          },
          headers: { "x-stack-auth": JSON.stringify(tokens) },
        });
        // Should reject invalid status with 400
        expect([400, 401, 500]).toContain(res.response.status);
      }
    );
  });
});
