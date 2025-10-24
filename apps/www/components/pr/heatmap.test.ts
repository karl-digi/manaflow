import { DiffFile } from "@git-diff-view/react";
import { describe, expect, it } from "vitest";

import { buildDiffHeatmap, parseReviewHeatmap } from "./heatmap";

const SAMPLE_DIFF = `
diff --git a/example.ts b/example.ts
index 1111111..2222222 100644
--- a/example.ts
+++ b/example.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
-export const sum = a + b;
+const b = 3;
+const message = "heatmap";
+export const sum = a + b + Number(message.length);
`;

function createDiffFile(): DiffFile {
  const diffFile = DiffFile.createInstance({
    oldFile: { fileName: "example.ts", content: "", fileLang: "ts" },
    newFile: { fileName: "example.ts", content: "", fileLang: "ts" },
    hunks: [SAMPLE_DIFF],
  });

  diffFile.initTheme("light");
  diffFile.initRaw();
  diffFile.buildSplitDiffLines();
  diffFile.buildUnifiedDiffLines();

  return diffFile;
}

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
  it("produces tiered classes and highlight metadata", () => {
    const diffFile = createDiffFile();

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

    const heatmap = buildDiffHeatmap(diffFile, review);
    expect(heatmap).not.toBeNull();
    if (!heatmap) {
      return;
    }

    expect(heatmap.entries.get(2)?.score).toBeCloseTo(0.7, 5);
    expect(heatmap.tiers.get(2)).toBe(3);
    expect(heatmap.tiers.get(4)).toBe(4);

    const entryForLine2 = heatmap.entries.get(2);
    expect(entryForLine2?.highlightRatio).toBeGreaterThan(0);
    expect(entryForLine2?.highlightRatio).toBeLessThanOrEqual(1);

    const entryForLine4 = heatmap.entries.get(4);
    expect(entryForLine4).toBeDefined();
    if (!entryForLine4) {
      return;
    }

    expect(entryForLine4.highlightRatio).toBe(1);
    expect(entryForLine4.contentLength).toBeGreaterThan(0);
  });
});
