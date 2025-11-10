import { describe, expect, it } from "vitest";
import { parseGithubPrUrl } from "./parse-github-pr-url";

describe("parseGithubPrUrl", () => {
  it("parses a standard GitHub PR URL", () => {
    const result = parseGithubPrUrl(
      "https://github.com/cmux/dev-platform/pull/42"
    );
    expect(result).toEqual({
      owner: "cmux",
      repo: "dev-platform",
      number: 42,
      fullName: "cmux/dev-platform",
      prUrl: "https://github.com/cmux/dev-platform/pull/42",
    });
  });

  it("handles query strings and fragments", () => {
    const result = parseGithubPrUrl(
      "https://github.com/cmux/dev-platform/pull/7/files?diff=split#discussion"
    );
    expect(result?.number).toBe(7);
    expect(result?.prUrl).toBe(
      "https://github.com/cmux/dev-platform/pull/7"
    );
  });

  it("returns null for non-GitHub URLs", () => {
    expect(parseGithubPrUrl("https://example.com/foo/bar/pull/1")).toBeNull();
  });

  it("returns null for malformed values", () => {
    expect(parseGithubPrUrl("not a url")).toBeNull();
    expect(parseGithubPrUrl("")).toBeNull();
  });
});
