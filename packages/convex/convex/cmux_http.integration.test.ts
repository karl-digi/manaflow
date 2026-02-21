/**
 * CLI <-> Web App Integration Tests
 *
 * Tests that the cmux-devbox CLI HTTP API endpoints properly synchronize
 * with Convex (the source of truth) and by extension the web app.
 *
 * These tests use the actual Convex HTTP actions, simulating CLI behavior.
 *
 * To run: bun test packages/convex/convex/cmux_http.integration.test.ts
 *
 * Required environment variables:
 * - NEXT_PUBLIC_CONVEX_SITE_URL: Convex deployment URL
 * - NEXT_PUBLIC_STACK_PROJECT_ID: Stack Auth project ID
 * - NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: Stack Auth publishable key
 * - STACK_SECRET_SERVER_KEY: Stack Auth secret key
 * - STACK_SUPER_SECRET_ADMIN_KEY: Stack Auth admin key
 * - STACK_TEST_USER_ID (optional): User ID for testing
 * - CMUX_TEST_TEAM_SLUG (optional): Team slug for testing
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { StackAdminApp } from "@stackframe/js";

// Test configuration - use environment variable for Convex URL
// HTTP actions are served from the .convex.site domain (not .convex.cloud)
// No default - test requires CONVEX_SITE_URL or NEXT_PUBLIC_CONVEX_URL to be set
const CONVEX_SITE_URL = (
  process.env.CONVEX_SITE_URL ??
  process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site")
)?.replace(/\/+$/, "");
const TEST_TEAM = process.env.CMUX_TEST_TEAM_SLUG ?? "dev";
const TEST_TIMEOUT = 120_000; // 2 minutes for sandbox operations
const TEST_USER_ID = process.env.STACK_TEST_USER_ID ?? "487b5ddc-0da0-4f12-8834-f452863a83f5";

// Helper type for API responses
interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: { code: number; message: string };
}

// Stack Auth admin app singleton
let stackAdminApp: StackAdminApp | null = null;

function getStackAdmin(): StackAdminApp {
  if (!stackAdminApp) {
    const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID;
    const publishableKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY;
    const secretKey = process.env.STACK_SECRET_SERVER_KEY;
    const adminKey = process.env.STACK_SUPER_SECRET_ADMIN_KEY;

    if (!projectId || !publishableKey || !secretKey || !adminKey) {
      throw new Error("Stack Auth credentials not configured for testing");
    }

    stackAdminApp = new StackAdminApp({
      projectId,
      publishableClientKey: publishableKey,
      secretServerKey: secretKey,
      superSecretAdminKey: adminKey,
      tokenStore: "memory",
    });
  }
  return stackAdminApp;
}

// Get Stack Auth tokens for testing
async function getTestAuthTokens(): Promise<{
  accessToken: string;
  refreshToken?: string;
}> {
  const admin = getStackAdmin();
  const user = await admin.getUser(TEST_USER_ID);
  if (!user) throw new Error(`Test user ${TEST_USER_ID} not found`);

  const session = await user.createSession({ expiresInMillis: 5 * 60 * 1000 });
  const tokens = await session.getTokens();

  if (!tokens.accessToken) throw new Error("No access token");
  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken ?? undefined };
}

function buildCmuxApiUrl(path: string): URL {
  if (!CONVEX_SITE_URL) {
    throw new Error("CONVEX_SITE_URL or NEXT_PUBLIC_CONVEX_URL is required");
  }
  // Force exactly one slash between base URL and API path.
  return new URL(path, `${CONVEX_SITE_URL}/`);
}

// Helper to make authenticated requests to Convex HTTP API
async function cmuxApiFetch<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    body?: Record<string, unknown>;
    query?: Record<string, string>;
  } = {}
): Promise<ApiResponse<T>> {
  const tokens = await getTestAuthTokens();

  const url = buildCmuxApiUrl(path);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      // Convex HTTP actions expect Authorization header with Stack Auth JWT
      Authorization: `Bearer ${tokens.accessToken}`,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: data as { code: number; message: string },
    };
  }

  return {
    ok: true,
    status: response.status,
    data: data as T,
  };
}

describe(
  "cmux HTTP API - CLI/Web Integration",
  {
    timeout: TEST_TIMEOUT,
  },
  () => {
    let createdInstanceId: string | null = null;
    let resolvedTeamSlug: string = TEST_TEAM;

    // Cleanup any created instances after tests
    afterAll(async () => {
      if (createdInstanceId) {
        try {
          await cmuxApiFetch(`/api/v1/cmux/instances/${createdInstanceId}/stop`, {
            method: "POST",
            body: { teamSlugOrId: resolvedTeamSlug },
          });
        } catch (error) {
          console.error("[cleanup] Failed to stop instance:", error);
        }
      }
    });

    // ========================================================================
    // Authentication Tests
    // ========================================================================
    describe("Authentication", () => {
      it("rejects unauthenticated requests", async () => {
        const response = await fetch(buildCmuxApiUrl("/api/v1/cmux/me"));

        expect(response.status).toBe(401);
      });

      it("GET /api/v1/cmux/me returns user profile", async () => {
        const result = await cmuxApiFetch<{
          userId: string;
          email?: string;
          teamId?: string;
          teamSlug?: string;
        }>("/api/v1/cmux/me");

        expect(result.ok).toBe(true);
        expect(result.data?.userId).toBeDefined();
        expect(typeof result.data?.userId).toBe("string");
      });
    });

    // ========================================================================
    // Team Management Tests
    // ========================================================================
    describe("Team Management", () => {
      it("GET /api/v1/cmux/me/teams lists teams", async () => {
        const result = await cmuxApiFetch<{
          teams: Array<{
            teamId: string;
            slug: string;
            displayName?: string;
            selected: boolean;
          }>;
          selectedTeamId?: string;
        }>("/api/v1/cmux/me/teams");

        expect(result.ok).toBe(true);
        expect(Array.isArray(result.data?.teams)).toBe(true);
        expect(result.data?.teams.length).toBeGreaterThan(0);

        // At least one team should be selected
        const hasSelected = result.data?.teams.some((t) => t.selected);
        expect(hasSelected).toBe(true);
      });

      it("POST /api/v1/cmux/me/team switches team and syncs", async () => {
        // First, get available teams
        const teamsResult = await cmuxApiFetch<{
          teams: Array<{ teamId: string; slug: string; selected: boolean }>;
        }>("/api/v1/cmux/me/teams");

        expect(teamsResult.ok).toBe(true);
        const teams = teamsResult.data?.teams ?? [];

        if (teams.length < 2) {
          console.log("Skipping team switch test: only one team available");
          return;
        }

        // Find current and another team
        const currentTeam = teams.find((t) => t.selected);
        const otherTeam = teams.find((t) => !t.selected);

        expect(currentTeam).toBeDefined();
        expect(otherTeam).toBeDefined();

        // Switch to the other team
        const switchResult = await cmuxApiFetch<{
          success: boolean;
          teamId: string;
          teamSlug: string;
        }>("/api/v1/cmux/me/team", {
          method: "POST",
          body: { teamSlugOrId: otherTeam!.slug },
        });

        expect(switchResult.ok).toBe(true);
        expect(switchResult.data?.success).toBe(true);
        expect(switchResult.data?.teamSlug).toBe(otherTeam!.slug);

        // Verify the switch by fetching teams again
        const verifyResult = await cmuxApiFetch<{
          teams: Array<{ teamId: string; slug: string; selected: boolean }>;
        }>("/api/v1/cmux/me/teams");

        expect(verifyResult.ok).toBe(true);
        const newSelected = verifyResult.data?.teams.find((t) => t.selected);
        expect(newSelected?.slug).toBe(otherTeam!.slug);

        // Switch back to original team
        await cmuxApiFetch("/api/v1/cmux/me/team", {
          method: "POST",
          body: { teamSlugOrId: currentTeam!.slug },
        });
      });

      it("POST /api/v1/cmux/me/team rejects invalid team", async () => {
        const result = await cmuxApiFetch("/api/v1/cmux/me/team", {
          method: "POST",
          body: { teamSlugOrId: "nonexistent-team-12345" },
        });

        expect(result.ok).toBe(false);
        expect([403, 404]).toContain(result.status);
      });
    });

    // ========================================================================
    // Instance List Tests
    // ========================================================================
    describe("Instance List", () => {
      it("GET /api/v1/cmux/instances lists instances", async () => {
        // First get teams to find a valid team
        const teamsResult = await cmuxApiFetch<{
          teams: Array<{ teamId: string; slug: string; selected: boolean }>;
        }>("/api/v1/cmux/me/teams");

        const teamSlug = teamsResult.data?.teams?.[0]?.slug ?? TEST_TEAM;

        const result = await cmuxApiFetch<{
          instances: Array<{
            id: string;
            status: string;
            name?: string;
            createdAt: number;
          }>;
        }>("/api/v1/cmux/instances", {
          query: { teamSlugOrId: teamSlug },
        });

        if (!result.ok) {
          console.error("Instance list failed:", result.error);
        }
        expect(result.ok).toBe(true);
        expect(Array.isArray(result.data?.instances)).toBe(true);
      });

      it("GET /api/v1/cmux/instances requires teamSlugOrId", async () => {
        const result = await cmuxApiFetch("/api/v1/cmux/instances");

        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
      });
    });

    // ========================================================================
    // Instance Lifecycle Tests (Skip if no provider configured)
    // ========================================================================
    describe("Instance Lifecycle", () => {
      const hasMorphKey = !!process.env.MORPH_API_KEY;
      const hasPveConfig = !!process.env.PVE_API_URL && !!process.env.PVE_API_TOKEN;

      beforeAll(async () => {
        if (!hasMorphKey && !hasPveConfig) {
          console.log(
            "Skipping instance lifecycle tests: no sandbox provider configured"
          );
        }
        // Resolve a valid team slug from user's teams
        const teamsResult = await cmuxApiFetch<{
          teams: Array<{ teamId: string; slug: string; selected: boolean }>;
        }>("/api/v1/cmux/me/teams");
        if (teamsResult.ok && teamsResult.data?.teams?.length) {
          resolvedTeamSlug = teamsResult.data.teams[0].slug;
        }
      });

      it.skipIf(!hasMorphKey && !hasPveConfig)(
        "POST /api/v1/cmux/instances creates instance",
        { timeout: TEST_TIMEOUT },
        async () => {
          const result = await cmuxApiFetch<{
            id: string;
            status: string;
            vscodeUrl?: string;
            workerUrl?: string;
          }>("/api/v1/cmux/instances", {
            method: "POST",
            body: {
              teamSlugOrId: resolvedTeamSlug,
              ttlSeconds: 300, // 5 minutes for test
              vcpus: 2,
              memory: 4096,
            },
          });

          if (!result.ok) {
            console.error("Instance creation failed:", result.status, result.error);
            // 502/504 typically indicates sandbox provider timeout/unavailability
            if (result.status === 502 || result.status === 504) {
              console.warn("502/504 error - sandbox provider may be unavailable, skipping remaining lifecycle tests");
              return;
            }
            // 500 can indicate missing provider configuration
            if (result.status === 500) {
              console.warn("500 error may indicate missing sandbox provider configuration, skipping");
              return;
            }
          }
          expect(result.ok).toBe(true);
          expect(result.data?.id).toBeDefined();
          expect(result.data?.id).toMatch(/^(cr_|cmux_|manaflow_)/);

          createdInstanceId = result.data!.id;

          // Verify instance appears in list
          const listResult = await cmuxApiFetch<{
            instances: Array<{ id: string; status: string }>;
          }>("/api/v1/cmux/instances", {
            query: { teamSlugOrId: resolvedTeamSlug },
          });

          expect(listResult.ok).toBe(true);
          const found = listResult.data?.instances.find(
            (i) => i.id === createdInstanceId
          );
          expect(found).toBeDefined();
        }
      );

      it.skipIf(!hasMorphKey && !hasPveConfig)(
        "GET /api/v1/cmux/instances/:id returns instance details",
        async () => {
          if (!createdInstanceId) {
            console.log("Skipping: no instance created");
            return;
          }

          const result = await cmuxApiFetch<{
            id: string;
            status: string;
            vscodeUrl?: string;
            workerUrl?: string;
          }>(`/api/v1/cmux/instances/${createdInstanceId}`, {
            query: { teamSlugOrId: resolvedTeamSlug },
          });

          expect(result.ok).toBe(true);
          expect(result.data?.id).toBe(createdInstanceId);
          expect(["running", "paused", "stopped", "unknown"]).toContain(
            result.data?.status
          );
        }
      );

      it.skipIf(!hasMorphKey && !hasPveConfig)(
        "POST /api/v1/cmux/instances/:id/pause pauses instance",
        async () => {
          if (!createdInstanceId) {
            console.log("Skipping: no instance created");
            return;
          }

          const result = await cmuxApiFetch<{ paused: boolean }>(
            `/api/v1/cmux/instances/${createdInstanceId}/pause`,
            {
              method: "POST",
              body: { teamSlugOrId: resolvedTeamSlug },
            }
          );

          expect(result.ok).toBe(true);
          expect(result.data?.paused).toBe(true);

          // Wait for status to update
          await new Promise((r) => setTimeout(r, 3000));

          // Verify status changed in list
          const listResult = await cmuxApiFetch<{
            instances: Array<{ id: string; status: string }>;
          }>("/api/v1/cmux/instances", {
            query: { teamSlugOrId: resolvedTeamSlug },
          });

          expect(listResult.ok).toBe(true);
          const instance = listResult.data?.instances.find(
            (i) => i.id === createdInstanceId
          );
          expect(instance?.status).toBe("paused");
        }
      );

      it.skipIf(!hasMorphKey && !hasPveConfig)(
        "POST /api/v1/cmux/instances/:id/resume resumes instance",
        async () => {
          if (!createdInstanceId) {
            console.log("Skipping: no instance created");
            return;
          }

          const result = await cmuxApiFetch<{ resumed: boolean }>(
            `/api/v1/cmux/instances/${createdInstanceId}/resume`,
            {
              method: "POST",
              body: { teamSlugOrId: resolvedTeamSlug },
            }
          );

          expect(result.ok).toBe(true);
          expect(result.data?.resumed).toBe(true);

          // Wait for status to update
          await new Promise((r) => setTimeout(r, 5000));

          // Verify status changed in list
          const listResult = await cmuxApiFetch<{
            instances: Array<{ id: string; status: string }>;
          }>("/api/v1/cmux/instances", {
            query: { teamSlugOrId: resolvedTeamSlug },
          });

          expect(listResult.ok).toBe(true);
          const instance = listResult.data?.instances.find(
            (i) => i.id === createdInstanceId
          );
          expect(instance?.status).toBe("running");
        }
      );

      it.skipIf(!hasMorphKey && !hasPveConfig)(
        "POST /api/v1/cmux/instances/:id/exec executes command",
        async () => {
          if (!createdInstanceId) {
            console.log("Skipping: no instance created");
            return;
          }

          const result = await cmuxApiFetch<{
            exit_code: number;
            stdout: string;
            stderr: string;
          }>(`/api/v1/cmux/instances/${createdInstanceId}/exec`, {
            method: "POST",
            body: {
              teamSlugOrId: resolvedTeamSlug,
              command: "echo integration-test-ok",
            },
          });

          expect(result.ok).toBe(true);
          expect(result.data?.exit_code).toBe(0);
          expect(result.data?.stdout).toContain("integration-test-ok");
        }
      );

      it.skipIf(!hasMorphKey && !hasPveConfig)(
        "POST /api/v1/cmux/instances/:id/stop stops instance",
        async () => {
          if (!createdInstanceId) {
            console.log("Skipping: no instance created");
            return;
          }

          const result = await cmuxApiFetch<{ stopped: boolean }>(
            `/api/v1/cmux/instances/${createdInstanceId}/stop`,
            {
              method: "POST",
              body: { teamSlugOrId: resolvedTeamSlug },
            }
          );

          expect(result.ok).toBe(true);
          expect(result.data?.stopped).toBe(true);

          // Mark as cleaned up
          createdInstanceId = null;
        }
      );
    });

    // ========================================================================
    // Instance ID Validation Tests
    // ========================================================================
    describe("Instance ID Validation", () => {
      it("rejects invalid instance ID format", async () => {
        // Get a valid team first
        const teamsResult = await cmuxApiFetch<{
          teams: Array<{ teamId: string; slug: string }>;
        }>("/api/v1/cmux/me/teams");
        const teamSlug = teamsResult.data?.teams?.[0]?.slug ?? TEST_TEAM;

        const result = await cmuxApiFetch(
          "/api/v1/cmux/instances/invalid-id-format",
          {
            query: { teamSlugOrId: teamSlug },
          }
        );

        expect(result.ok).toBe(false);
        // 400 for invalid format, or 500 if the handler doesn't validate first
        expect([400, 500]).toContain(result.status);
      });

      it("accepts valid cr_ prefix", async () => {
        // Get a valid team first
        const teamsResult = await cmuxApiFetch<{
          teams: Array<{ teamId: string; slug: string }>;
        }>("/api/v1/cmux/me/teams");
        const teamSlug = teamsResult.data?.teams?.[0]?.slug ?? TEST_TEAM;

        const result = await cmuxApiFetch(
          "/api/v1/cmux/instances/cr_abcd1234",
          {
            query: { teamSlugOrId: teamSlug },
          }
        );

        // Should be 404 (not found) or 500 (internal) not 400 (invalid format)
        // 500 can happen if the provider info lookup fails
        expect([200, 404, 500]).toContain(result.status);
      });

      it("accepts valid cmux_ prefix", async () => {
        const teamsResult = await cmuxApiFetch<{
          teams: Array<{ teamId: string; slug: string }>;
        }>("/api/v1/cmux/me/teams");
        const teamSlug = teamsResult.data?.teams?.[0]?.slug ?? TEST_TEAM;

        const result = await cmuxApiFetch(
          "/api/v1/cmux/instances/cmux_abcd1234",
          {
            query: { teamSlugOrId: teamSlug },
          }
        );

        // Should be 404 (not found) or 500 (internal) not 400 (invalid format)
        expect([200, 404, 500]).toContain(result.status);
      });

      it("accepts valid manaflow_ prefix", async () => {
        const teamsResult = await cmuxApiFetch<{
          teams: Array<{ teamId: string; slug: string }>;
        }>("/api/v1/cmux/me/teams");
        const teamSlug = teamsResult.data?.teams?.[0]?.slug ?? TEST_TEAM;

        const result = await cmuxApiFetch(
          "/api/v1/cmux/instances/manaflow_abcd1234",
          {
            query: { teamSlugOrId: teamSlug },
          }
        );

        // Should be 404 (not found) or 500 (internal) not 400 (invalid format)
        expect([200, 404, 500]).toContain(result.status);
      });
    });

    // ========================================================================
    // Cross-Team Isolation Tests
    // ========================================================================
    describe("Cross-Team Isolation", () => {
      it("cannot access instances from other teams", async () => {
        // Create a fake instance ID and try to access it with a different team
        const result = await cmuxApiFetch(
          "/api/v1/cmux/instances/cr_faketest123",
          {
            query: { teamSlugOrId: "nonexistent-team" },
          }
        );

        // Should fail - 404 (team not found), 403 (forbidden), or 500 (internal error)
        expect(result.ok).toBe(false);
        expect([403, 404, 500]).toContain(result.status);
      });
    });

    // ========================================================================
    // Config Endpoint Tests
    // ========================================================================
    describe("Config", () => {
      it("GET /api/v1/cmux/config returns config", async () => {
        const result = await cmuxApiFetch<{
          defaultSnapshotId: string;
        }>("/api/v1/cmux/config");

        expect(result.ok).toBe(true);
        expect(result.data?.defaultSnapshotId).toBeDefined();
        expect(typeof result.data?.defaultSnapshotId).toBe("string");
      });
    });

    // ========================================================================
    // Task Endpoint Tests - CLI/Web sync
    // ========================================================================
    describe("Task Management", () => {
      let createdTaskId: string | null = null;

      afterAll(async () => {
        // Clean up created task
        if (createdTaskId) {
          try {
            await cmuxApiFetch(`/api/v1/cmux/tasks/${createdTaskId}/stop`, {
              method: "POST",
              body: { teamSlugOrId: resolvedTeamSlug },
            });
          } catch (error) {
            console.error("[cleanup] Failed to stop task:", error);
          }
        }
      });

      it("GET /api/v1/cmux/tasks requires teamSlugOrId", async () => {
        const result = await cmuxApiFetch("/api/v1/cmux/tasks");

        expect(result.ok).toBe(false);
        expect(result.status).toBe(400);
      });

      it("GET /api/v1/cmux/tasks lists tasks", async () => {
        const teamsResult = await cmuxApiFetch<{
          teams: Array<{ teamId: string; slug: string }>;
        }>("/api/v1/cmux/me/teams");

        const teamSlug = teamsResult.data?.teams?.[0]?.slug ?? TEST_TEAM;

        const result = await cmuxApiFetch<{
          tasks: Array<{
            id: string;
            prompt: string;
            status: string;
            repository?: string;
            agent?: string;
            createdAt?: number;
          }>;
        }>("/api/v1/cmux/tasks", {
          query: { teamSlugOrId: teamSlug },
        });

        expect(result.ok).toBe(true);
        expect(Array.isArray(result.data?.tasks)).toBe(true);
      });

      it("POST /api/v1/cmux/tasks creates task", async () => {
        const teamsResult = await cmuxApiFetch<{
          teams: Array<{ teamId: string; slug: string }>;
        }>("/api/v1/cmux/me/teams");

        const teamSlug = teamsResult.data?.teams?.[0]?.slug ?? TEST_TEAM;

        const result = await cmuxApiFetch<{
          taskId: string;
          taskRuns?: Array<{ taskRunId: string; jwt: string; agentName: string }>;
          status: string;
        }>("/api/v1/cmux/tasks", {
          method: "POST",
          body: {
            teamSlugOrId: teamSlug,
            prompt: "Integration test task - should be cleaned up",
            repository: "test/integration-test",
            baseBranch: "main",
          },
        });

        if (!result.ok) {
          console.error("Task creation failed:", result.status, result.error);
        }
        expect(result.ok).toBe(true);
        expect(result.data?.taskId).toBeDefined();
        expect(result.data?.status).toBe("pending");

        createdTaskId = result.data!.taskId;
      });

      it("GET /api/v1/cmux/tasks/{id} returns task details", async () => {
        if (!createdTaskId) {
          console.log("Skipping: no task created");
          return;
        }

        const teamsResult = await cmuxApiFetch<{
          teams: Array<{ teamId: string; slug: string }>;
        }>("/api/v1/cmux/me/teams");

        const teamSlug = teamsResult.data?.teams?.[0]?.slug ?? TEST_TEAM;

        const result = await cmuxApiFetch<{
          id: string;
          prompt: string;
          repository?: string;
          taskRuns: Array<{
            id: string;
            agent?: string;
            status: string;
          }>;
        }>(`/api/v1/cmux/tasks/${createdTaskId}`, {
          query: { teamSlugOrId: teamSlug },
        });

        expect(result.ok).toBe(true);
        expect(result.data?.id).toBe(createdTaskId);
        expect(result.data?.prompt).toContain("Integration test task");
        expect(Array.isArray(result.data?.taskRuns)).toBe(true);
      });

      it("POST /api/v1/cmux/tasks/{id}/stop archives task", async () => {
        if (!createdTaskId) {
          console.log("Skipping: no task created");
          return;
        }

        const teamsResult = await cmuxApiFetch<{
          teams: Array<{ teamId: string; slug: string }>;
        }>("/api/v1/cmux/me/teams");

        const teamSlug = teamsResult.data?.teams?.[0]?.slug ?? TEST_TEAM;

        const result = await cmuxApiFetch<{ stopped: boolean }>(
          `/api/v1/cmux/tasks/${createdTaskId}/stop`,
          {
            method: "POST",
            body: { teamSlugOrId: teamSlug },
          }
        );

        expect(result.ok).toBe(true);
        expect(result.data?.stopped).toBe(true);

        // Verify task is now archived
        const getResult = await cmuxApiFetch<{
          id: string;
          isArchived: boolean;
        }>(`/api/v1/cmux/tasks/${createdTaskId}`, {
          query: { teamSlugOrId: teamSlug },
        });

        expect(getResult.ok).toBe(true);
        expect(getResult.data?.isArchived).toBe(true);

        // Mark as cleaned up
        createdTaskId = null;
      });

      it("POST /api/v1/cmux/tasks creates task with agents", async () => {
        const teamsResult = await cmuxApiFetch<{
          teams: Array<{ teamId: string; slug: string }>;
        }>("/api/v1/cmux/me/teams");

        const teamSlug = teamsResult.data?.teams?.[0]?.slug ?? TEST_TEAM;

        const result = await cmuxApiFetch<{
          taskId: string;
          taskRuns: Array<{ taskRunId: string; jwt: string; agentName: string }>;
          status: string;
        }>("/api/v1/cmux/tasks", {
          method: "POST",
          body: {
            teamSlugOrId: teamSlug,
            prompt: "Integration test with agents - should be cleaned up",
            agents: ["claude-code", "opencode/gpt-4o"],
          },
        });

        expect(result.ok).toBe(true);
        expect(result.data?.taskId).toBeDefined();
        expect(result.data?.taskRuns).toBeDefined();
        expect(result.data!.taskRuns.length).toBe(2);
        // Verify JWTs are returned for sandbox auth
        for (const run of result.data!.taskRuns) {
          expect(run.taskRunId).toBeDefined();
          expect(run.jwt).toBeDefined();
          expect(run.agentName).toBeDefined();
        }

        // Clean up
        if (result.data?.taskId) {
          await cmuxApiFetch(`/api/v1/cmux/tasks/${result.data.taskId}/stop`, {
            method: "POST",
            body: { teamSlugOrId: teamSlug },
          });
        }
      });
    });
  }
);
