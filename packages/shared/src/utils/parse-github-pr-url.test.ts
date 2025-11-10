import { describe, expect, it } from "vitest";

import { parseGithubPrUrl } from "./parse-github-pr-url";

describe("parseGithubPrUrl", () => {
  it("parses standard https PR URLs", () => {
    const result = parseGithubPrUrl(
      "https://github.com/manaflow-ai/cmux/pull/42"
    );
    expect(result).toEqual({
      owner: "manaflow-ai",
      repo: "cmux",
      fullName: "manaflow-ai/cmux",
      prNumber: 42,
      url: "https://github.com/manaflow-ai/cmux/pull/42",
    });
  });

  it("normalizes additional segments and trailing slashes", () => {
    const result = parseGithubPrUrl(
      "https://github.com/org/repo/pulls/101/files/"
    );
    expect(result).toMatchObject({
      owner: "org",
      repo: "repo",
      prNumber: 101,
      url: "https://github.com/org/repo/pull/101",
    });
  });

  it("accepts URLs missing protocol", () => {
    const result = parseGithubPrUrl("github.com/org/repo/pull/7");
    expect(result).toMatchObject({
      fullName: "org/repo",
      prNumber: 7,
    });
  });

  it("rejects invalid inputs", () => {
    expect(parseGithubPrUrl("")).toBeNull();
    expect(parseGithubPrUrl("https://example.com/foo")).toBeNull();
    expect(parseGithubPrUrl("https://github.com/org/repo/issues/12")).toBeNull();
    expect(parseGithubPrUrl("https://github.com/org/repo/pull/not-a-number")).toBeNull();
  });
});
