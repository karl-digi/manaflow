#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";

const API_BASE_URL = process.env.ZERO_GITHUB_API_URL ?? "https://0github.com";

interface LineEvent {
  type: "line";
  filePath: string;
  changeType: "+" | "-" | " ";
  diffLine: string;
  codeLine: string;
  mostImportantWord: string | null;
  shouldReviewWhy: string | null;
  score: number;
  scoreNormalized: number;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

interface FileEvent {
  type: "file";
  filePath: string;
}

interface SkipEvent {
  type: "skip";
  filePath: string;
  reason: string;
}

interface FileCompleteEvent {
  type: "file-complete";
  filePath: string;
  status: "success" | "error" | "skipped";
  summary?: string;
}

interface StatusEvent {
  type: "status";
  message: string;
}

interface CompleteEvent {
  type: "complete";
}

interface ErrorEvent {
  type: "error";
  message: string;
}

type SSEEvent =
  | LineEvent
  | FileEvent
  | SkipEvent
  | FileCompleteEvent
  | StatusEvent
  | CompleteEvent
  | ErrorEvent;

function parseGitHubPrUrl(input: string): {
  owner: string;
  repo: string;
  prNumber: number;
} | null {
  // Handle full URLs like https://github.com/owner/repo/pull/123
  // Also handle 0github.com URLs
  const urlMatch = input.match(
    /(?:github\.com|0github\.com)\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/i
  );
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      prNumber: parseInt(urlMatch[3], 10),
    };
  }

  // Handle short format: owner/repo#123
  const shortMatch = input.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
      prNumber: parseInt(shortMatch[3], 10),
    };
  }

  return null;
}

function getScoreColor(score: number): (text: string) => string {
  if (score <= 10) {
    return chalk.dim;
  }
  if (score <= 25) {
    return chalk.green;
  }
  if (score <= 40) {
    return chalk.yellow;
  }
  if (score <= 60) {
    return (text: string) => chalk.rgb(255, 165, 0)(text); // orange
  }
  if (score <= 80) {
    return chalk.red;
  }
  return chalk.magenta.bold;
}

function getScoreBackground(score: number): (text: string) => string {
  if (score <= 10) {
    return (text: string) => text;
  }
  if (score <= 25) {
    return chalk.bgGreen.black;
  }
  if (score <= 40) {
    return chalk.bgYellow.black;
  }
  if (score <= 60) {
    return chalk.bgRgb(255, 165, 0).black; // orange bg
  }
  if (score <= 80) {
    return chalk.bgRed.white;
  }
  return chalk.bgMagenta.white.bold;
}

function formatLineNumber(num: number | null, width: number = 4): string {
  if (num === null) {
    return " ".repeat(width);
  }
  return String(num).padStart(width, " ");
}

function renderLine(event: LineEvent, showTooltips: boolean): void {
  const { changeType, diffLine, score, oldLineNumber, newLineNumber } = event;

  const colorFn = getScoreColor(score);
  const bgFn = getScoreBackground(score);

  // Line number gutter
  const oldNum = formatLineNumber(oldLineNumber);
  const newNum = formatLineNumber(newLineNumber);
  const gutter = chalk.dim(`${oldNum} ${newNum}`);

  // Change type indicator
  let changeIndicator: string;
  switch (changeType) {
    case "+":
      changeIndicator = chalk.green.bold("+");
      break;
    case "-":
      changeIndicator = chalk.red.bold("-");
      break;
    default:
      changeIndicator = chalk.dim(" ");
  }

  // Score badge
  const scoreBadge =
    score > 0 ? bgFn(` ${String(score).padStart(3, " ")} `) : "     ";

  // Main line content with color based on score
  const lineContent = colorFn(diffLine);

  // Build the output line
  let output = `${gutter} ${changeIndicator} ${scoreBadge} ${lineContent}`;

  // Add tooltip if enabled and score > 0
  if (showTooltips && score > 0 && event.shouldReviewWhy) {
    output += chalk.dim.italic(`  # ${event.shouldReviewWhy}`);
  }

  console.log(output);
}

function renderFileHeader(filePath: string): void {
  console.log();
  console.log(chalk.cyan.bold(`━━━ ${filePath} ━━━`));
  console.log();
}

function renderSkip(filePath: string, reason: string): void {
  console.log(chalk.dim(`⊘ ${filePath}: ${reason}`));
}

function renderFileComplete(
  filePath: string,
  status: string,
  summary?: string
): void {
  if (status === "error") {
    console.log(chalk.red(`✗ ${filePath}: ${summary ?? "error"}`));
  }
}

