import { describe, expect, it } from "vitest";
import { pinDefaultBranchFirst } from "./sortBranches";

describe("pinDefaultBranchFirst", () => {
  it("moves default to front and preserves order of others", () => {
    const input = ["dev", "feature", "main", "hotfix"];
    const out = pinDefaultBranchFirst(input, "main");
    expect(out).toEqual(["main", "dev", "feature", "hotfix"]);
  });

  it("returns copy if default is already first", () => {
    const input = ["main", "dev", "feature"];
    const out = pinDefaultBranchFirst(input, "main");
    expect(out).toEqual(["main", "dev", "feature"]);
    expect(out).not.toBe(input);
  });

  it("returns copy if default missing", () => {
    const input = ["dev", "feature"];
    const out = pinDefaultBranchFirst(input, "main");
    expect(out).toEqual(["dev", "feature"]);
    expect(out).not.toBe(input);
  });

  it("handles null/undefined defaultName", () => {
    const input = ["dev", "feature"];
    expect(pinDefaultBranchFirst(input, undefined)).toEqual(["dev", "feature"]);
    expect(pinDefaultBranchFirst(input, null)).toEqual(["dev", "feature"]);
  });
});
