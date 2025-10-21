import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { ReplaceDiffEntry } from "@cmux/shared/diff-types";

import { MonacoGitDiffViewer } from "@cmux/shared/ui/diff";
import { debugMonacoDiffSamples } from "@/lib/debug-monaco-samples";

const newlinePattern = /\r?\n/;

function splitContentIntoLines(content: string): string[] {
  if (!content) {
    return [""];
  }

  const parts = content.split(newlinePattern);
  return parts.length > 0 ? parts : [""];
}

function computeDiffStats(original: string, modified: string) {
  const originalLines = splitContentIntoLines(original);
  const modifiedLines = splitContentIntoLines(modified);
  const originalLength = originalLines.length;
  const modifiedLength = modifiedLines.length;

  if (originalLength === 0 && modifiedLength === 0) {
    return { additions: 0, deletions: 0 };
  }

  const dp: Uint32Array[] = Array.from(
    { length: originalLength + 1 },
    () => new Uint32Array(modifiedLength + 1),
  );

  for (let originalIndex = originalLength - 1; originalIndex >= 0; originalIndex -= 1) {
    const currentRow = dp[originalIndex];
    const nextRow = dp[originalIndex + 1];

    for (
      let modifiedIndex = modifiedLength - 1;
      modifiedIndex >= 0;
      modifiedIndex -= 1
    ) {
      if (originalLines[originalIndex] === modifiedLines[modifiedIndex]) {
        currentRow[modifiedIndex] = nextRow[modifiedIndex + 1] + 1;
      } else {
        currentRow[modifiedIndex] = Math.max(
          nextRow[modifiedIndex],
          currentRow[modifiedIndex + 1],
        );
      }
    }
  }

  let additions = 0;
  let deletions = 0;

  let originalIndex = 0;
  let modifiedIndex = 0;

  while (originalIndex < originalLength || modifiedIndex < modifiedLength) {
    const originalExhausted = originalIndex >= originalLength;
    const modifiedExhausted = modifiedIndex >= modifiedLength;

    if (
      !originalExhausted &&
      !modifiedExhausted &&
      originalLines[originalIndex] === modifiedLines[modifiedIndex]
    ) {
      originalIndex += 1;
      modifiedIndex += 1;
      continue;
    }

    if (
      modifiedExhausted ||
      (!originalExhausted &&
        dp[originalIndex + 1][modifiedIndex] >= dp[originalIndex][modifiedIndex + 1])
    ) {
      deletions += 1;
      originalIndex += 1;
    } else {
      additions += 1;
      modifiedIndex += 1;
    }
  }

  return { additions, deletions };
}

export const Route = createFileRoute("/debug-monaco")({
  component: DebugMonacoPage,
});

function DebugMonacoPage() {
  const diffs = useMemo<ReplaceDiffEntry[]>(
    () =>
      debugMonacoDiffSamples.map((sample) => {
        const { additions, deletions } = computeDiffStats(
          sample.original,
          sample.modified,
        );

        return {
          filePath: sample.filePath,
          status: "modified",
          additions,
          deletions,
          oldContent: sample.original,
          newContent: sample.modified,
          patch: undefined,
          oldPath: undefined,
          isBinary: false,
          contentOmitted: false,
        } satisfies ReplaceDiffEntry;
      }),
    [],
  );

  return (
    <div className="min-h-dvh bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="m-1 h-[calc(100dvh-8px)] overflow-auto rounded-lg border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="space-y-4 p-4 sm:p-6">
          <MonacoGitDiffViewer diffs={diffs} />
        </div>
      </div>
    </div>
  );
}