async function* streamSSE(
  url: string,
  signal?: AbortSignal
): AsyncGenerator<SSEEvent> {
  const response = await fetch(url, { signal });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const body = response.body;
  if (!body) {
    throw new Error("Response body missing");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        separatorIndex = buffer.indexOf("\n\n");

        const lines = rawEvent.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data:")) {
            continue;
          }
          const data = line.slice(5).trim();
          if (data.length === 0) {
            continue;
          }
          try {
            const payload = JSON.parse(data) as SSEEvent;
            yield payload;
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

interface ReviewOptions {
  tooltips: boolean;
  model?: string;
  lang?: string;
}

async function runReview(
  owner: string,
  repo: string,
  prNumber: number,
  options: ReviewOptions
): Promise<void> {
  const params = new URLSearchParams({
    repoFullName: `${owner}/${repo}`,
    prNumber: String(prNumber),
  });

  if (options.model) {
    params.set("model", options.model);
  }
  if (options.lang) {
    params.set("lang", options.lang);
  }

  const url = `${API_BASE_URL}/api/pr-review/simple?${params.toString()}`;

  console.log(
    chalk.bold(`\n🔍 Reviewing PR: ${owner}/${repo}#${prNumber}\n`)
  );
  console.log(chalk.dim(`Streaming from ${API_BASE_URL}...\n`));

  const controller = new AbortController();

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    console.log(chalk.yellow("\n\nAborted by user."));
    controller.abort();
    process.exit(0);
  });

  let currentFile: string | null = null;
  let fileCount = 0;
  let lineCount = 0;
  let highScoreCount = 0;

  try {
    for await (const event of streamSSE(url, controller.signal)) {
      switch (event.type) {
        case "status":
          console.log(chalk.dim(`Status: ${event.message}`));
          break;

        case "file":
          currentFile = event.filePath;
          fileCount++;
          renderFileHeader(event.filePath);
          break;

        case "skip":
          renderSkip(event.filePath, event.reason);
          break;

        case "line":
          lineCount++;
          if (event.score >= 50) {
            highScoreCount++;
          }
          renderLine(event, options.tooltips);
          break;

        case "file-complete":
          renderFileComplete(event.filePath, event.status, event.summary);
          break;

        case "complete":
          console.log();
          console.log(chalk.green.bold("✓ Review complete!"));
          console.log();
          console.log(
            chalk.dim(
              `Files: ${fileCount} | Lines: ${lineCount} | High attention (≥50): ${highScoreCount}`
            )
          );
          break;

        case "error":
          console.error(chalk.red(`\nError: ${event.message}`));
          break;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      // User cancelled
      return;
    }
    throw error;
  }
}

// Legend display
function showLegend(): void {
  console.log(chalk.bold("\n📊 Score Legend:\n"));
  console.log(`  ${chalk.dim("  0-10 ")} - Minimal attention needed`);
  console.log(`  ${chalk.bgGreen.black(" 11-25 ")} - Low attention`);
  console.log(`  ${chalk.bgYellow.black(" 26-40 ")} - Moderate attention`);
  console.log(`  ${chalk.bgRgb(255, 165, 0).black(" 41-60 ")} - Notable concern`);
  console.log(`  ${chalk.bgRed.white(" 61-80 ")} - High attention needed`);
  console.log(`  ${chalk.bgMagenta.white.bold(" 81-100")} - Critical review required`);
  console.log();
}

program
  .name("0github")
  .description("TUI heatmap diff viewer for GitHub pull requests")
  .version("0.0.1")
  .argument("[pr-url]", "GitHub PR URL or owner/repo#number")
  .option("-t, --tooltips", "Show review hints for flagged lines", true)
  .option("--no-tooltips", "Hide review hints")
  .option("-m, --model <model>", "AI model to use (default, claude, gpt4)")
  .option("-l, --lang <lang>", "Tooltip language (en, zh-Hans, ja, etc.)")
  .option("--legend", "Show score legend and exit")
  .action(async (prUrl: string | undefined, options) => {
    if (options.legend) {
      showLegend();
      return;
    }

    if (!prUrl) {
      console.error(
        chalk.red("PR URL required. Use format: https://github.com/owner/repo/pull/123 or owner/repo#123")
      );
      console.log(chalk.dim("\nRun with --help for more options."));
      process.exit(1);
    }

    const parsed = parseGitHubPrUrl(prUrl);
    if (!parsed) {
      console.error(
        chalk.red(
          "Invalid PR URL. Use format: https://github.com/owner/repo/pull/123 or owner/repo#123"
        )
      );
      process.exit(1);
    }

    try {
      await runReview(parsed.owner, parsed.repo, parsed.prNumber, {
        tooltips: options.tooltips,
        model: options.model,
        lang: options.lang,
      });
    } catch (error) {
      console.error(
        chalk.red(
          `\nError: ${error instanceof Error ? error.message : String(error)}`
        )
      );
      process.exit(1);
    }
  });

program.parse();
