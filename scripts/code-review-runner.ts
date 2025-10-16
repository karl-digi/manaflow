#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { MorphCloudClient } from "morphcloud";

const DEFAULT_MORPH_SNAPSHOT_ID = "snapshot_vb7uqz8o";
const WORKSPACE_ROOT = "/root/workspace";

type RunnerConfig = {
  jobId: string;
  teamId: string;
  repoFullName: string;
  repoUrl: string;
  prNumber: number;
  commitRef: string;
  callbackUrl: string;
  callbackToken: string;
};

type CallbackPayload =
  | {
      status: "success";
      jobId: string;
      sandboxInstanceId: string;
      codeReviewOutput: Record<string, unknown>;
    }
  | {
      status: "error";
      jobId: string;
      sandboxInstanceId?: string;
      errorCode: string;
      errorDetail?: string;
    };

function parseArgs(): RunnerConfig {
  const rawArg = process.argv[2];
  if (!rawArg) {
    throw new Error("Missing runner configuration payload");
  }
  const payload = JSON.parse(rawArg) as RunnerConfig;
  if (!payload.jobId || !payload.repoUrl || !payload.callbackUrl) {
    throw new Error("Runner configuration is missing required fields");
  }
  return payload;
}

async function execOrThrow(
  instance: Awaited<ReturnType<MorphCloudClient["instances"]["start"]>>,
  command: string,
) {
  const result = await instance.exec(command);
  const exitCode = result.exit_code ?? 0;
  if (exitCode !== 0) {
    const stdout = (result.stdout ?? "").slice(0, 2048);
    const stderr = (result.stderr ?? "").slice(0, 2048);
    throw new Error(
      `Command failed (exit ${exitCode}): ${command}\nstdout: ${stdout}\nstderr: ${stderr}`,
    );
  }
  return result;
}

async function sendCallback(
  config: RunnerConfig,
  payload: CallbackPayload,
): Promise<void> {
  const response = await fetch(config.callbackUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.callbackToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Callback failed with status ${response.status}: ${text.slice(0, 2048)}`,
    );
  }
}

function ensureMorphClient(): MorphCloudClient {
  const apiKey = process.env.MORPH_API_KEY;
  if (!apiKey) {
    throw new Error("MORPH_API_KEY is not configured");
  }
  return new MorphCloudClient({ apiKey });
}

async function main() {
  const config = parseArgs();
  const morphClient = ensureMorphClient();

  let instance:
    | Awaited<ReturnType<MorphCloudClient["instances"]["start"]>>
    | undefined;

  try {
    instance = await morphClient.instances.start({
      snapshotId: DEFAULT_MORPH_SNAPSHOT_ID,
      ttlSeconds: 60 * 30,
      ttlAction: "pause",
      metadata: {
        app: "cmux-automated-code-review",
        jobId: config.jobId,
        teamId: config.teamId,
        repo: config.repoFullName,
        commitRef: config.commitRef,
        runId: randomUUID(),
      },
    });
    await instance.setWakeOn(true, true);

    const sandboxInstanceId = instance.id;
    const repoName = config.repoFullName.split("/")[1] ?? config.repoFullName;
    const repoDirectory = `${WORKSPACE_ROOT}/${repoName}`;
    const commitSegment = config.commitRef.replace(/[^a-zA-Z0-9]/g, "").slice(0, 7) || "head";
    const branchName = `code-review-pr-${config.prNumber}-${commitSegment}`;

    await execOrThrow(
      instance,
      `bash -lc "set -euo pipefail && mkdir -p ${WORKSPACE_ROOT} && cd ${WORKSPACE_ROOT} && rm -rf ${repoName} && git clone ${config.repoUrl} ${repoName}"`,
    );

    await execOrThrow(
      instance,
      `bash -lc "set -euo pipefail && cd ${repoDirectory} && git fetch --force origin pull/${config.prNumber}/head:${branchName}"`,
    );

    await execOrThrow(
      instance,
      `bash -lc "set -euo pipefail && cd ${repoDirectory} && git checkout ${branchName}"`,
    );

    const lsResult = await execOrThrow(
      instance,
      `bash -lc "set -euo pipefail && ls ${WORKSPACE_ROOT}"`,
    );

    await sendCallback(config, {
      status: "success",
      jobId: config.jobId,
      sandboxInstanceId,
      codeReviewOutput: {
        lsOutput: (lsResult.stdout ?? "").trim(),
      },
    });

    await instance.pause().catch((error) => {
      console.warn(
        `[code-review-runner] Failed to pause Morph instance ${sandboxInstanceId}`,
        error,
      );
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    console.error("[code-review-runner] Failure", message);

    let sandboxInstanceId: string | undefined;
    if (instance) {
      sandboxInstanceId = instance.id;
    }

    try {
      await sendCallback(config, {
        status: "error",
        jobId: config.jobId,
        sandboxInstanceId,
        errorCode: "runner_failed",
        errorDetail: message,
      });
    } catch (callbackError) {
      console.error(
        "[code-review-runner] Failed to post callback",
        callbackError,
      );
    }

    if (instance) {
      await instance.pause().catch((pauseError) => {
        console.warn(
          `[code-review-runner] Failed to pause Morph instance ${instance?.id}`,
          pauseError,
        );
      });
    }
  }
}

await main();
