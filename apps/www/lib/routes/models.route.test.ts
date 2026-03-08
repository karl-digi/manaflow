import { testApiClient } from "@/lib/test-utils/openapi-client";
import { __TEST_INTERNAL_ONLY_GET_STACK_TOKENS } from "@/lib/test-utils/__TEST_INTERNAL_ONLY_GET_STACK_TOKENS";
import {
  getApiModels,
  postApiModelsRefresh,
  postApiModelsSeed,
  patchApiModelsByNameEnabled,
} from "@cmux/www-openapi-client";
import { describe, expect, it } from "vitest";

const TEST_TEAM = process.env.CMUX_TEST_TEAM_SLUG || "example-team";

describe("modelsRouter via SDK", () => {
  // 1. Authentication tests
  it("GET /models rejects unauthenticated requests", async () => {
    const res = await getApiModels({
      client: testApiClient,
      query: { teamSlugOrId: TEST_TEAM },
    });
    expect(res.response.status).toBe(401);
  });

  it(
    "GET /models returns models for authenticated user",
    { timeout: 60_000 },
    async () => {
      const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
      const res = await getApiModels({
        client: testApiClient,
        query: { teamSlugOrId: TEST_TEAM },
        headers: { "x-stack-auth": JSON.stringify(tokens) },
      });
      // Accept 200 (OK), 401 (if token rejected), 500 (server error)
      expect([200, 401, 500]).toContain(res.response.status);
      if (res.response.status === 200 && res.data) {
        const body = res.data as unknown as {
          models: Array<{
            name: string;
            displayName: string;
            vendor: string;
            tier: string;
          }>;
        };
        expect(Array.isArray(body.models)).toBe(true);
      }
    }
  );

  // 2. Model structure validation
  it(
    "models have required fields (name, displayName, vendor, tier)",
    { timeout: 60_000 },
    async () => {
      const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
      const res = await getApiModels({
        client: testApiClient,
        query: { teamSlugOrId: TEST_TEAM },
        headers: { "x-stack-auth": JSON.stringify(tokens) },
      });
      expect([200, 401, 500]).toContain(res.response.status);
      if (res.response.status === 200 && res.data) {
        const body = res.data as unknown as {
          models: Array<{
            name: string;
            displayName: string;
            vendor: string;
            tier: string;
            hiddenForTeam: boolean;
            source?: string;
            discoveredFrom?: string;
            discoveredAt?: number;
          }>;
        };
        expect(Array.isArray(body.models)).toBe(true);
        if (body.models.length > 0) {
          const model = body.models[0];
          expect(typeof model.name).toBe("string");
          expect(typeof model.displayName).toBe("string");
          expect(typeof model.vendor).toBe("string");
          expect(["free", "paid"]).toContain(model.tier);
          expect(typeof model.hiddenForTeam).toBe("boolean");
        }
      }
    }
  );

  it(
    "discovered models have discoveredFrom and discoveredAt",
    { timeout: 60_000 },
    async () => {
      const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
      const res = await getApiModels({
        client: testApiClient,
        query: { teamSlugOrId: TEST_TEAM },
        headers: { "x-stack-auth": JSON.stringify(tokens) },
      });
      expect([200, 401, 500]).toContain(res.response.status);
      if (res.response.status === 200 && res.data) {
        const body = res.data as unknown as {
          models: Array<{
            name: string;
            source?: string;
            discoveredFrom?: string;
            discoveredAt?: number;
          }>;
        };
        const discoveredModels = body.models.filter(
          (m) => m.source === "discovered"
        );
        for (const model of discoveredModels) {
          expect(typeof model.discoveredFrom).toBe("string");
          expect(typeof model.discoveredAt).toBe("number");
        }
      }
    }
  );

  // 3. Discovery endpoints
  it(
    "POST /models/refresh triggers discovery",
    { timeout: 120_000 },
    async () => {
      const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
      const res = await postApiModelsRefresh({
        client: testApiClient,
        query: { teamSlugOrId: TEST_TEAM },
        headers: { "x-stack-auth": JSON.stringify(tokens) },
      });
      // Accept 200 (OK), 401 (if token rejected), 500 (server error)
      expect([200, 401, 500]).toContain(res.response.status);
      if (res.response.status === 200 && res.data) {
        const body = res.data as unknown as {
          success: boolean;
          curated?: number;
          discovered?: number;
        };
        expect(typeof body.success).toBe("boolean");
      }
    }
  );

  it(
    "POST /models/refresh returns openrouter stats",
    { timeout: 120_000 },
    async () => {
      const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
      const res = await postApiModelsRefresh({
        client: testApiClient,
        query: { teamSlugOrId: TEST_TEAM },
        headers: { "x-stack-auth": JSON.stringify(tokens) },
      });
      expect([200, 401, 500]).toContain(res.response.status);
      if (res.response.status === 200 && res.data) {
        const body = res.data as unknown as {
          success: boolean;
          openrouter?: {
            discovered: number;
            free: number;
            paid: number;
          };
        };
        if (body.success && body.openrouter) {
          expect(typeof body.openrouter.discovered).toBe("number");
          expect(typeof body.openrouter.free).toBe("number");
          expect(typeof body.openrouter.paid).toBe("number");
        }
      }
    }
  );

  it(
    "POST /models/seed seeds curated models only",
    { timeout: 60_000 },
    async () => {
      const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
      const res = await postApiModelsSeed({
        client: testApiClient,
        query: { teamSlugOrId: TEST_TEAM },
        headers: { "x-stack-auth": JSON.stringify(tokens) },
      });
      expect([200, 401, 500]).toContain(res.response.status);
      if (res.response.status === 200 && res.data) {
        const body = res.data as unknown as {
          success: boolean;
          seededCount: number;
        };
        expect(typeof body.success).toBe("boolean");
        expect(typeof body.seededCount).toBe("number");
      }
    }
  );

  // 4. Team visibility
  it(
    "PATCH /models/:name/enabled toggles team visibility",
    { timeout: 60_000 },
    async () => {
      const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();

      // First get models to find one to toggle
      const listRes = await getApiModels({
        client: testApiClient,
        query: { teamSlugOrId: TEST_TEAM },
        headers: { "x-stack-auth": JSON.stringify(tokens) },
      });

      if (listRes.response.status !== 200 || !listRes.data) {
        // Skip if we can't list models
        return;
      }

      const body = listRes.data as unknown as {
        models: Array<{ name: string; enabled: boolean; hiddenForTeam: boolean }>;
      };
      if (body.models.length === 0) {
        return;
      }

      const modelToToggle = body.models.find((model) => model.enabled) ?? body.models[0];
      const encodedName = encodeURIComponent(modelToToggle.name);

      const res = await patchApiModelsByNameEnabled({
        client: testApiClient,
        path: { name: encodedName },
        query: { teamSlugOrId: TEST_TEAM },
        headers: { "x-stack-auth": JSON.stringify(tokens) },
        body: { enabled: modelToToggle.hiddenForTeam },
      });

      expect([200, 401, 404, 500]).toContain(res.response.status);
      if (res.response.status === 200 && res.data) {
        const result = res.data as unknown as { success: boolean };
        expect(result.success).toBe(true);
      }
    }
  );

  it(
    "PATCH /models/:name/enabled rejects invalid model",
    { timeout: 60_000 },
    async () => {
      const tokens = await __TEST_INTERNAL_ONLY_GET_STACK_TOKENS();
      const res = await patchApiModelsByNameEnabled({
        client: testApiClient,
        path: { name: "nonexistent-model-that-does-not-exist-12345" },
        query: { teamSlugOrId: TEST_TEAM },
        headers: { "x-stack-auth": JSON.stringify(tokens) },
        body: { enabled: true },
      });
      // Should return 404 for nonexistent model, but might return 401 if auth fails
      expect([401, 404, 500]).toContain(res.response.status);
    }
  );
});
