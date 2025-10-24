import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { formatUnifiedDiffWithLineNumbers } from "./diff-utils";
import { loadOptionsFromEnv } from "./core/options";
import { resolveStrategy, AVAILABLE_STRATEGIES } from "./strategies";
import type {
  StrategyPrepareContext,
  StrategyProcessContext,
} from "./core/types";

const DIFF_URL = "https://patch-diff.githubusercontent.com/raw/manaflow-ai/cmux/pull/709.diff";
const TEMP_DIFF_PATH = "/tmp/pr-709.diff";
const OUTPUT_ROOT = join(process.cwd(), "tmp", "strategy-demo");

interface FileDiff {
  filePath: string;
  diffText: string;
}

async function ensureTempDiff(): Promise<string> {
  try {
    await readFile(TEMP_DIFF_PATH);
    return TEMP_DIFF_PATH;
  } catch {
    const res = await fetch(DIFF_URL);
    if (!res.ok) {
      throw new Error(`Failed to fetch diff: ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    await writeFile(TEMP_DIFF_PATH, text);
    return TEMP_DIFF_PATH;
  }
}

function splitDiffIntoFiles(diff: string): FileDiff[] {
  const sections = diff.split(/\n(?=diff --git )/g);
  return sections
    .map((section) => {
      const trimmed = section.trim();
      if (!trimmed.startsWith("diff --git")) return null;
      const firstLine = trimmed.split("\n")[0] ?? "";
      const match = firstLine.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (!match) return null;
      const filePath = match[2];
      return { filePath, diffText: trimmed };
    })
    .filter((item): item is FileDiff => Boolean(item));
}

function extractFirstAddedLine(diffText: string): string | null {
  const lines = diffText.split("\n");
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      return line.slice(1);
    }
  }
  return null;
}

function extractFirstAddedLineWithNumber(formattedDiff: string[]): {
  lineNumber: number;
  content: string;
} | null {
  for (const line of formattedDiff) {
    if (!line.startsWith("+")) continue;
    const match = line.match(/^\+\s*(\d+) \| (.*)$/);
    if (match) {
      return { lineNumber: Number.parseInt(match[1], 10), content: match[2] };
    }
  }
  return null;
}

function buildInlinePhraseResponse(diffText: string): string {
  const annotated = diffText
    .split("\n")
    .map((line) => {
      if (!line) return line;
      return `${line} // review 0.6 "pending_badge" sample`;
    })
    .join("\n");
  return `\
\`\`\`diff
${annotated}
\`\`\``;
}

function buildInlineBracketResponse(diffText: string): string {
  const annotated = diffText
    .split("\n")
    .map((line) => {
      if (!line) return line;
      const replaced = line.replace(/pendingBadgeText/, `{|pendingBadgeText|}`);
      return `${replaced} // review 0.4 highlight`;
    })
    .join("\n");
  return `\
\`\`\`diff
${annotated}
\`\`\``;
}

function diffForPromptPlaceholder(diffText: string): string {
  return `\
\`\`\`diff
${diffText}
\`\`\``;
}

async function runStrategyDemo(): Promise<void> {
  const diffPath = await ensureTempDiff();
  const diffContent = await readFile(diffPath, "utf8");
  const fileDiffs = splitDiffIntoFiles(diffContent);
  if (fileDiffs.length === 0) {
    throw new Error("No file diffs found in PR 709");
  }

  await rm(OUTPUT_ROOT, { recursive: true, force: true });
  await mkdir(OUTPUT_ROOT, { recursive: true });

  for (const strategy of AVAILABLE_STRATEGIES) {
    const strategyDir = join(OUTPUT_ROOT, strategy.id);
    await mkdir(strategyDir, { recursive: true });

    console.log(`\n=== Strategy: ${strategy.displayName} (${strategy.id}) ===`);

    for (const fileDiff of fileDiffs) {
      const optionsEnv = {
        ...process.env,
        CMUX_PR_REVIEW_STRATEGY: strategy.id,
        CMUX_PR_REVIEW_SHOW_DIFF_LINE_NUMBERS: "true",
        CMUX_PR_REVIEW_SHOW_CONTEXT_LINE_NUMBERS: "true",
        CMUX_PR_REVIEW_ARTIFACTS_DIR: join(strategyDir, "artifacts"),
        CMUX_PR_REVIEW_DIFF_ARTIFACT_MODE:
          strategy.id.startsWith("inline-") ? "single" : "per-file",
      } satisfies NodeJS.ProcessEnv;
      const options = loadOptionsFromEnv(optionsEnv);
      const resolvedStrategy = resolveStrategy(options.strategy);

      const formattedDiff = formatUnifiedDiffWithLineNumbers(fileDiff.diffText, {
        showLineNumbers: options.showDiffLineNumbers,
        includeContextLineNumbers: options.showContextLineNumbers,
      });

      await mkdir(options.artifactsDir, { recursive: true });

      const persistArtifact = async (
        relativePath: string,
        content: string,
        persistOptions: { append?: boolean } = {}
      ) => {
        const targetPath = join(options.artifactsDir, relativePath);
        await mkdir(dirname(targetPath), { recursive: true });
        const payload = content.endsWith("\n") ? content : `${content}\n`;
        const writeOptions = persistOptions.append
          ? { flag: "a" as const }
          : undefined;
        await writeFile(targetPath, payload, writeOptions);
        return relativePath;
      };

      const log = (header: string, body: string) => {
        console.log(`[${strategy.id}] ${header}\n${body}`);
      };

      const prepareContext: StrategyPrepareContext = {
        filePath: fileDiff.filePath,
        diff: fileDiff.diffText,
        formattedDiff,
        options,
        artifactsDir: options.artifactsDir,
        workspaceDir: options.workspaceDir,
        log,
        persistArtifact,
      };

      const prepareResult = await resolvedStrategy.prepare(prepareContext);

      await writeFile(
        join(strategyDir, `${sanitizeFilePath(fileDiff.filePath)}.prompt.txt`),
        prepareResult.prompt
      );

      let syntheticResponse = "";
      if (strategy.id === "json-lines") {
        const sample = extractFirstAddedLine(fileDiff.diffText);
        syntheticResponse = JSON.stringify(
          {
            lines: sample
              ? [
                  {
                    line: sample.trim(),
                    shouldBeReviewedScore: 0.8,
                    shouldReviewWhy: "example comment",
                    mostImportantCharacterIndex: 5,
                  },
                ]
              : [],
          },
          null,
          2
        );
      } else if (strategy.id === "line-numbers") {
        const sample = extractFirstAddedLineWithNumber(formattedDiff);
        syntheticResponse = JSON.stringify(
          {
            lines: sample
              ? [
                  {
                    lineNumber: sample.lineNumber,
                    line: sample.content,
                    shouldBeReviewedScore: 0.9,
                    shouldReviewWhy: "line needs attention",
                    mostImportantCharacterIndex: 0,
                  },
                ]
              : [],
          },
          null,
          2
        );
      } else if (strategy.id === "inline-phrase") {
        syntheticResponse = buildInlinePhraseResponse(fileDiff.diffText);
      } else if (strategy.id === "inline-brackets") {
        syntheticResponse = buildInlineBracketResponse(fileDiff.diffText);
      } else {
        syntheticResponse = diffForPromptPlaceholder(fileDiff.diffText);
      }

      const processContext: StrategyProcessContext = {
        filePath: fileDiff.filePath,
        responseText: syntheticResponse,
        events: null,
        options,
        metadata: prepareResult.metadata,
        log,
        persistArtifact,
      };

      const result = await resolvedStrategy.process(processContext);

      await writeFile(
        join(strategyDir, `${sanitizeFilePath(fileDiff.filePath)}.response.txt`),
        result.rawResponse
      );

      console.log(
        `Saved artifacts for ${fileDiff.filePath} under ${options.artifactsDir}`
      );
    }
  }
}

function sanitizeFilePath(filePath: string): string {
  return filePath.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

await runStrategyDemo().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
