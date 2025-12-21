/**
 * Build unified diff text from ReplaceDiffEntry content
 * Used when entry.patch is not available but oldContent/newContent are present
 */
import type { ReplaceDiffEntry } from "@cmux/shared/diff-types";

type DiffOperation = { type: "=" | "-" | "+"; oldIdx?: number; newIdx?: number; line: string };

/**
 * Compute line-by-line diff using LCS algorithm
 * Returns an array of operations: "=" for equal, "-" for delete, "+" for insert
 */
function computeLineDiff(
  oldLines: string[],
  newLines: string[]
): DiffOperation[] {
  const m = oldLines.length;
  const n = newLines.length;

  // Create LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i]![j] = (dp[i - 1]?.[j - 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]?.[j] ?? 0, dp[i]?.[j - 1] ?? 0);
      }
    }
  }

  // Backtrack to find the diff
  let i = m;
  let j = n;
  const operations: DiffOperation[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      operations.unshift({ type: "=", oldIdx: i - 1, newIdx: j - 1, line: oldLines[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || (dp[i]?.[j - 1] ?? 0) >= (dp[i - 1]?.[j] ?? 0))) {
      operations.unshift({ type: "+", newIdx: j - 1, line: newLines[j - 1]! });
      j--;
    } else if (i > 0) {
      operations.unshift({ type: "-", oldIdx: i - 1, line: oldLines[i - 1]! });
      i--;
    }
  }

  return operations;
}

/**
 * Generate unified diff hunks from line operations with context
 */
function generateUnifiedHunks(
  operations: DiffOperation[],
  contextLines: number = 3
): string[] {
  const hunks: string[] = [];

  // Find ranges of changes with context
  const changeIndices: number[] = [];
  for (let i = 0; i < operations.length; i++) {
    if (operations[i]?.type !== "=") {
      changeIndices.push(i);
    }
  }

  if (changeIndices.length === 0) {
    return [];
  }

  // Group changes into hunks (merge if within 2*contextLines of each other)
  const hunkRanges: Array<{ start: number; end: number }> = [];
  let currentStart = Math.max(0, (changeIndices[0] ?? 0) - contextLines);
  let currentEnd = Math.min(operations.length - 1, (changeIndices[0] ?? 0) + contextLines);

  for (let i = 1; i < changeIndices.length; i++) {
    const changeIdx = changeIndices[i]!;
    const rangeStart = Math.max(0, changeIdx - contextLines);
    const rangeEnd = Math.min(operations.length - 1, changeIdx + contextLines);

    if (rangeStart <= currentEnd + 1) {
      currentEnd = rangeEnd;
    } else {
      hunkRanges.push({ start: currentStart, end: currentEnd });
      currentStart = rangeStart;
      currentEnd = rangeEnd;
    }
  }
  hunkRanges.push({ start: currentStart, end: currentEnd });

  // Generate each hunk
  for (const range of hunkRanges) {
    let oldStart = 1;
    let newStart = 1;

    for (let i = 0; i < range.start; i++) {
      const op = operations[i];
      if (op?.type === "=" || op?.type === "-") {
        oldStart++;
      }
      if (op?.type === "=" || op?.type === "+") {
        newStart++;
      }
    }

    let oldCount = 0;
    let newCount = 0;
    const lines: string[] = [];

    for (let i = range.start; i <= range.end; i++) {
      const op = operations[i];
      if (!op) continue;

      if (op.type === "=") {
        lines.push(` ${op.line}`);
        oldCount++;
        newCount++;
      } else if (op.type === "-") {
        lines.push(`-${op.line}`);
        oldCount++;
      } else if (op.type === "+") {
        lines.push(`+${op.line}`);
        newCount++;
      }
    }

    hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    hunks.push(...lines);
  }

  return hunks;
}

/**
 * Build unified diff text from file contents
 * Returns empty string if there are no changes
 */
export function buildUnifiedDiffFromContent(entry: ReplaceDiffEntry): string {
  const oldContent = entry.oldContent ?? "";
  const newContent = entry.newContent ?? "";

  const oldLines = oldContent.split(/\r?\n/);
  const newLines = newContent.split(/\r?\n/);

  // Handle empty file edge cases
  if (oldLines.length === 1 && oldLines[0] === "") {
    oldLines.length = 0;
  }
  if (newLines.length === 1 && newLines[0] === "") {
    newLines.length = 0;
  }

  let hunks: string[] = [];

  if (entry.status === "added" || oldLines.length === 0) {
    if (newLines.length > 0) {
      hunks.push(`@@ -0,0 +1,${newLines.length} @@`);
      for (const line of newLines) {
        hunks.push(`+${line}`);
      }
    }
  } else if (entry.status === "deleted" || newLines.length === 0) {
    if (oldLines.length > 0) {
      hunks.push(`@@ -1,${oldLines.length} +0,0 @@`);
      for (const line of oldLines) {
        hunks.push(`-${line}`);
      }
    }
  } else {
    const operations = computeLineDiff(oldLines, newLines);
    hunks = generateUnifiedHunks(operations, 3);

    if (hunks.length === 0) {
      return "";
    }
  }

  // Return just the hunks without the headers (they'll be stripped anyway)
  return hunks.join("\n");
}

/**
 * Get diff text for a ReplaceDiffEntry, falling back to content-based diff if patch is unavailable
 */
export function getDiffTextForEntry(entry: ReplaceDiffEntry): string | null {
  // If patch is available, use it
  if (entry.patch) {
    return entry.patch;
  }

  // Try to build from content if available
  if (entry.oldContent !== undefined || entry.newContent !== undefined) {
    const built = buildUnifiedDiffFromContent(entry);
    return built.length > 0 ? built : null;
  }

  return null;
}
