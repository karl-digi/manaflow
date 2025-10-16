#!/usr/bin/env bun

import type { Instance } from "morphcloud";
import { MorphCloudClient } from "morphcloud";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_PR_URL = "https://github.com/manaflow-ai/cmux/pull/653";
const DEFAULT_MORPH_SNAPSHOT_ID = "snapshot_vb7uqz8o";
const OPEN_VSCODE_PORT = 39378;
const injectScriptSourcePromise = readFile(
  new URL("./pr-review-inject.ts", import.meta.url),
  "utf8"
);

interface ParsedPrUrl {
  owner: string;
  repo: string;
  number: number;
}

interface PrMetadata extends ParsedPrUrl {
  prUrl: string;
  headRefName: string;
  headRepoOwner: string;
  headRepoName: string;
}

interface GhPrViewResponse {
  headRefName?: string;
  headRepository?: {
    name?: string;
  } | null;
  headRepositoryOwner?: {
    login?: string;
  } | null;
}

function parsePrUrl(prUrl: string): ParsedPrUrl {
  let url: URL;
  try {
    url = new URL(prUrl);
  } catch (_error) {
    throw new Error(`Invalid PR URL: ${prUrl}`);
  }

  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts.length < 3 || pathParts[2] !== "pull") {
    throw new Error(
      `PR URL must be in the form https://github.com/<owner>/<repo>/pull/<number>, received: ${prUrl}`
    );
  }

  const [owner, repo, _pullSegment, prNumberPart] = pathParts;
  const prNumber = Number(prNumberPart);
  if (!Number.isInteger(prNumber)) {
    throw new Error(`Invalid PR number in URL: ${prUrl}`);
  }

  return { owner, repo, number: prNumber };
}

