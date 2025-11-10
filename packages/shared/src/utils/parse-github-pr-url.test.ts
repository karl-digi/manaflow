import { describe, expect, it } from "vitest";
import { parseGithubPrUrl } from "./parse-github-pr-url";

describe("parseGithubPrUrl", () => {
  it("parses standard https PR URLs", () => {
    const parsed = parseGithubPrUrl(
      "https://github.com/cmux/cmux/pull/123",
    );
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      owner: "cmux",
      repo: "cmux",
      repoFullName: "cmux/cmux",
      prNumber: 123,
      prUrl: "https://github.com/cmux/cmux/pull/123",
    });
  });

  it("normalizes URLs without protocol", () => {
    const parsed = parseGithubPrUrl("github.com/foo/bar/pull/42");
    expect(parsed?.prUrl).toBe("https://github.com/foo/bar/pull/42");
  });

  it("rejects non-GitHub hosts", () => {
    expect(parseGithubPrUrl("https://example.com/foo/bar/pull/1")).toBeNull();
  });

  it("rejects inputs without PR number", () => {
    expect(parseGithubPrUrl("https://github.com/foo/bar/pull/not-a-number")).toBeNull();
  });

  it("allows extra path segments", () => {
    const parsed = parseGithubPrUrl(
      "https://github.com/foo/bar/pull/99/files",
    );
    expect(parsed?.prNumber).toBe(99);
  });
});
