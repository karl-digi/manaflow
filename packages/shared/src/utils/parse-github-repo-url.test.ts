import { describe, it, expect } from "vitest";
import { parseGithubRepoUrl } from "./parse-github-repo-url";

describe("parseGithubRepoUrl", () => {
  it("should parse simple owner/repo format", () => {
    const result = parseGithubRepoUrl("manaflow-ai/cmux");
    expect(result).toEqual({
      owner: "manaflow-ai",
      repo: "cmux",
      fullName: "manaflow-ai/cmux",
      url: "https://github.com/manaflow-ai/cmux",
      gitUrl: "https://github.com/manaflow-ai/cmux.git",
    });
  });

  it("should parse HTTPS URL", () => {
    const result = parseGithubRepoUrl("https://github.com/manaflow-ai/cmux");
    expect(result).toEqual({
      owner: "manaflow-ai",
      repo: "cmux",
      fullName: "manaflow-ai/cmux",
      url: "https://github.com/manaflow-ai/cmux",
      gitUrl: "https://github.com/manaflow-ai/cmux.git",
    });
  });

  it("should parse HTTPS URL with .git extension", () => {
    const result = parseGithubRepoUrl("https://github.com/manaflow-ai/cmux.git");
    expect(result).toEqual({
      owner: "manaflow-ai",
      repo: "cmux",
      fullName: "manaflow-ai/cmux",
      url: "https://github.com/manaflow-ai/cmux",
      gitUrl: "https://github.com/manaflow-ai/cmux.git",
    });
  });

  it("should parse SSH URL", () => {
    const result = parseGithubRepoUrl("git@github.com:manaflow-ai/cmux.git");
    expect(result).toEqual({
      owner: "manaflow-ai",
      repo: "cmux",
      fullName: "manaflow-ai/cmux",
      url: "https://github.com/manaflow-ai/cmux",
      gitUrl: "https://github.com/manaflow-ai/cmux.git",
    });
  });

  it("should parse PR URL and extract PR number", () => {
    const result = parseGithubRepoUrl("https://github.com/manaflow-ai/cmux/pull/914");
    expect(result).toEqual({
      owner: "manaflow-ai",
      repo: "cmux",
      fullName: "manaflow-ai/cmux",
      url: "https://github.com/manaflow-ai/cmux",
      gitUrl: "https://github.com/manaflow-ai/cmux.git",
      prNumber: 914,
    });
  });

  it("should parse PR URL with trailing slash", () => {
    const result = parseGithubRepoUrl("https://github.com/manaflow-ai/cmux/pull/914/");
    expect(result).toEqual({
      owner: "manaflow-ai",
      repo: "cmux",
      fullName: "manaflow-ai/cmux",
      url: "https://github.com/manaflow-ai/cmux",
      gitUrl: "https://github.com/manaflow-ai/cmux.git",
      prNumber: 914,
    });
  });

  it("should parse branch URL and extract branch name", () => {
    const result = parseGithubRepoUrl(
      "https://github.com/manaflow-ai/cmux/tree/cmux/make-last-line-of-readme-md-bold-for-emphasis-r1sdp"
    );
    expect(result).toEqual({
      owner: "manaflow-ai",
      repo: "cmux",
      fullName: "manaflow-ai/cmux",
      url: "https://github.com/manaflow-ai/cmux",
      gitUrl: "https://github.com/manaflow-ai/cmux.git",
      branch: "cmux/make-last-line-of-readme-md-bold-for-emphasis-r1sdp",
    });
  });

  it("should parse branch URL with URL-encoded characters", () => {
    const result = parseGithubRepoUrl(
      "https://github.com/manaflow-ai/cmux/tree/feature%2Fmy-branch"
    );
    expect(result).toEqual({
      owner: "manaflow-ai",
      repo: "cmux",
      fullName: "manaflow-ai/cmux",
      url: "https://github.com/manaflow-ai/cmux",
      gitUrl: "https://github.com/manaflow-ai/cmux.git",
      branch: "feature/my-branch",
    });
  });

  it("should parse branch URL with trailing slash", () => {
    const result = parseGithubRepoUrl(
      "https://github.com/manaflow-ai/cmux/tree/main/"
    );
    expect(result).toEqual({
      owner: "manaflow-ai",
      repo: "cmux",
      fullName: "manaflow-ai/cmux",
      url: "https://github.com/manaflow-ai/cmux",
      gitUrl: "https://github.com/manaflow-ai/cmux.git",
      branch: "main",
    });
  });

  it("should return null for invalid input", () => {
    expect(parseGithubRepoUrl("")).toBeNull();
    expect(parseGithubRepoUrl("not-a-valid-url")).toBeNull();
    expect(parseGithubRepoUrl("https://gitlab.com/owner/repo")).toBeNull();
  });

  it("should handle HTTP protocol", () => {
    const result = parseGithubRepoUrl("http://github.com/manaflow-ai/cmux");
    expect(result).toEqual({
      owner: "manaflow-ai",
      repo: "cmux",
      fullName: "manaflow-ai/cmux",
      url: "https://github.com/manaflow-ai/cmux",
      gitUrl: "https://github.com/manaflow-ai/cmux.git",
    });
  });

  it("should handle PR URLs with HTTP protocol", () => {
    const result = parseGithubRepoUrl("http://github.com/manaflow-ai/cmux/pull/123");
    expect(result).toEqual({
      owner: "manaflow-ai",
      repo: "cmux",
      fullName: "manaflow-ai/cmux",
      url: "https://github.com/manaflow-ai/cmux",
      gitUrl: "https://github.com/manaflow-ai/cmux.git",
      prNumber: 123,
    });
  });

  it("should handle branch URLs with HTTP protocol", () => {
    const result = parseGithubRepoUrl("http://github.com/manaflow-ai/cmux/tree/main");
    expect(result).toEqual({
      owner: "manaflow-ai",
      repo: "cmux",
      fullName: "manaflow-ai/cmux",
      url: "https://github.com/manaflow-ai/cmux",
      gitUrl: "https://github.com/manaflow-ai/cmux.git",
      branch: "main",
    });
  });
});
