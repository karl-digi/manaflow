import {
  createMorphCloudClient,
  startInstanceInstancePost,
  getInstanceInstanceInstanceIdGet,
  execInstanceInstanceIdExecPost,
  stopInstanceInstanceInstanceIdDelete,
  type InstanceModel,
} from "@cmux/morphcloud-openapi-client";
import { env } from "../_shared/convex-env";
import { fetchInstallationAccessToken } from "../_shared/githubApp";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

const TOKEN_REDACTION = "[TOKEN_REDACTED]";

const maskSensitiveValue = (
  value: string | undefined | null,
  sensitiveValues: Array<string | undefined>,
): string | undefined => {
  if (value == null) {
    return undefined;
  }
  let masked = value;
  for (const sensitive of sensitiveValues) {
    if (!sensitive) {
      continue;
    }
    masked = masked.split(sensitive).join(TOKEN_REDACTION);
  }
  return masked;
};

async function waitForInstanceReady(
  morphClient: ReturnType<typeof createMorphCloudClient>,
  instanceId: string,
  readinessTimeoutMs = 5 * 60 * 1000,
): Promise<InstanceModel> {
  const start = Date.now();
  while (true) {
    const response = await getInstanceInstanceInstanceIdGet({
      client: morphClient,
      path: { instance_id: instanceId },
    });

    if (response.error) {
      throw new Error(`Failed to get instance status: ${JSON.stringify(response.error)}`);
    }

    const instance = response.data;
    if (!instance) {
      throw new Error("Instance data missing from response");
    }

    if (instance.status === "ready") {
      return instance;
    }
    if (instance.status === "error") {
      throw new Error("Morph instance entered error state");
    }
    if (Date.now() - start > readinessTimeoutMs) {
      throw new Error("Morph instance did not become ready before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function startMorphInstance(
  morphClient: ReturnType<typeof createMorphCloudClient>,
  options: {
    snapshotId: string;
    metadata?: Record<string, string>;
    ttlSeconds?: number;
    ttlAction?: "stop" | "pause";
    readinessTimeoutMs?: number;
  },
): Promise<InstanceModel> {
  const response = await startInstanceInstancePost({
    client: morphClient,
    query: {
      snapshot_id: options.snapshotId,
    },
    body: {
      metadata: options.metadata,
      ttl_seconds: options.ttlSeconds,
      ttl_action: options.ttlAction,
    },
  });

  if (response.error) {
    throw new Error(`Failed to start instance: ${JSON.stringify(response.error)}`);
  }

  const instance = response.data;
  if (!instance) {
    throw new Error("Instance data missing from start response");
  }

  return await waitForInstanceReady(
    morphClient,
    instance.id,
    options.readinessTimeoutMs,
  );
}

async function stopMorphInstance(
  morphClient: ReturnType<typeof createMorphCloudClient>,
  instanceId: string,
) {
  await stopInstanceInstanceInstanceIdDelete({
    client: morphClient,
    path: { instance_id: instanceId },
  });
}

async function triggerWorkerScreenshotCollection(
  workerUrl: string,
): Promise<void> {
  const pollingBase = `${workerUrl}/socket.io/?EIO=4&transport=polling`;

  // Step 1: Handshake to get session ID
  const handshakeResponse = await fetch(`${pollingBase}&t=${Date.now()}`, {
    signal: AbortSignal.timeout(10_000),
  });
  const handshakeText = await handshakeResponse.text();

  // Parse session ID from response like: 0{"sid":"xxx","upgrades":[],"pingInterval":25000,"pingTimeout":20000}
  const startIdx = handshakeText.indexOf('{');
  const endIdx = handshakeText.lastIndexOf('}') + 1;
  if (startIdx === -1 || endIdx === 0) {
    throw new Error("Failed to parse Socket.IO handshake response");
  }
  const handshake = JSON.parse(handshakeText.slice(startIdx, endIdx)) as { sid: string };
  const sid = handshake.sid;

  // Step 2: Connect to /management namespace
  await fetch(`${pollingBase}&sid=${sid}&t=${Date.now()}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: "40/management",
    signal: AbortSignal.timeout(10_000),
  });

  // Step 3: Send worker:start-screenshot-collection event
  await fetch(`${pollingBase}&sid=${sid}&t=${Date.now()}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: `42/management,${JSON.stringify(["worker:start-screenshot-collection"])}`,
    signal: AbortSignal.timeout(10_000),
  });
}

export async function runPreviewJob( 
  ctx: ActionCtx,
  previewRunId: Id<"previewRuns">,
) {
  const morphApiKey = env.MORPH_API_KEY;
  if (!morphApiKey) {
    console.warn("[preview-jobs] MORPH_API_KEY not configured; skipping run", {
      previewRunId,
    });
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "failed",
      stateReason: "Morph API key is not configured",
    });
    return;
  }

  const morphClient = createMorphCloudClient({
    auth: morphApiKey,
  });

  const payload = await ctx.runQuery(internal.previewRuns.getRunWithConfig, {
    previewRunId,
  });
  if (!payload?.run || !payload.config) {
    console.warn("[preview-jobs] Missing run/config for dispatch", {
      previewRunId,
    });
    return;
  }

  const { run, config } = payload;

  if (!config.environmentId) {
    console.warn("[preview-jobs] Preview config missing environmentId; skipping run", {
      previewRunId,
      repoFullName: run.repoFullName,
      prNumber: run.prNumber,
    });
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "skipped",
      stateReason: "No environment configured for preview run",
    });
    return;
  }

  const environment = await ctx.runQuery(internal.environments.getByIdInternal, {
    id: config.environmentId,
  });

  if (!environment) {
    console.warn("[preview-jobs] Environment not found for preview run; skipping", {
      previewRunId,
      environmentId: config.environmentId,
    });
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "skipped",
      stateReason: "Environment not found for preview run",
    });
    return;
  }

  if (!environment.morphSnapshotId) {
    console.warn("[preview-jobs] Environment missing morph snapshot; skipping", {
      previewRunId,
      environmentId: environment._id,
    });
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "skipped",
      stateReason: "Environment has no associated Morph snapshot",
    });
    return;
  }

  const snapshotId = environment.morphSnapshotId;
  let instance: InstanceModel | null = null;

  console.log("[preview-jobs] Launching Morph instance", {
    previewRunId,
    snapshotId,
    repoFullName: run.repoFullName,
    prNumber: run.prNumber,
    headSha: run.headSha,
    baseSha: run.baseSha,
  });

  await ctx.runMutation(internal.previewRuns.updateStatus, {
    previewRunId,
    status: "running",
    stateReason: "Provisioning Morph workspace",
  });

  try {
    instance = await startMorphInstance(morphClient, {
      snapshotId,
      metadata: {
        app: "cmux-preview",
        previewRunId: previewRunId,
        repo: run.repoFullName,
        prNumber: String(run.prNumber),
        headSha: run.headSha,
      },
      ttlSeconds: 600,
      ttlAction: "stop",
      readinessTimeoutMs: 5 * 60 * 1000,
    });

    const workerService = instance.networking?.http_services?.find(
      (service: { port?: number }) => service.port === 39377,
    );
    if (!workerService) {
      throw new Error("Worker service not found on instance");
    }

    const vscodeService = instance.networking?.http_services?.find(
      (service: { port?: number }) => service.port === 39378,
    );
    const vscodeUrl = vscodeService?.url
      ? `${vscodeService.url}?folder=/root/workspace`
      : null;

    console.log("[preview-jobs] Worker service ready", {
      previewRunId,
      instanceId: instance.id,
      vscodeUrl,
      workerUrl: workerService.url,
      workerHealthUrl: `${workerService.url}/health`,
      screenshotLogUrl: `${workerService.url.replace(':39377', ':39376')}/file?path=/root/.cmux/screenshot-collector/screenshot-collector.log`,
    });

    // Step 2: Fetch latest changes and checkout PR
    // Preview environment snapshots have the repo pre-cloned at /root/workspace
    const repoSearchRoot = "/root/workspace";

    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "running",
      stateReason: "Fetching latest changes",
    });

    // The repository is always at /root/workspace directly
    const repoDir = repoSearchRoot;

    console.log("[preview-jobs] Using pre-cloned repository", {
      previewRunId,
      repoFullName: run.repoFullName,
      repoDir,
    });

    console.log("[preview-jobs] Starting GitHub authentication setup", {
      previewRunId,
      hasInstallationId: Boolean(run.repoInstallationId),
      installationId: run.repoInstallationId,
    });

    // Get GitHub App installation token for fetching from private repos
    if (run.repoInstallationId) {
      console.log("[preview-jobs] Fetching installation access token", {
        previewRunId,
        installationId: run.repoInstallationId,
      });

      let accessToken: string | null = null;
      try {
        accessToken = await fetchInstallationAccessToken(run.repoInstallationId);
      } catch (error) {
        console.error("[preview-jobs] Failed to fetch installation token", {
          previewRunId,
          installationId: run.repoInstallationId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      console.log("[preview-jobs] Installation token fetch result", {
        previewRunId,
        hasToken: Boolean(accessToken),
      });

      if (accessToken) {
        // Escape the token for shell (same as singleQuote in sandboxes/shell.ts)
        const escapedToken = `'${accessToken.replace(/'/g, "'\\''")}'`;
        const sensitiveValues = [accessToken, escapedToken, `'${accessToken}'`];
        const maskLogValue = (value?: string | null) =>
          maskSensitiveValue(value, sensitiveValues);
        const maskAndSlice = (value?: string | null, length = 500) =>
          maskLogValue(value)?.slice(0, length);

        // Configure GitHub authentication using gh CLI with retry logic (same approach as cloud workspaces)
        let lastError: Error | undefined;
        let authSucceeded = false;
        const maxRetries = 5;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const shellScript = `cd ${repoDir} && printf %s ${escapedToken} | gh auth login --with-token && gh auth setup-git 2>&1`;
            const commandPreview = shellScript.includes(escapedToken)
              ? shellScript.replace(escapedToken, "'[TOKEN_REDACTED]'")
              : shellScript;
            console.log("[preview-jobs] GitHub auth attempt", {
              previewRunId,
              attempt,
              maxRetries,
              commandLength: shellScript.length,
              commandPreview: commandPreview.slice(0, 150),
            });

            const ghAuthResponse = await execInstanceInstanceIdExecPost({
              client: morphClient,
              path: { instance_id: instance.id },
              body: {
                command: ["bash", "-lc", shellScript],
              },
            });

            console.log("[preview-jobs] GitHub auth response received", {
              previewRunId,
              attempt,
              hasError: Boolean(ghAuthResponse.error),
              exitCode: ghAuthResponse.data?.exit_code,
              stdout: maskAndSlice(ghAuthResponse.data?.stdout),
              stderr: maskAndSlice(ghAuthResponse.data?.stderr),
            });

            if (ghAuthResponse.error) {
              lastError = new Error(`API error: ${JSON.stringify(ghAuthResponse.error)}`);
              console.error("[preview-jobs] GitHub auth API error", {
                previewRunId,
                attempt,
                error: ghAuthResponse.error,
              });
            } else if (ghAuthResponse.data?.exit_code === 0) {
              console.log("[preview-jobs] GitHub authentication configured successfully", {
                previewRunId,
                attempt,
                stdout: maskAndSlice(ghAuthResponse.data?.stdout),
                stderr: maskAndSlice(ghAuthResponse.data?.stderr),
              });
              authSucceeded = true;
              break;
            } else {
              const rawErrorMessage = ghAuthResponse.data?.stderr || ghAuthResponse.data?.stdout || "Unknown error";
              const maskedErrorMessage = maskLogValue(rawErrorMessage) || "Unknown error";
              lastError = new Error(`GitHub auth failed: ${maskedErrorMessage.slice(0, 500)}`);
              console.warn("[preview-jobs] GitHub auth command failed", {
                previewRunId,
                attempt,
                exitCode: ghAuthResponse.data?.exit_code,
                stderr: maskAndSlice(ghAuthResponse.data?.stderr, 200),
                stdout: maskAndSlice(ghAuthResponse.data?.stdout, 200),
              });
            }

            if (attempt < maxRetries) {
              const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
              console.log("[preview-jobs] Retrying GitHub auth", {
                previewRunId,
                attempt,
                delayMs: delay,
              });
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          } catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            const maskedMessage = maskLogValue(normalizedError.message) || normalizedError.message;
            lastError = new Error(maskedMessage);
            console.error("[preview-jobs] GitHub auth attempt threw error", {
              previewRunId,
              attempt,
              error: maskedMessage,
            });

            if (attempt < maxRetries) {
              const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }

        if (!authSucceeded) {
          console.error("[preview-jobs] GitHub authentication failed after all retries", {
            previewRunId,
            maxRetries,
            lastError: maskLogValue(lastError?.message),
          });
          const finalErrorMessage = maskLogValue(lastError?.message) || "Unknown error";
          throw new Error(
            `GitHub authentication failed after ${maxRetries} attempts: ${finalErrorMessage}`
          );
        }
      } else {
        console.warn("[preview-jobs] Failed to fetch installation token, falling back to public fetch", {
          previewRunId,
          installationId: run.repoInstallationId,
        });
      }
    } else {
      console.log("[preview-jobs] No installation ID, skipping GitHub authentication", {
        previewRunId,
      });
    }

    console.log("[preview-jobs] Starting git fetch from origin", {
      previewRunId,
      repoDir,
    });

    // Fetch the latest changes from origin (fetch all refs)
    const fetchResponse = await execInstanceInstanceIdExecPost({
      client: morphClient,
      path: { instance_id: instance.id },
      body: {
        command: ["git", "-C", repoDir, "fetch", "origin"],
      },
    });

    if (fetchResponse.error || fetchResponse.data?.exit_code !== 0) {
      console.error("[preview-jobs] Fetch failed", {
        previewRunId,
        exitCode: fetchResponse.data?.exit_code,
        stdout: fetchResponse.data?.stdout,
        stderr: fetchResponse.data?.stderr,
      });
      throw new Error(
        `Failed to fetch from origin (exit ${fetchResponse.data?.exit_code}): ${fetchResponse.data?.stderr || fetchResponse.data?.stdout}`
      );
    }

    console.log("[preview-jobs] Fetched latest changes from origin", {
      previewRunId,
      headSha: run.headSha,
    });

    console.log("[preview-jobs] Starting git checkout", {
      previewRunId,
      headSha: run.headSha,
      repoDir,
    });

    // Step 3: Checkout the PR commit
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "running",
      stateReason: "Checking out PR commit",
    });

    const checkoutResponse = await execInstanceInstanceIdExecPost({
      client: morphClient,
      path: { instance_id: instance.id },
      body: {
        command: ["git", "-C", repoDir, "checkout", run.headSha],
      },
    });

    if (checkoutResponse.error) {
      throw new Error(
        `Failed to checkout PR branch ${run.headSha}: ${JSON.stringify(checkoutResponse.error)}`,
      );
    }

    const checkoutResult = checkoutResponse.data;
    if (!checkoutResult) {
      throw new Error("Checkout command returned no data");
    }

    if (checkoutResult.exit_code !== 0) {
      console.error("[preview-jobs] Checkout failed - full output", {
        previewRunId,
        headSha: run.headSha,
        exitCode: checkoutResult.exit_code,
        stdout: checkoutResult.stdout,
        stderr: checkoutResult.stderr,
      });
      throw new Error(
        `Failed to checkout PR branch ${run.headSha} (exit ${checkoutResult.exit_code}): stderr="${checkoutResult.stderr}" stdout="${checkoutResult.stdout}"`,
      );
    }

    console.log("[preview-jobs] Checked out PR branch", {
      previewRunId,
      headSha: run.headSha,
      stdout: checkoutResult.stdout?.slice(0, 200),
    });

    // Step 4: Trigger screenshot collection
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "running",
      stateReason: "Collecting screenshots",
    });

    console.log("[preview-jobs] Triggering screenshot collection", {
      previewRunId,
      workerUrl: workerService.url,
      screenshotLogUrl: `${workerService.url.replace(':39377', ':39376')}/file?path=/root/.cmux/screenshot-collector/screenshot-collector.log`,
    });

    await triggerWorkerScreenshotCollection(workerService.url);

    console.log("[preview-jobs] Screenshot collection triggered", {
      previewRunId,
    });

    // Step 5: Wait for screenshots to complete (give Claude time to collect)
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "running",
      stateReason: "Waiting for screenshots to complete",
    });

    console.log("[preview-jobs] Waiting for screenshots to complete...", {
      previewRunId,
      waitTimeSeconds: 120,
    });

    // Wait 2 minutes for Claude to collect screenshots
    await new Promise((resolve) => setTimeout(resolve, 120_000));

    // Step 6: Fetch screenshot file list
    const fileServiceUrl = workerService.url.replace(':39377', ':39376');
    const screenshotDirPath = "/root/.cmux/screenshot-collector/screenshots";

    console.log("[preview-jobs] Fetching screenshot list", {
      previewRunId,
      fileServiceUrl,
      screenshotDirPath,
    });

    // List files via Morph exec
    const listResponse = await execInstanceInstanceIdExecPost({
      client: morphClient,
      path: { instance_id: instance.id },
      body: {
        command: ["find", screenshotDirPath, "-type", "f", "-name", "*.png"],
      },
    });

    if (listResponse.error) {
      console.warn("[preview-jobs] Failed to list screenshots", {
        previewRunId,
        error: listResponse.error,
      });
    }

    const listResult = listResponse.data;
    const screenshotPaths = listResult?.stdout
      ? listResult.stdout.split('\n').map((p: string) => p.trim()).filter((p: string) => p.length > 0)
      : [];

    console.log("[preview-jobs] Found screenshots", {
      previewRunId,
      count: screenshotPaths.length,
      paths: screenshotPaths,
    });

    if (screenshotPaths.length === 0) {
      await ctx.runMutation(internal.previewRuns.updateStatus, {
        previewRunId,
        status: "completed",
        stateReason: "No screenshots generated",
      });
      return;
    }

    // Step 7: Download and upload screenshots
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "running",
      stateReason: "Uploading screenshots",
    });

    const uploadedImages: Array<{
      storageId: string;
      mimeType: string;
      fileName: string;
      commitSha: string;
    }> = [];

    for (const screenshotPath of screenshotPaths) {
      try {
        // Download screenshot from file service
        const fileUrl = `${fileServiceUrl}/file?path=${encodeURIComponent(screenshotPath)}`;
        const downloadResponse = await fetch(fileUrl, {
          signal: AbortSignal.timeout(30_000),
        });

        if (!downloadResponse.ok) {
          console.warn("[preview-jobs] Failed to download screenshot", {
            previewRunId,
            screenshotPath,
            status: downloadResponse.status,
          });
          continue;
        }

        const imageBytes = await downloadResponse.arrayBuffer();

        // Upload to Convex storage
        const uploadUrl = await ctx.storage.generateUploadUrl();
        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "image/png" },
          body: imageBytes,
        });

        const { storageId } = (await uploadResponse.json()) as { storageId: string };

        uploadedImages.push({
          storageId,
          mimeType: "image/png",
          fileName: screenshotPath.split('/').pop() ?? "screenshot.png",
          commitSha: run.headSha,
        });

        console.log("[preview-jobs] Uploaded screenshot", {
          previewRunId,
          screenshotPath,
          storageId,
        });
      } catch (error) {
        console.warn("[preview-jobs] Failed to process screenshot", {
          previewRunId,
          screenshotPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Step 8: Create screenshot set and trigger GitHub comment
    const screenshotSetId = await ctx.runMutation(
      internal.previewScreenshots.createScreenshotSet,
      {
        previewRunId,
        status: "completed",
        commitSha: run.headSha,
        images: uploadedImages.map(img => ({
          ...img,
          storageId: img.storageId as Id<"_storage">,
        })),
      },
    );

    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "completed",
      stateReason: "Screenshots uploaded",
      screenshotSetId,
    });

    // Trigger GitHub comment
    await ctx.scheduler.runAfter(
      0,
      internal.previewScreenshots.triggerGithubComment,
      { previewRunId },
    );

    console.log("[preview-jobs] Preview job completed", { previewRunId });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    console.error("[preview-jobs] Preview job failed", {
      previewRunId,
      error: message,
    });

    let screenshotSetId: Id<"previewScreenshotSets"> | undefined;
    try {
      screenshotSetId = await ctx.runMutation(
        internal.previewScreenshots.createScreenshotSet,
        {
          previewRunId,
          status: "failed",
          commitSha: run.headSha ?? "unknown",
          error: message,
          images: [],
        },
      );
    } catch (screenshotError) {
      console.error("[preview-jobs] Failed to record failure screenshot set", {
        previewRunId,
        error: screenshotError,
      });
    }

    try {
      await ctx.runMutation(internal.previewRuns.updateStatus, {
        previewRunId,
        status: "failed",
        stateReason: message,
        screenshotSetId,
      });
    } catch (statusError) {
      console.error("[preview-jobs] Failed to update preview status", {
        previewRunId,
        error: statusError,
      });
    }

    throw error;
  } finally {
    if (instance) {
      try {
        await stopMorphInstance(morphClient, instance.id);
      } catch (stopError) {
        console.warn("[preview-jobs] Failed to stop Morph instance", {
          previewRunId,
          instanceId: instance.id,
          error: stopError,
        });
      }
    }
  }
}
