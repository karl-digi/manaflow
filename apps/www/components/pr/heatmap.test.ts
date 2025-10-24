import { describe, expect, it } from "vitest";

import { buildDiffHeatmap, parseReviewHeatmap } from "./heatmap";

describe("parseReviewHeatmap", () => {
  it("parses nested codex payloads best-effort", () => {
    const parsed = parseReviewHeatmap({
      response: JSON.stringify({
        lines: [
          {
            line: "2",
            shouldBeReviewedScore: 0.3,
            shouldReviewWhy: "first pass",
            mostImportantCharacterIndex: 4,
          },
          {
            line: "2",
            shouldBeReviewedScore: 0.7,
            shouldReviewWhy: "updated score",
            mostImportantCharacterIndex: 6,
          },
          {
            line: 4,
            shouldBeReviewedScore: 0.92,
            shouldReviewWhy: "new export logic",
            mostImportantCharacterIndex: 120,
          },
          {
            line: "invalid",
            shouldBeReviewedScore: 1,
            shouldReviewWhy: "ignored",
            mostImportantCharacterIndex: 0,
          },
        ],
      }),
    });

    expect(parsed).toHaveLength(4);
    const numericEntries = parsed.filter((entry) => entry.lineNumber !== null);
    expect(numericEntries).toHaveLength(3);
    expect(parsed[0]?.lineNumber).toBe(2);
    expect(parsed[1]?.lineNumber).toBe(2);
    expect(parsed.some((entry) => entry.lineNumber === 4)).toBe(true);
    const fallbackEntry = parsed.find((entry) => entry.lineText === "invalid");
    expect(fallbackEntry?.lineNumber).toBeNull();
  });
});

describe("buildDiffHeatmap", () => {
  it("produces tiered classes and character highlights", () => {
    const review = parseReviewHeatmap({
      response: JSON.stringify({
        lines: [
          {
            line: "2",
            shouldBeReviewedScore: 0.3,
            shouldReviewWhy: "first pass",
            mostImportantCharacterIndex: 4,
          },
          {
            line: "2",
            shouldBeReviewedScore: 0.7,
            shouldReviewWhy: "updated score",
            mostImportantCharacterIndex: 6,
          },
          {
            line: 4,
            shouldBeReviewedScore: 0.92,
            shouldReviewWhy: "new export logic",
            mostImportantCharacterIndex: 120,
          },
        ],
      }),
    });

    const heatmap = buildDiffHeatmap(review);
    expect(heatmap).not.toBeNull();
    if (!heatmap) {
      return;
    }

    expect(heatmap.entries.get(2)?.score).toBeCloseTo(0.7, 5);
    expect(heatmap.lineClasses.get(2)).toBe("cmux-heatmap-tier-3");
    expect(heatmap.lineClasses.get(4)).toBe("cmux-heatmap-tier-4");

    const rangeForLine2 = heatmap.newRanges.find(
      (range) => range.lineNumber === 2
    );
    expect(rangeForLine2?.start).toBe(6);
    expect(rangeForLine2?.length).toBe(1);

    const rangeForLine4 = heatmap.newRanges.find(
      (range) => range.lineNumber === 4
    );
    expect(rangeForLine4).toBeDefined();
  });
});