async function fetchPrMetadata(prUrl: string): Promise<PrMetadata> {
  const parsed = parsePrUrl(prUrl);

  let stdout: string;
  try {
    const result = await execFileAsync("gh", [
      "pr",
      "view",
      prUrl,
      "--json",
      "headRefName,headRepositoryOwner,headRepository",
    ]);
    stdout = result.stdout;
  } catch (error) {
    const stderr =
      error instanceof Error && "stderr" in error ? String(error.stderr) : "";
    throw new Error(
      `Failed to query PR metadata with gh CLI. ${stderr ? `stderr: ${stderr}` : ""}`.trim()
    );
  }

  let data: GhPrViewResponse;
  try {
    data = JSON.parse(stdout) as GhPrViewResponse;
  } catch (_error) {
    throw new Error(
      `Unable to parse gh CLI response as JSON. Output: ${stdout}`
    );
  }

  const headRefName = data.headRefName;
  if (typeof headRefName !== "string" || headRefName.length === 0) {
    throw new Error("PR metadata is missing headRefName.");
  }

  const headRepoName = data.headRepository?.name || parsed.repo;
  const headRepoOwner = data.headRepositoryOwner?.login || parsed.owner;

  return {
    ...parsed,
    prUrl,
    headRefName,
    headRepoName,
    headRepoOwner,
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function startTiming(label: string): () => void {
  const startTime = performance.now();
  let finished = false;
  return () => {
    if (finished) {
      return;
    }
    finished = true;
    const durationMs = performance.now() - startTime;
    const seconds = durationMs / 1000;
    console.log(`[timing] ${label} ${seconds.toFixed(2)}s`);
  };
}

async function execOrThrow(instance: Instance, command: string): Promise<void> {
  const result = await instance.exec(command);
  const exitCode = result.exit_code ?? 0;
  if (exitCode !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(
      [
        `Command failed: ${command}`,
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    );
  }
  if (result.stdout && result.stdout.length > 0) {
    process.stdout.write(result.stdout);
    if (!result.stdout.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
  if (result.stderr && result.stderr.length > 0) {
    process.stderr.write(result.stderr);
    if (!result.stderr.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }
}

function describeServices(instance: Instance): void {
  if (!instance.networking?.httpServices?.length) {
    console.log("No HTTP services exposed on the Morph instance yet.");
    return;
  }

  instance.networking.httpServices.forEach((service) => {
    console.log(
      `HTTP service ${service.name ?? `port-${service.port}`} -> ${service.url}`
    );
  });
}

function buildMetadata(pr: PrMetadata): Record<string, string> {
  return {
    purpose: "pr-review",
    prUrl: pr.prUrl,
    repo: `${pr.owner}/${pr.repo}`,
    head: `${pr.headRepoOwner}/${pr.headRepoName}#${pr.headRefName}`,
  };
}

function logOpenVscodeUrl(instance: Instance, workspacePath: string): void {
  const services = instance.networking?.httpServices ?? [];
  const vscodeService = services.find(
    (service) =>
      service.port === OPEN_VSCODE_PORT ||
      service.name === `port-${OPEN_VSCODE_PORT}`
  );

  if (!vscodeService) {
    console.warn(
      `Warning: could not find exposed OpenVSCode service on port ${OPEN_VSCODE_PORT}.`
    );
    return;
  }

  try {
    const vscodeUrl = new URL(vscodeService.url);
    vscodeUrl.searchParams.set("folder", workspacePath);
    console.log(`OpenVSCode (${OPEN_VSCODE_PORT}): ${vscodeUrl.toString()}`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    console.warn(
      `Warning: unable to format OpenVSCode URL for port ${OPEN_VSCODE_PORT}: ${message}`
    );
  }
}

async function waitForUserToConfirmStop(): Promise<void> {
  if (!process.stdin.readable) {
    return;
  }

  console.log("Press any key to stop the Morph instance...");

  await new Promise<void>((resolve) => {
    const onData = (): void => {
      process.stdin.pause();
      process.stdin.off("data", onData);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      resolve();
    };

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    process.stdin.resume();
    process.stdin.once("data", onData);
  });
}

async function main(): Promise<void> {
  const prUrlFromCli = process.argv[2];
  const prUrl =
    prUrlFromCli && prUrlFromCli.length > 0 ? prUrlFromCli : DEFAULT_PR_URL;

  console.log(`Preparing Morph review environment for ${prUrl}`);
  console.log("Fetching PR metadata...");
  const finishFetchMetadata = startTiming("fetch PR metadata");
  let prMetadata: PrMetadata;
  try {
    prMetadata = await fetchPrMetadata(prUrl);
  } finally {
    finishFetchMetadata();
  }

  console.log(
    `Targeting ${prMetadata.headRepoOwner}/${prMetadata.headRepoName}@${prMetadata.headRefName}`
  );

  const client = new MorphCloudClient();
  let instance: Instance | null = null;

  try {
    console.log(
      `Starting Morph instance from snapshot ${DEFAULT_MORPH_SNAPSHOT_ID}...`
    );
    const finishStartInstance = startTiming("start Morph instance");
    try {
      instance = await client.instances.start({
        snapshotId: DEFAULT_MORPH_SNAPSHOT_ID,
        ttlSeconds: 60 * 60 * 2,
        ttlAction: "pause",
        metadata: buildMetadata(prMetadata),
      });
    } finally {
      finishStartInstance();
    }

    console.log("Waiting for Morph instance to be ready...");
    const finishWaitReady = startTiming("wait for Morph instance ready");
    try {
      await instance.waitUntilReady();
    } finally {
      finishWaitReady();
    }
    console.log(`Instance ${instance.id} is ready.`);

    console.log("Fetching updated instance metadata...");
    const finishRefreshInstance = startTiming("fetch instance metadata");
    let refreshedInstance: Instance;
    try {
      refreshedInstance = await client.instances.get({
        instanceId: instance.id,
      });
    } finally {
      finishRefreshInstance();
    }

    const baseDir = "/root/workspace";
    describeServices(refreshedInstance);
    logOpenVscodeUrl(refreshedInstance, baseDir);

    const repoDir = baseDir;
    const cloneUrl = `https://github.com/${prMetadata.headRepoOwner}/${prMetadata.headRepoName}.git`;

    console.log("Preparing repository inside Morph instance...");
    const finishPrepareRepo = startTiming("prepare repository");
    const remoteScriptPath = "/root/pr-review-inject.ts";
    const injectScriptSource = await injectScriptSourcePromise;
    const envAssignments = [
      ["WORKSPACE_DIR", baseDir],
      ["GIT_REPO_URL", cloneUrl],
      ["GIT_BRANCH", prMetadata.headRefName],
    ]
      .map(([key, value]) => `${key}=${shellQuote(value)}`)
      .join(" ");
    const injectCommand =
      [
        `cat <<'EOF_PR_REVIEW_INJECT' > ${shellQuote(remoteScriptPath)}`,
        injectScriptSource,
        "EOF_PR_REVIEW_INJECT",
        `${envAssignments} bun ${shellQuote(remoteScriptPath)}`,
      ].join("\n") + "\n";
    try {
      await execOrThrow(instance, injectCommand);
    } finally {
      finishPrepareRepo();
    }

    console.log(`Repository ready at ${repoDir}`);
    console.log(
      `Morph instance ${instance.id} provisioned for PR ${prMetadata.prUrl}`
    );
  } finally {
    if (instance) {
      try {
        await waitForUserToConfirmStop();
        console.log(`Stopping Morph instance ${instance.id}...`);
        const finishStopInstance = startTiming("stop Morph instance");
        try {
          await instance.stop();
          console.log(`Instance ${instance.id} stopped.`);
        } finally {
          finishStopInstance();
        }
      } catch (stopError) {
        const message =
          stopError instanceof Error
            ? stopError.message
            : typeof stopError === "string"
              ? stopError
              : JSON.stringify(stopError);
        console.warn(
          `Warning: failed to stop instance ${instance.id}: ${message}`
        );
      }
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
