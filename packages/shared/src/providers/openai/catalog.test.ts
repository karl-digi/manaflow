import { describe, expect, it } from "vitest";
import { CODEX_CATALOG } from "./catalog";

describe("CODEX_CATALOG", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(CODEX_CATALOG)).toBe(true);
    expect(CODEX_CATALOG.length).toBeGreaterThan(0);
  });

  it("all entries have required fields", () => {
    for (const entry of CODEX_CATALOG) {
      expect(entry.name).toBeTruthy();
      expect(entry.displayName).toBeTruthy();
      expect(entry.vendor).toBe("openai");
      expect(Array.isArray(entry.requiredApiKeys)).toBe(true);
      expect(entry.tier).toBeTruthy();
    }
  });

  it("all entries require OPENAI_API_KEY and CODEX_AUTH_JSON", () => {
    for (const entry of CODEX_CATALOG) {
      expect(entry.requiredApiKeys).toContain("OPENAI_API_KEY");
      expect(entry.requiredApiKeys).toContain("CODEX_AUTH_JSON");
    }
  });

  it("has unique model names", () => {
    const names = CODEX_CATALOG.map((e) => e.name);
    const uniqueNames = new Set(names);
    expect(names.length).toBe(uniqueNames.size);
  });

  it("all names follow codex/ prefix pattern", () => {
    for (const entry of CODEX_CATALOG) {
      expect(entry.name).toMatch(/^codex\//);
    }
  });

  it("includes GPT-5.5 as a visible flagship model", () => {
    // Note: app-server catalog uses base name with variants, not suffixes.
    // gpt-5.4/gpt-5.4-mini are hidden/upgradeable after the 2026-07-25 sync;
    // gpt-5.5 remains a visible flagship.
    const gpt55 = CODEX_CATALOG.find((e) => e.name === "codex/gpt-5.5");
    expect(gpt55).toBeDefined();
    // Verify it has xhigh variant
    expect(gpt55?.variants?.some((v) => v.id === "xhigh")).toBe(true);
  });

  it("includes GPT-5.5 as the default-tier visible model", () => {
    const gpt55 = CODEX_CATALOG.find((e) => e.name === "codex/gpt-5.5");
    expect(gpt55).toBeDefined();
    expect(gpt55?.displayName).toBe("GPT-5.5");
  });

  it("all tiers are paid", () => {
    for (const entry of CODEX_CATALOG) {
      expect(entry.tier).toBe("paid");
    }
  });

  it("models with reasoning tag have reasoning variants", () => {
    // Note: app-server catalog uses variants, not suffixes
    for (const entry of CODEX_CATALOG) {
      if (entry.tags?.includes("reasoning")) {
        // Models with reasoning tag should have xhigh/high/medium/low variants
        const hasReasoningVariants = entry.variants?.some(
          (v) =>
            v.id === "xhigh" ||
            v.id === "high" ||
            v.id === "medium" ||
            v.id === "low"
        );
        expect(hasReasoningVariants).toBe(true);
      }
    }
  });
});
