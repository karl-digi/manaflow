#!/usr/bin/env bun

import { mkdir, rm, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join as joinPath } from "node:path";
import {
  codeReviewCallbackSchema,
  type CodeReviewCallbackPayload,
  codeReviewFileCallbackSchema,
  type CodeReviewFileCallbackPayload,
} from "@cmux/shared/codeReview/callback-schemas";
import { getGithubToken } from "./github";
import { formatUnifiedDiffWithLineNumbers } from "./diff-utils";
import { loadOptionsFromEnv } from "./core/options";
import { resolveStrategy } from "./strategies";
import type {
  StrategyPrepareContext,
  StrategyProcessContext,
  StrategyRunResult,
} from "./core/types";

interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

const execFileAsync = promisify(execFile);

const reviewOptions = loadOptionsFromEnv(process.env);
const reviewStrategy = resolveStrategy(reviewOptions.strategy);

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) {
    return `${ms}`;
  }
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(2)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}m ${remainder.toFixed(1)}s`;
}

interface CallbackContext {
  url: string;
  token: string;
  jobId: string;
  sandboxInstanceId?: string;
}

interface FileCallbackContext {
  url: string;
  token: string;
  jobId: string;
  sandboxInstanceId?: string;
  commitRef?: string | null;
}

async function sendCallback(
  context: CallbackContext,
  payload: CodeReviewCallbackPayload
): Promise<void> {
  const validated = codeReviewCallbackSchema.parse(payload);
  const response = await fetch(context.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${context.token}`,
    },
    body: JSON.stringify(validated),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Callback failed with status ${response.status}: ${text.slice(0, 2048)}`
    );
  }
}

async function sendFileCallback(
  context: FileCallbackContext,
  payload: CodeReviewFileCallbackPayload
): Promise<void> {
  const validated = codeReviewFileCallbackSchema.parse(payload);
  const response = await fetch(context.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${context.token}`,
    },
    body: JSON.stringify(validated),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `File callback failed with status ${response.status}: ${text.slice(0, 2048)}`
    );
  }
}

async function runCommand(
  command: string,
  args: readonly string[],
  options: CommandOptions = {}
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      cwd: options.cwd,
      env: options.env,
      shell: false,
    });

    child.once("error", (error) => reject(error));
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Command "${command} ${args.join(" ")}" exited with ${
            code === null ? `signal ${String(signal)}` : `code ${code}`
          }`
        )
      );
    });
  });
}

async function runCommandCapture(
  command: string,
  args: readonly string[],
  options: CommandOptions = {}
): Promise<string> {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return result.stdout;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function configureGitCredentials(token: string): Promise<void> {
  const homeDir =
    process.env.HOME && process.env.HOME.length > 0
      ? process.env.HOME
      : "/root";
  const credentialFile = joinPath(homeDir, ".git-credentials");
  const credentialEntry = `https://x-access-token:${token}@github.com\n`;
  await writeFile(credentialFile, credentialEntry, { mode: 0o600 });
  await runCommand("git", [
    "config",
    "--global",
    "credential.helper",
    `store --file=${credentialFile}`,
  ]);
  console.log("[inject] Configured Git credential helper for GitHub.");
}

function parseFileList(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort((a, b) => a.localeCompare(b));
}

function logFileSection(label: string, files: string[]): void {
  console.log("[inject] ------------------------------");
  console.log(`[inject] ${label} (${files.length})`);
  if (files.length === 0) {
    console.log("[inject]   (none)");
    return;
  }
  files.forEach((file) => {
    console.log(`[inject]   ${file}`);
  });
}

function logIndentedBlock(header: string, content: string): void {
  console.log(header);
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    console.log("[inject]   (empty response)");
    return;
  }
  normalized.split("\n").forEach((line) => {
    console.log(`[inject]   ${line}`);
  });
}

