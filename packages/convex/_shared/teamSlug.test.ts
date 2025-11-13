import { describe, expect, test } from "vitest";
import {
  buildSlugCandidate,
  deriveSlugSuffix,
  extractSlugFromMetadata,
  normalizeSlug,
  slugifyTeamName,
  validateSlug,
} from "./teamSlug";

describe("teamSlug helpers", () => {
  test("normalizeSlug trims and lowercases input", () => {
    expect(normalizeSlug("  My-Slug  ")).toBe("my-slug");
  });

  test("validateSlug rejects short slugs", () => {
    expect(() => validateSlug("ab")).toThrowError(
      "Slug must be 3–48 characters long",
    );
  });

  test("validateSlug rejects invalid characters", () => {
    expect(() => validateSlug("bad slug")).toThrowError(
      "Slug can contain lowercase letters, numbers, and hyphens, and must start/end with a letter or number",
    );
  });

  test("slugifyTeamName produces lowercase hyphenated names", () => {
    expect(slugifyTeamName("Frontend Wizards!")).toBe("frontend-wizards");
  });

  test("slugifyTeamName extracts email local part", () => {
    expect(slugifyTeamName("user@example.com")).toBe("user");
    expect(slugifyTeamName("lawrencecchen@berkeley.edu's Team")).toBe(
      "lawrencecchen",
    );
  });

  test("deriveSlugSuffix uses sanitized team id", async () => {
    await expect(
      deriveSlugSuffix("550e8400-e29b-41d4-a716-446655440000"),
    ).resolves.toBe("550");
    const fallback = await deriveSlugSuffix("@@id");
    expect(fallback).toMatch(/^[a-z0-9]{3}$/);
  });

  test("buildSlugCandidate combines name and suffix", async () => {
    const slug = await buildSlugCandidate(
      "550e8400-e29b-41d4-a716-446655440000",
      "Frontend Wizards",
      0,
    );
    expect(slug).toBe("frontend-wizards-550");
  });

  test("buildSlugCandidate appends attempt suffix", async () => {
    const slug = await buildSlugCandidate(
      "550e8400-e29b-41d4-a716-446655440000",
      "Frontend Wizards",
      2,
    );
    expect(slug).toBe("frontend-wizards-550-2");
  });

  test("buildSlugCandidate respects maximum length", async () => {
    const longName = "A".repeat(80);
    const slug = await buildSlugCandidate(
      "550e8400-e29b-41d4-a716-446655440000",
      longName,
      5,
    );
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(() => validateSlug(slug)).not.toThrow();
  });

  test("buildSlugCandidate handles email names", async () => {
    const slug = await buildSlugCandidate(
      "2e0f8400-e29b-41d4-a716-446655440000",
      "lawrencecchen@berkeley.edu's Team",
      0,
    );
    expect(slug).toMatch(/^lawrencecchen-[a-z0-9]{3}$/);
  });

  test("extractSlugFromMetadata normalizes valid slug", () => {
    const slug = extractSlugFromMetadata({ slug: "  My-Team  " });
    expect(slug).toBe("my-team");
  });

  test("extractSlugFromMetadata ignores invalid slug", () => {
    expect(extractSlugFromMetadata({ slug: "!" })).toBeUndefined();
  });
});
