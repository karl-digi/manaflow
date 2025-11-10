import { describe, expect, it } from "vitest";
import { parseGithubPullRequestUrl } from "./parse-github-pr-url";

describe("parseGithubPullRequestUrl", () => {
  it("parses standard GitHub PR URLs", () => {
    const parsed = parseGithubPullRequestUrl(
      "https://github.com/cmux-ai/cmux/pull/42"
    );
    expect(parsed).toEqual({
      owner: "cmux-ai",
      repo: "cmux",
      fullName: "cmux-ai/cmux",
      number: 42,
      url: "https://github.com/cmux-ai/cmux/pull/42",
    });
  });

  it("accepts URLs with trailing segments", () => {
    const parsed = parseGithubPullRequestUrl(
      "https://github.com/foo/bar/pull/7/files"
    );
    expect(parsed?.number).toBe(7);
    expect(parsed?.fullName).toBe("foo/bar");
  });

  it("returns null for non-GitHub URLs", () => {
    expect(parseGithubPullRequestUrl("https://example.com/foo/bar/pull/1")).toBe(
      null
    );
  });

  it("returns null for invalid numbers", () => {
    expect(parseGithubPullRequestUrl("https://github.com/foo/bar/pull/abc")).toBe(
      null
    );
  });

  it("handles URLs missing protocol", () => {
    const parsed = parseGithubPullRequestUrl("github.com/foo/bar/pull/123");
    expect(parsed?.number).toBe(123);
  });
});
