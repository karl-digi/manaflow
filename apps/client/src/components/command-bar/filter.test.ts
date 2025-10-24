import { describe, expect, test } from "vitest";
import { enhancedFilter } from "./filter";

describe("enhancedFilter", () => {
  test("returns 1.0 for empty search", () => {
    expect(enhancedFilter("anything", "")).toBe(1.0);
  });

  test("perfect match returns highest score", () => {
    const score = enhancedFilter("home", "home");
    expect(score).toBe(1.0);
  });

  test("prefix match returns high score", () => {
    const score = enhancedFilter("home dashboard", "home");
    expect(score).toBeGreaterThan(0.9);
  });

  test("acronym matching works", () => {
    // "npr" matches "New Pull Request"
    const score = enhancedFilter("New Pull Request", "npr");
    expect(score).toBeGreaterThan(0.85);
  });

  test("acronym matching works with keywords", () => {
    const score = enhancedFilter("pull-requests", "pr", ["pull", "requests", "pr", "prs"]);
    expect(score).toBeGreaterThan(0.8);
  });

  test("strips number prefixes from task values", () => {
    // Task items have format "1:task:id" but we want to search on "task"
    const score = enhancedFilter("1:task:some-id", "task");
    expect(score).toBeGreaterThan(0.9);
  });

  test("word start matching works", () => {
    const score = enhancedFilter("System Theme", "theme");
    expect(score).toBeGreaterThan(0.8);
  });

  test("keyword matching works", () => {
    const score = enhancedFilter("settings", "config", ["settings", "preferences", "config"]);
    expect(score).toBeGreaterThan(0.75);
  });

  test("word start matching prioritizes word boundaries", () => {
    // "dash" matches word start "dashboard" in both cases
    const score1 = enhancedFilter("home dashboard", "dash");
    const score2 = enhancedFilter("something else dashboard", "dash");
    // Both match word start, so scores should be similar
    expect(score1).toBeGreaterThan(0.8);
    expect(score2).toBeGreaterThan(0.8);
  });

  test("fuzzy matching works", () => {
    // Should match even with skipped characters
    const score = enhancedFilter("environments", "envs");
    expect(score).toBeGreaterThan(0.25);
  });

  test("no match returns 0", () => {
    const score = enhancedFilter("home", "xyz");
    expect(score).toBe(0);
  });

  test("case insensitive matching", () => {
    const score1 = enhancedFilter("Home", "home");
    const score2 = enhancedFilter("home", "HOME");
    expect(score1).toBe(1.0);
    expect(score2).toBe(1.0);
  });

  test("handles multi-word queries", () => {
    const score = enhancedFilter("New Pull Request", "pull request");
    expect(score).toBeGreaterThan(0.6);
  });

  test("acronym with separator variations", () => {
    expect(enhancedFilter("sign-out", "so")).toBeGreaterThan(0.85);
    expect(enhancedFilter("git_diff", "gd")).toBeGreaterThan(0.85);
    expect(enhancedFilter("Check for Updates", "cfu")).toBeGreaterThan(0.85);
  });

  test("prefix match scores higher than keyword match", () => {
    // "configuration" starts with "config" (prefix match = 0.95)
    const prefixScore = enhancedFilter("configuration", "config");
    // "settings" has "config" as keyword (keyword match = 0.8)
    const keywordScore = enhancedFilter("settings", "config", ["config", "preferences"]);
    expect(prefixScore).toBeGreaterThan(keywordScore);
  });
});
