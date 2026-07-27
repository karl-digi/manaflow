import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aggregateByVendor,
  checkAllProvidersStatusWebMode,
} from "./providerStatus";
import type { ProviderStatus } from "@cmux/shared";
import { getAuthToken, runWithAuthToken } from "./requestContext";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

// Mock the Convex client
vi.mock("./convexClient.js", () => ({
  getConvex: () => ({
    query: queryMock,
  }),
}));

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({});
});

describe("aggregateByVendor", () => {
  it("returns empty array for empty input", () => {
    const result = aggregateByVendor([]);
    expect(result).toEqual([]);
  });

  it("groups agents by vendor using catalog lookup", () => {
    // Use exact agent names from the catalog
    const statuses: ProviderStatus[] = [
      { name: "claude/opus-4.5", isAvailable: true },
      { name: "claude/haiku-4.5", isAvailable: false },
    ];

    const result = aggregateByVendor(statuses);

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("anthropic");
    expect(result[0]?.agents).toHaveLength(2);
  });

  it("sets vendor as available if any agent is available", () => {
    const statuses: ProviderStatus[] = [
      { name: "claude/opus-4.5", isAvailable: false },
      { name: "claude/haiku-4.5", isAvailable: true },
    ];

    const result = aggregateByVendor(statuses);

    expect(result[0]?.isAvailable).toBe(true);
  });

  it("sets vendor as unavailable if all agents are unavailable", () => {
    const statuses: ProviderStatus[] = [
      { name: "claude/opus-4.5", isAvailable: false },
      { name: "claude/haiku-4.5", isAvailable: false },
    ];

    const result = aggregateByVendor(statuses);

    expect(result[0]?.isAvailable).toBe(false);
  });

  it("handles multiple vendors", () => {
    // Use exact agent names from the catalog (flagship models only)
    const statuses: ProviderStatus[] = [
      { name: "claude/opus-4.5", isAvailable: true },
      { name: "codex/gpt-5.5", isAvailable: true }, // flagship Codex model
      { name: "gemini/2.5-flash", isAvailable: false },
    ];

    const result = aggregateByVendor(statuses);

    // Should have separate entries for each vendor
    const vendors = result.map((v) => v.name);
    expect(vendors).toContain("anthropic");
    expect(vendors).toContain("openai");
    expect(vendors).toContain("google");
  });

  it("preserves agent availability in agent list", () => {
    const statuses: ProviderStatus[] = [
      { name: "claude/opus-4.5", isAvailable: true },
      { name: "claude/haiku-4.5", isAvailable: false },
    ];

    const result = aggregateByVendor(statuses);

    const vendor = result[0];
    expect(vendor?.agents).toEqual([
      { name: "claude/opus-4.5", isAvailable: true },
      { name: "claude/haiku-4.5", isAvailable: false },
    ]);
  });

  it("assigns unknown vendor for unrecognized agents", () => {
    const statuses: ProviderStatus[] = [
      { name: "unknown-agent/model", isAvailable: true },
    ];

    const result = aggregateByVendor(statuses);

    expect(result[0]?.name).toBe("unknown");
  });
});

describe("checkAllProvidersStatusWebMode", () => {
  it("marks free-tier models as available without API keys", async () => {
    const result = await checkAllProvidersStatusWebMode({
      teamSlugOrId: "test-team",
    });

    // OpenCode models are free-tier and should be available
    const opencodeBigPickle = result.providers.find(
      (p) => p.name === "opencode/big-pickle"
    );
    expect(opencodeBigPickle?.isAvailable).toBe(true);
    expect(opencodeBigPickle?.missingRequirements).toBeUndefined();
  });

  it("marks paid models as unavailable without API keys", async () => {
    const result = await checkAllProvidersStatusWebMode({
      teamSlugOrId: "test-team",
    });

    // Claude models require API keys
    const claudeOpus = result.providers.find(
      (p) => p.name === "claude/opus-4.5"
    );
    expect(claudeOpus?.isAvailable).toBe(false);
    expect(claudeOpus?.missingRequirements).toBeDefined();
  });

  it("marks Codex as available when team-wide Codex credentials are present", async () => {
    queryMock.mockResolvedValueOnce({
      CODEX_AUTH_JSON:
        '{"tokens":{"access_token":"token","refresh_token":"refresh"}}',
      OPENAI_API_KEY: "sk-test-key",
    });

    const result = await checkAllProvidersStatusWebMode({
      teamSlugOrId: "test-team",
    });

    const codex = result.providers.find((p) => p.name === "codex/gpt-5.4");
    expect(codex?.isAvailable).toBe(true);
    expect(codex?.missingRequirements).toBeUndefined();
  });

  it("falls back to the legacy apiKeys.getAll shape when getAllForAgents is unavailable", async () => {
    queryMock
      .mockRejectedValueOnce(new Error("Query not found: api.apiKeys.getAllForAgents"))
      .mockResolvedValueOnce([
        {
          envVar: "OPENAI_API_KEY",
          value: "sk-test-key",
        },
      ]);

    const result = await checkAllProvidersStatusWebMode({
      teamSlugOrId: "test-team",
    });

    const codex = result.providers.find((p) => p.name === "codex/gpt-5.4");
    expect(codex?.isAvailable).toBe(true);
    expect(codex?.missingRequirements).toBeUndefined();
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces API key loading failures instead of masking them as setup needed", async () => {
    queryMock.mockRejectedValueOnce(
      new Error("Query not found: api.apiKeys.getAllForAgents")
    );
    queryMock.mockRejectedValueOnce(
      new Error("Query not found: api.apiKeys.getAll")
    );

    await expect(
      checkAllProvidersStatusWebMode({
        teamSlugOrId: "test-team",
      })
    ).rejects.toThrow("Query not found: api.apiKeys.getAll");
  });

  it("propagates auth token when fetching provider status for socket consumers", async () => {
    const authTokensSeen: Array<string | undefined> = [];
    queryMock.mockImplementationOnce(async () => {
      authTokensSeen.push(getAuthToken());
      return {
        CODEX_AUTH_JSON:
          '{"tokens":{"access_token":"token","refresh_token":"refresh"}}',
      };
    });

    await runWithAuthToken("socket-auth-token", () =>
      checkAllProvidersStatusWebMode({ teamSlugOrId: "test-team" })
    );

    expect(authTokensSeen).toEqual(["socket-auth-token"]);
  });

  it("returns Docker as ready in web mode", async () => {
    const result = await checkAllProvidersStatusWebMode({
      teamSlugOrId: "test-team",
    });

    expect(result.dockerStatus.isRunning).toBe(true);
    expect(result.dockerStatus.version).toBe("web-mode");
  });
});