function logDiffWithLineNumbers(label: string, lines: string[]): void {
  console.log(label);
  if (lines.length === 0) {
    console.log("[inject]   (no diff output)");
    return;
  }
  lines.forEach((line) => {
    console.log(`[inject]   ${line}`);
  });
}

function isFulfilled<T>(
  result: PromiseSettledResult<T>
): result is PromiseFulfilledResult<T> {
  return result.status === "fulfilled";
}

interface RepoIdentifier {
  owner: string;
  name: string;
}

function parseRepoUrl(repoUrl: string): RepoIdentifier {
  let url: URL;
  try {
    url = new URL(repoUrl);
  } catch (error) {
    throw new Error(
      `Unable to parse repository URL (${repoUrl}): ${String(
        error instanceof Error ? error.message : error
      )}`
    );
  }

  const path = url.pathname.replace(/^\//, "").replace(/\.git$/, "");
  const [owner, name] = path.split("/");
  if (!owner || !name) {
    throw new Error(
      `Repository URL must be in the form https://github.com/<owner>/<repo>[.git], received: ${repoUrl}`
    );
  }
  return { owner, name };
}

function extractPathFromDiff(rawPath: string): string {
  const trimmed = rawPath.trim();
  const arrowIndex = trimmed.indexOf(" => ");
  if (arrowIndex === -1) {
    return trimmed;
  }

  const braceStart = trimmed.indexOf("{");
  const braceEnd = trimmed.indexOf("}");
  if (
    braceStart !== -1 &&
    braceEnd !== -1 &&
    braceEnd > braceStart &&
    braceStart < arrowIndex &&
    braceEnd > arrowIndex
  ) {
    const prefix = trimmed.slice(0, braceStart);
    const braceContent = trimmed.slice(braceStart + 1, braceEnd);
    const suffix = trimmed.slice(braceEnd + 1);
    const braceParts = braceContent.split(" => ");
    const replacement = braceParts[braceParts.length - 1] ?? "";
    return `${prefix}${replacement}${suffix}`;
  }

  const parts = trimmed.split(" => ");
  return parts[parts.length - 1] ?? trimmed;
}

async function filterTextFiles(
  workspaceDir: string,
  baseRevision: string,
  files: readonly string[]
): Promise<string[]> {
  if (files.length === 0) {
    return [];
  }

  const fileSet = new Set(files);
  const args = ["diff", "--numstat", `${baseRevision}..HEAD`, "--", ...files];

  const output = await runCommandCapture("git", args, { cwd: workspaceDir });
  const textFiles = new Set<string>();

  output.split("\n").forEach((line) => {
    if (!line.trim()) {
      return;
    }
    const parts = line.split("\t");
    if (parts.length < 3) {
      return;
    }
    const [addedRaw, deletedRaw, ...pathParts] = parts;
    if (!addedRaw || !deletedRaw || pathParts.length === 0) {
      return;
    }
    const added = addedRaw.trim();
    const deleted = deletedRaw.trim();
    if (added === "-" || deleted === "-") {
      // Binary diff shows "-" for text stats.
      return;
    }
    const rawPath = pathParts.join("\t").trim();
    if (!rawPath) {
      return;
    }
    const normalizedPath = extractPathFromDiff(rawPath);
    if (fileSet.has(normalizedPath)) {
      textFiles.add(normalizedPath);
      return;
    }
    if (fileSet.has(rawPath)) {
      textFiles.add(rawPath);
      return;
    }
    textFiles.add(normalizedPath);
  });

  return files.filter((file) => textFiles.has(file));
}

interface CodexReviewResult {
  file: string;
  response: string;
}

interface CodexReviewContext {
  workspaceDir: string;
  baseRevision: string;
  files: readonly string[];
  jobId: string;
  sandboxInstanceId: string;
  commitRef: string | null;
  fileCallback?: FileCallbackContext | null;
}

async function runCodexReviews({
  workspaceDir,
  baseRevision,
  files,
  jobId,
  sandboxInstanceId,
  commitRef,
  fileCallback,
}: CodexReviewContext): Promise<CodexReviewResult[]> {
  if (files.length === 0) {
    console.log("[inject] No text files require Codex review.");
    return [];
  }

  const openAiApiKey = requireEnv("OPENAI_API_KEY");

  console.log(
    `[inject] Launching Codex reviews for ${files.length} file(s)...`
  );
  console.log(
    `[inject] Strategy: ${reviewStrategy.displayName} (${reviewStrategy.id})`
  );

  const { Codex } = await import("@openai/codex-sdk");
  const codex = new Codex({ apiKey: openAiApiKey });

  const reviewStart = performance.now();

  await rm(reviewOptions.artifactsDir, { recursive: true, force: true });
  await mkdir(reviewOptions.artifactsDir, { recursive: true });

  const persistArtifact = async (
    relativePath: string,
    content: string,
    options: { append?: boolean } = {}
  ): Promise<string> => {
    const targetPath = joinPath(reviewOptions.artifactsDir, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    const finalContent = content.endsWith("\n") ? content : `${content}\n`;
    const writeOptions = options.append
      ? { flag: "a" as const }
      : undefined;
    await writeFile(targetPath, finalContent, writeOptions);
    return relativePath;
  };

  const strategyLog = (header: string, body: string) => {
    logIndentedBlock(`[inject] ${header}`, body);
  };

  const reviewPromises = files.map(async (file) => {
    const fileStart = performance.now();
    try {
      const diff = await runCommandCapture(
        "git",
        ["diff", `${baseRevision}..HEAD`, "--", file],
        { cwd: workspaceDir }
      );
      const formattedDiff = formatUnifiedDiffWithLineNumbers(diff, {
        showLineNumbers: reviewOptions.showDiffLineNumbers,
        includeContextLineNumbers: reviewOptions.showContextLineNumbers,
      });
      logDiffWithLineNumbers(`[inject] Diff for ${file}`, formattedDiff);
      const thread = codex.startThread({
        workingDirectory: workspaceDir,
        model: "gpt-5-codex",
      });
      const prepareContext: StrategyPrepareContext = {
        filePath: file,
        diff,
        formattedDiff,
        options: reviewOptions,
        artifactsDir: reviewOptions.artifactsDir,
        workspaceDir,
        log: strategyLog,
        persistArtifact,
      };
      const prepareResult = await reviewStrategy.prepare(prepareContext);

      strategyLog(`Prompt for ${file}`, prepareResult.prompt);

      const turn = await thread.runStreamed(prepareResult.prompt, {
        outputSchema: prepareResult.outputSchema,
      });
      let response = "<no response>";
      for await (const event of turn.events) {
        console.log(`[inject] Codex event: ${JSON.stringify(event)}`);
        if (event.type === "item.completed") {
          if (event.item.type === "agent_message") {
            response = event.item.text;
          }
        }
      }
      const processContext: StrategyProcessContext = {
        filePath: file,
        responseText: response,
        events: null,
        options: reviewOptions,
        metadata: prepareResult.metadata,
        log: strategyLog,
        persistArtifact,
      };
      const strategyResult: StrategyRunResult =
        await reviewStrategy.process(processContext);

      strategyLog(`Codex review for ${file}`, strategyResult.rawResponse);

      if (strategyResult.artifacts) {
        strategyResult.artifacts.forEach((artifact) => {
          console.log(
            `[inject] Saved ${artifact.label} -> ${joinPath(
              reviewOptions.artifactsDir,
              artifact.relativePath
            )}`
          );
        });
      }

      const result: CodexReviewResult = {
        file,
        response: strategyResult.rawResponse,
      };
      const elapsedMs = performance.now() - fileStart;
      console.log(
        `[inject] Review completed for ${file} in ${formatDuration(elapsedMs)}`
      );

      if (fileCallback) {
        try {
          await sendFileCallback(fileCallback, {
            jobId,
            sandboxInstanceId,
            filePath: file,
            commitRef: commitRef ?? undefined,
            codexReviewOutput: result,
          });
          console.log(`[inject] File callback delivered for ${file}`);
        } catch (callbackError) {
          const callbackMessage =
            callbackError instanceof Error
              ? callbackError.message
              : String(callbackError ?? "unknown callback error");
          console.error(
            `[inject] Failed to send file callback for ${file}: ${callbackMessage}`
          );
        }
      }

      return result;
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : String(error ?? "unknown error");
      const elapsedMs = performance.now() - fileStart;
      console.error(`[inject] Codex review failed for ${file}: ${reason}`);
      console.error(
        `[inject] Review for ${file} failed after ${formatDuration(elapsedMs)}`
      );
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(reason);
    }
  });

  const settledResults = await Promise.allSettled(reviewPromises);
  const failureCount = settledResults.filter(
    (result) => result.status === "rejected"
  ).length;

  if (failureCount > 0) {
    throw new Error(
      `[inject] Codex review encountered ${failureCount} failure(s). See logs above.`
    );
  }

  const collectedResults = settledResults
    .filter(isFulfilled)
    .map((result) => result.value);

  console.log(
    `[inject] Codex reviews completed in ${formatDuration(
      performance.now() - reviewStart
    )}.`
  );
  return collectedResults;
}

async function main(): Promise<void> {
  const workspaceDir = requireEnv("WORKSPACE_DIR");
  const prUrl = requireEnv("PR_URL");
  const headRepoUrl = requireEnv("GIT_REPO_URL");
  const headRefName = requireEnv("GIT_BRANCH");
  const baseRepoUrl = requireEnv("BASE_REPO_URL");
  const baseRefName = requireEnv("BASE_REF_NAME");
  const callbackUrl = process.env.CALLBACK_URL ?? null;
  const callbackToken = process.env.CALLBACK_TOKEN ?? null;
  const fileCallbackUrl = process.env.FILE_CALLBACK_URL ?? null;
  const fileCallbackToken = process.env.FILE_CALLBACK_TOKEN ?? null;
  const jobId = requireEnv("JOB_ID");
  const sandboxInstanceId = requireEnv("SANDBOX_INSTANCE_ID");
  const logFilePath = process.env.LOG_FILE_PATH ?? null;
  const logSymlinkPath = process.env.LOG_SYMLINK_PATH ?? null;
  const codeReviewOutputPathEnv = process.env.CODE_REVIEW_OUTPUT_PATH ?? null;
  const codeReviewOutputSymlinkPath =
    process.env.CODE_REVIEW_OUTPUT_SYMLINK_PATH ?? null;
  const teamId = process.env.TEAM_ID ?? null;
  const repoFullName = process.env.REPO_FULL_NAME ?? null;
  const commitRef = process.env.COMMIT_REF ?? null;

  const callbackContext: CallbackContext | null =
    callbackUrl && callbackToken
      ? {
          url: callbackUrl,
          token: callbackToken,
          jobId,
          sandboxInstanceId,
        }
      : null;

  const fileCallbackContext: FileCallbackContext | null =
    fileCallbackUrl && fileCallbackToken
      ? {
          url: fileCallbackUrl,
          token: fileCallbackToken,
          jobId,
          sandboxInstanceId,
          commitRef,
        }
      : null;

  if (logFilePath) {
    console.log(`[inject] Logging output to ${logFilePath}`);
  }
  if (logSymlinkPath) {
    console.log(`[inject] Workspace log symlink will be ${logSymlinkPath}`);
  }

  const headRepo = parseRepoUrl(headRepoUrl);
  const baseRepo = parseRepoUrl(baseRepoUrl);

  console.log(`[inject] Preparing review workspace for ${prUrl}`);
  console.log(
    `[inject] Head ${headRepo.owner}/${headRepo.name}@${headRefName}`
  );
  console.log(
    `[inject] Base ${baseRepo.owner}/${baseRepo.name}@${baseRefName}`
  );

  const codeReviewOutputPath =
    codeReviewOutputPathEnv && codeReviewOutputPathEnv.trim().length > 0
      ? codeReviewOutputPathEnv.trim()
      : logFilePath
          ? joinPath(dirname(logFilePath), "code-review-output.json")
          : null;

  async function writeJsonFileIfPossible(
    path: string | null,
    data: unknown,
    label: string
  ): Promise<boolean> {
    if (!path) {
      return false;
    }
    try {
      const json = JSON.stringify(data, null, 2);
      await writeFile(path, `${json}\n`);
      console.log(`[inject] Saved ${label} to ${path}`);
      return true;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error ?? "unknown error");
      console.warn(
        `[inject] Failed to write ${label} to ${path}: ${message}`
      );
      return false;
    }
  }

  async function createSymlinkIfPossible(
    targetPath: string,
    symlinkPath: string | null,
    label: string
  ): Promise<void> {
    if (!symlinkPath) {
      return;
    }
    try {
      await runCommand("ln", ["-sf", targetPath, symlinkPath]);
      console.log(
        `[inject] Linked ${symlinkPath} -> ${targetPath} for ${label}`
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error ?? "unknown error");
      console.warn(
        `[inject] Failed to link ${symlinkPath} -> ${targetPath}: ${message}`
      );
    }
  }

  const persistCodeReviewOutput = async (
    data: unknown
  ): Promise<void> => {
    const label = "code review output";
    const wrote = await writeJsonFileIfPossible(
      codeReviewOutputPath,
      data,
      label
    );
    if (wrote && codeReviewOutputPath) {
      await createSymlinkIfPossible(
        codeReviewOutputPath,
        codeReviewOutputSymlinkPath,
        label
      );
    }
  };

  const jobStart = performance.now();

  const githubToken = getGithubToken();
  if (githubToken) {
    try {
      await configureGitCredentials(githubToken);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error ?? "unknown error");
      console.warn(
        `[inject] Failed to configure Git credentials automatically: ${message}`
      );
    }
  }

  try {
    console.log(`[inject] Clearing workspace ${workspaceDir}...`);
    await rm(workspaceDir, { recursive: true, force: true });

    const cloneAndCheckout = (async () => {
      console.log(`[inject] Cloning ${headRepoUrl} into ${workspaceDir}...`);
      await runCommand("git", ["clone", headRepoUrl, workspaceDir]);
      console.log(`[inject] Checking out branch ${headRefName}...`);
      await runCommand("git", ["checkout", headRefName], {
        cwd: workspaceDir,
      });
    })();

    const installCodex = (async () => {
      console.log("[inject] Installing runtime dependencies globally...");
      await runCommand("bun", [
        "add",
        "-g",
        "@openai/codex@latest",
        "@openai/codex-sdk@latest",
        "zod@latest",
      ]);
    })();

    await Promise.all([cloneAndCheckout, installCodex]);

    if (logFilePath && logSymlinkPath) {
      try {
        await runCommand("ln", ["-sf", logFilePath, logSymlinkPath]);
        console.log(
          `[inject] Linked ${logSymlinkPath} -> ${logFilePath} for log access`
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error ?? "unknown error");
        console.warn(
          `[inject] Failed to create workspace log symlink: ${message}`
        );
      }
    }

    const baseRemote =
      headRepo.owner === baseRepo.owner && headRepo.name === baseRepo.name
        ? "origin"
        : "base";

    if (baseRemote !== "origin") {
      console.log(`[inject] Adding remote ${baseRemote} -> ${baseRepoUrl}`);
      await runCommand("git", ["remote", "add", baseRemote, baseRepoUrl], {
        cwd: workspaceDir,
      });
    }

    console.log(`[inject] Fetching ${baseRemote}/${baseRefName}...`);
    await runCommand("git", ["fetch", baseRemote, baseRefName], {
      cwd: workspaceDir,
    });

    const baseRevision = `${baseRemote}/${baseRefName}`;
    const mergeBaseRaw = await runCommandCapture(
      "git",
      ["merge-base", "HEAD", baseRevision],
      { cwd: workspaceDir }
    );
    const mergeBaseRevision = mergeBaseRaw.split("\n")[0]?.trim();
    if (!mergeBaseRevision) {
      throw new Error(
        `[inject] Unable to determine merge base between HEAD and ${baseRevision}`
      );
    }
    console.log(
      `[inject] Using merge-base ${mergeBaseRevision} for diff comparisons`
    );
    const [changedFilesOutput, modifiedFilesOutput] = await Promise.all([
      runCommandCapture(
        "git",
        ["diff", "--name-only", `${mergeBaseRevision}..HEAD`],
        {
          cwd: workspaceDir,
        }
      ),
      runCommandCapture(
        "git",
        [
          "diff",
          "--diff-filter=M",
          "--name-only",
          `${mergeBaseRevision}..HEAD`,
        ],
        { cwd: workspaceDir }
      ),
    ]);

    const changedFiles = parseFileList(changedFilesOutput);
    const modifiedFiles = parseFileList(modifiedFilesOutput);

    logFileSection("All changed files", changedFiles);
    logFileSection("All modified files", modifiedFiles);

    const [textChangedFiles, textModifiedFiles] = await Promise.all([
      filterTextFiles(workspaceDir, mergeBaseRevision, changedFiles),
      filterTextFiles(workspaceDir, mergeBaseRevision, modifiedFiles),
    ]);

    logFileSection("Changed text files", textChangedFiles);
    logFileSection("Modified text files", textModifiedFiles);

    const codexReviews = await runCodexReviews({
      workspaceDir,
      baseRevision: mergeBaseRevision,
      files: textChangedFiles,
      jobId,
      sandboxInstanceId,
      commitRef,
      fileCallback: fileCallbackContext,
    });

    console.log("[inject] Done with PR review.");
    console.log(
      `[inject] Total review runtime ${formatDuration(
        performance.now() - jobStart
      )}`
    );

  const reviewOutput: Record<string, unknown> = {
    prUrl,
    repoFullName: repoFullName ?? `${headRepo.owner}/${headRepo.name}`,
    headRefName,
    baseRefName,
    mergeBaseRevision,
    changedTextFiles: textChangedFiles,
    modifiedTextFiles: textModifiedFiles,
    logFilePath,
    logSymlinkPath,
    commitRef,
    teamId,
    codexReviews,
    strategy: reviewStrategy.id,
    artifactsDir: reviewOptions.artifactsDir,
    diffArtifactMode: reviewOptions.diffArtifactMode,
  };

    await persistCodeReviewOutput(reviewOutput);

    if (callbackContext) {
      await sendCallback(callbackContext, {
        status: "success",
        jobId,
        sandboxInstanceId,
        codeReviewOutput: reviewOutput,
      });
      console.log("[inject] Success callback delivered.");
    } else {
      console.log("[inject] Callback disabled; skipping success callback.");
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    console.error(`[inject] Error during review: ${message}`);
    console.error(
      `[inject] Total runtime before failure ${formatDuration(
        performance.now() - jobStart
      )}`
    );
    await persistCodeReviewOutput({
      status: "error",
      jobId,
      sandboxInstanceId,
      prUrl,
      error: message,
    });
    if (callbackContext) {
      try {
        await sendCallback(callbackContext, {
          status: "error",
          jobId,
          sandboxInstanceId,
          errorCode: "inject_failed",
          errorDetail: message,
        });
        console.log("[inject] Failure callback delivered.");
      } catch (callbackError) {
        const callbackMessage =
          callbackError instanceof Error
            ? callbackError.message
            : String(callbackError ?? "unknown callback error");
        console.error(
          `[inject] Failed to send error callback: ${callbackMessage}`
        );
      }
    } else {
      console.log("[inject] Callback disabled; skipping error callback.");
    }
    throw error;
  }
}

await main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error
  );
  process.exit(1);
});
