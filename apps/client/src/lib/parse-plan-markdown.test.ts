import { describe, expect, it } from "vitest";
import { parsePlanMarkdown } from "./parse-plan-markdown";

describe("parsePlanMarkdown", () => {
  it("parses H1 plan with multiple H2 sections", () => {
    const markdown = `# Plan: Import markdown plans

## Parser
Build parser utility.

## UI
Build import dialog.
`;

    const parsed = parsePlanMarkdown(markdown);

    expect(parsed).toEqual([
      {
        title: "Parser",
        body: "Build parser utility.",
      },
      {
        title: "UI",
        body: "Build import dialog.",
      },
    ]);
  });

  it("falls back to a single item when no H2 exists", () => {
    const markdown = `# Plan: Single fallback plan

- [ ] Do the thing
- [ ] Verify it
`;

    const parsed = parsePlanMarkdown(markdown);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      title: "Single fallback plan",
      body: `# Plan: Single fallback plan

- [ ] Do the thing
- [ ] Verify it`,
    });
  });

  it("returns empty for empty input", () => {
    expect(parsePlanMarkdown("")).toEqual([]);
    expect(parsePlanMarkdown("   \n\t  ")).toEqual([]);
  });

  it("preserves checklist markdown inside sections", () => {
    const markdown = `# Plan: Checklist preservation

## Backend
- [ ] Add endpoint
- [ ] Add schema
`;

    const parsed = parsePlanMarkdown(markdown);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.title).toBe("Backend");
    expect(parsed[0]?.body).toContain("- [ ] Add endpoint");
    expect(parsed[0]?.body).toContain("- [ ] Add schema");
  });
});
