import {
  DEFAULT_MORPH_SNAPSHOT_ID,
  MORPH_SNAPSHOT_PRESETS,
  type MorphSnapshotId,
} from "@/lib/utils/morph-defaults";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { env } from "@/lib/utils/www-env";
import { api } from "@cmux/convex/api";
import { type Doc } from "@cmux/convex/dataModel";
import {
  extractMorphInstanceInfo,
  type MorphInstanceInfo,
} from "@cmux/shared";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { InstanceStatus, MorphCloudClient } from "morphcloud";
import { getConvex } from "../utils/get-convex";
import { selectGitIdentity } from "../utils/gitIdentity";
import { stackServerAppJs } from "../utils/stack";
import {
  configureGithubAccess,
  configureGitIdentity,
  fetchGitIdentityInputs,
} from "./sandboxes/git";

export const morphRouter = new OpenAPIHono();
type TaskRunDoc = Doc<"taskRuns">;

const WAIT_FOR_READY_TIMEOUT_MS = 120_000;
const WAIT_FOR_READY_INTERVAL_MS = 2_000;

const ForceWakeStateSchema = z
  .enum(["already_ready", "resumed"])
  .openapi("MorphForceWakeState");

const ForceWakeVmBody = z
  .object({
    teamSlugOrId: z.string(),
    taskRunId: typedZid("taskRuns"),
  })
  .openapi("MorphForceWakeBody");

const ForceWakeVmResponse = z
  .object({
    taskRunId: typedZid("taskRuns"),
    instanceId: z.string(),
    state: ForceWakeStateSchema,
    readyAt: z.number(),
    status: z.string(),
    message: z.string(),
  })
  .openapi("MorphForceWakeResponse");

const ForceWakeErrorResponse = z
  .object({
    error: z.string(),
  })
  .openapi("MorphForceWakeError");

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const normalizeMorphStatus = (
  status: InstanceStatus | string | null | undefined
): string => {
  if (!status) {
    return "unknown";
  }
  return status.toString().toLowerCase();
};

const isReadyStatus = (status: string) =>
  status === normalizeMorphStatus(InstanceStatus.READY) || status === "ready";

const isErrorStatus = (status: string) =>
  status === normalizeMorphStatus(InstanceStatus.ERROR) || status === "error";

const isNotFoundError = (error: unknown) =>
  error instanceof Error && error.message.includes("HTTP 404");

const resolveMorphInstanceFromRun = (
  run: TaskRunDoc
): { info: MorphInstanceInfo; url: string } | null => {
  const candidateUrls: string[] = [];
  if (run.vscode?.workspaceUrl) {
    candidateUrls.push(run.vscode.workspaceUrl);
  }
  if (run.vscode?.url) {
    candidateUrls.push(run.vscode.url);
  }
  if (run.networking) {
    for (const service of run.networking) {
      if (service?.url) {
        candidateUrls.push(service.url);
      }
    }
  }

  for (const candidate of candidateUrls) {
    try {
      const info = extractMorphInstanceInfo(candidate);
      if (info) {
        return { info, url: candidate };
      }
    } catch {
      // Ignore parse errors and continue
    }
  }

  return null;
};

type WaitForReadyResult =
  | { state: "ready"; instance: Awaited<ReturnType<MorphCloudClient["instances"]["get"]>> }
  | { state: "timeout" }
  | { state: "failed"; reason: string }
  | { state: "not_found" };

async function waitForInstanceReady(
  client: MorphCloudClient,
  instanceId: string
): Promise<WaitForReadyResult> {
  const deadline = Date.now() + WAIT_FOR_READY_TIMEOUT_MS;
  let lastStatus: string | null = null;

  while (Date.now() < deadline) {
    let snapshot;
    try {
      snapshot = await client.instances.get({ instanceId });
    } catch (error) {
      if (isNotFoundError(error)) {
        return { state: "not_found" };
      }
      const message =
        error instanceof Error ? error.message : "Failed to inspect instance status.";
      return { state: "failed", reason: message };
    }

    const status = normalizeMorphStatus(snapshot.status);
    if (isReadyStatus(status)) {
      return { state: "ready", instance: snapshot };
    }
    if (isErrorStatus(status)) {
      const reason =
        (typeof (snapshot as { statusReason?: string }).statusReason === "string" &&
          (snapshot as { statusReason?: string }).statusReason) ||
        "Morph instance reported an error state while resuming.";
      return { state: "failed", reason };
    }

    if (lastStatus !== status) {
      lastStatus = status;
      console.log(
        `[morph.forceWake] Waiting for instance ${instanceId} to become ready (status=${status})`
      );
    }

    await sleep(WAIT_FOR_READY_INTERVAL_MS);
  }

  return { state: "timeout" };
}

const morphSnapshotIds = MORPH_SNAPSHOT_PRESETS.map(
  (preset) => preset.id
) as MorphSnapshotId[];

const SnapshotIdSchema = z.enum(
  morphSnapshotIds as [MorphSnapshotId, ...MorphSnapshotId[]]
);

const SetupInstanceBody = z
  .object({
    teamSlugOrId: z.string(),
    instanceId: z.string().optional(), // Existing instance ID to reuse
    selectedRepos: z.array(z.string()).optional(), // Repositories to clone
    ttlSeconds: z.number().default(60 * 30), // 30 minutes default
    // TODO: This is a temporary solution to allow both string and enum values since client values are diff from backend values
    snapshotId: z.union([z.string(), SnapshotIdSchema]).optional(),
  })
  .openapi("SetupInstanceBody");

const SetupInstanceResponse = z
  .object({
    instanceId: z.string(),
    vscodeUrl: z.string(),
    clonedRepos: z.array(z.string()),
    removedRepos: z.array(z.string()),
  })
  .openapi("SetupInstanceResponse");

morphRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/morph/setup-instance",
    tags: ["Morph"],
    summary: "Setup a Morph instance with optional repository cloning",
    request: {
      body: {
        content: {
          "application/json": {
            schema: SetupInstanceBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: SetupInstanceResponse,
          },
        },
        description: "Instance setup successfully",
      },
      401: { description: "Unauthorized" },
      500: { description: "Failed to setup instance" },
    },
  }),
  async (c) => {
    const user = await stackServerAppJs.getUser({ tokenStore: c.req.raw });
    if (!user) {
      return c.text("Unauthorized", 401);
    }
    const { accessToken } = await user.getAuthJson();
    if (!accessToken) return c.text("Unauthorized", 401);
    const {
      teamSlugOrId,
      instanceId: existingInstanceId,
      selectedRepos,
      ttlSeconds,
      snapshotId,
    } = c.req.valid("json");

    const convex = getConvex({ accessToken });

    // Verify team access and get the team
    const team = await verifyTeamAccess({ req: c.req.raw, teamSlugOrId });
    const githubAccessTokenPromise = (async () => {
      const githubAccount = await user.getConnectedAccount("github");
      if (!githubAccount) {
        return {
          githubAccessTokenError: "GitHub account not found",
          githubAccessToken: null,
        } as const;
      }
      const { accessToken: githubAccessToken } =
        await githubAccount.getAccessToken();
      if (!githubAccessToken) {
        return {
          githubAccessTokenError: "GitHub access token not found",
          githubAccessToken: null,
        } as const;
      }

      return { githubAccessTokenError: null, githubAccessToken } as const;
    })();
    const gitIdentityPromise = githubAccessTokenPromise.then(
      ({ githubAccessToken }) => {
        if (!githubAccessToken) {
          throw new Error("GitHub access token not found");
        }
        return fetchGitIdentityInputs(convex, githubAccessToken);
      }
    );

    try {
      const client = new MorphCloudClient({
        apiKey: env.MORPH_API_KEY,
      });

      let instance;
      let instanceId = existingInstanceId;
      const selectedSnapshotId = snapshotId ?? DEFAULT_MORPH_SNAPSHOT_ID;

      // If no instanceId provided, create a new instance
      if (!instanceId) {
        console.log(
          `Creating new Morph instance (snapshot: ${selectedSnapshotId})`
        );
        instance = await client.instances.start({
          snapshotId: selectedSnapshotId,
          ttlSeconds,
          ttlAction: "pause",
          metadata: {
            app: "cmux-dev",
            userId: user.id,
            teamId: team.uuid,
          },
        });
        instanceId = instance.id;
        await instance.setWakeOn(true, true);
      } else {
        // Get existing instance
        console.log(`Using existing Morph instance: ${instanceId}`);
        instance = await client.instances.get({ instanceId });

        // Security: ensure the instance belongs to the requested team
        const meta = instance.metadata;
        const instanceTeamId = meta?.teamId;
        if (!instanceTeamId || instanceTeamId !== team.uuid) {
          return c.text(
            "Forbidden: Instance does not belong to this team",
            403
          );
        }
      }

      void gitIdentityPromise
        .then(([who, gh]) => {
          const { name, email } = selectGitIdentity(who, gh);
          return configureGitIdentity(instance, { name, email });
        })
        .catch((error) => {
          console.log(
            `[sandboxes.start] Failed to configure git identity; continuing...`,
            error
          );
        });

      // Get VSCode URL
      const vscodeUrl = instance.networking.httpServices.find(
        (service) => service.port === 39378
      )?.url;

      if (!vscodeUrl) {
        throw new Error("VSCode URL not found");
      }

      const { githubAccessToken, githubAccessTokenError } =
        await githubAccessTokenPromise;
      if (githubAccessTokenError) {
        console.error(
          `[sandboxes.start] GitHub access token error: ${githubAccessTokenError}`
        );
        return c.text("Failed to resolve GitHub credentials", 401);
      }
      await configureGithubAccess(instance, githubAccessToken);

      const url = `${vscodeUrl}/?folder=/root/workspace`;

      // Handle repository management if repos are specified
      const removedRepos: string[] = [];
      const clonedRepos: string[] = [];
      const failedClones: { repo: string; error: string; isAuth: boolean }[] =
        [];

      if (selectedRepos && selectedRepos.length > 0) {
        // Validate repo format and check for duplicates
        const repoNames = new Map<string, string>(); // Map of repo name to full path
        const reposByOwner = new Map<string, string[]>(); // Map of owner -> list of full repo names
        for (const repo of selectedRepos) {
          // Validate format: should be owner/repo
          if (!repo.includes("/") || repo.split("/").length !== 2) {
            return c.text(
              `Invalid repository format: ${repo}. Expected format: owner/repo`,
              400
            );
          }

          const [owner, repoName] = repo.split("/");
          if (!repoName) {
            return c.text(`Invalid repository: ${repo}`, 400);
          }

          // Check for duplicate repo names
          if (repoNames.has(repoName)) {
            return c.text(
              `Duplicate repository name detected: '${repoName}' from both '${repoNames.get(repoName)}' and '${repo}'. ` +
                `Repositories with the same name cannot be cloned to the same workspace.`,
              400
            );
          }
          repoNames.set(repoName, repo);

          // Group by owner for GitHub App installations
          if (!reposByOwner.has(owner)) {
            reposByOwner.set(owner, []);
          }
          reposByOwner.get(owner)!.push(repo);
        }

        // First, get list of existing repos with their remote URLs
        const listReposCmd = await instance.exec(
          "for dir in /root/workspace/*/; do " +
            'if [ -d "$dir/.git" ]; then ' +
            'basename "$dir"; ' +
            "cd \"$dir\" && git remote get-url origin 2>/dev/null || echo 'no-remote'; " +
            "fi; done"
        );

        const lines = listReposCmd.stdout.split("\n").filter(Boolean);
        const existingRepos = new Map<string, string>(); // Map of repo name to remote URL

        for (let i = 0; i < lines.length; i += 2) {
          const repoName = lines[i]?.trim();
          const remoteUrl = lines[i + 1]?.trim();
          if (repoName && remoteUrl && remoteUrl !== "no-remote") {
            existingRepos.set(repoName, remoteUrl);
          } else if (repoName) {
            existingRepos.set(repoName, "");
          }
        }

        // Determine which repos to remove
        for (const [existingName, existingUrl] of existingRepos) {
          const selectedRepo = repoNames.get(existingName);

          if (!selectedRepo) {
            // Repo not in selected list, remove it
            console.log(`Removing repository: ${existingName}`);
            await instance.exec(`rm -rf /root/workspace/${existingName}`);
            removedRepos.push(existingName);
          } else if (existingUrl && !existingUrl.includes(selectedRepo)) {
            // Repo exists but points to different remote, remove and re-clone
            console.log(
              `Repository ${existingName} points to different remote, removing for re-clone`
            );
            await instance.exec(`rm -rf /root/workspace/${existingName}`);
            removedRepos.push(existingName);
            existingRepos.delete(existingName); // Mark for re-cloning
          }
        }

        // For each owner group, mint a token and clone that owner's repos
        for (const [, repos] of reposByOwner) {
          // Clone new repos for this owner in parallel with retries
          const clonePromises = repos.map(async (repo) => {
            const repoName = repo.split("/").pop()!;
            if (!existingRepos.has(repoName)) {
              console.log(`Cloning repository: ${repo}`);

              const maxRetries = 3;
              let lastError: string | undefined;
              let isAuthError = false;

              for (let attempt = 1; attempt <= maxRetries; attempt++) {
                const cloneCmd = await instance.exec(
                  `mkdir -p /root/workspace && cd /root/workspace && git clone https://github.com/${repo}.git ${repoName} 2>&1`
                );

                if (cloneCmd.exit_code === 0) {
                  return { success: true as const, repo };
                } else {
                  lastError = cloneCmd.stderr || cloneCmd.stdout;

                  // Check for authentication errors
                  isAuthError =
                    lastError.includes("Authentication failed") ||
                    lastError.includes("could not read Username") ||
                    lastError.includes("could not read Password") ||
                    lastError.includes("Invalid username or password") ||
                    lastError.includes("Permission denied") ||
                    lastError.includes("Repository not found") ||
                    lastError.includes("403");

                  // Don't retry authentication errors
                  if (isAuthError) {
                    console.error(
                      `Authentication failed for ${repo}: ${lastError}`
                    );
                    break;
                  }

                  if (attempt < maxRetries) {
                    console.log(
                      `Clone attempt ${attempt} failed for ${repo}, retrying...`
                    );
                    // Clean up partial clone if it exists
                    await instance.exec(`rm -rf /root/workspace/${repoName}`);
                    // Wait before retry with exponential backoff
                    await new Promise((resolve) =>
                      setTimeout(resolve, attempt * 1000)
                    );
                  }
                }
              }

              const errorMsg = isAuthError
                ? `Authentication failed - check repository access permissions`
                : `Failed after ${maxRetries} attempts`;

              console.error(
                `Failed to clone ${repo}: ${errorMsg}\nDetails: ${lastError}`
              );
              return {
                success: false as const,
                repo,
                error: lastError || "Unknown error",
                isAuth: isAuthError,
              };
            } else {
              console.log(
                `Repository ${repo} already exists with correct remote, skipping clone`
              );
              return null;
            }
          });

          const results = await Promise.all(clonePromises);

          for (const result of results) {
            if (result && "success" in result) {
              if (result.success) {
                clonedRepos.push(result.repo);
              } else {
                failedClones.push({
                  repo: result.repo,
                  error: result.error,
                  isAuth: result.isAuth,
                });
              }
            }
          }
        }
      }

      console.log(`VSCode Workspace URL: ${url}`);

      return c.json({
        instanceId,
        vscodeUrl: url,
        clonedRepos,
        removedRepos,
        failedClones,
      });
    } catch (error) {
      console.error("Failed to setup Morph instance:", error);
      return c.text("Failed to setup instance", 500);
    }
  }
);

morphRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/morph/task-runs/force-wake",
    tags: ["Morph"],
    summary:
      "Force resume a Morph VM backing a VSCode workspace for a specific task run",
    request: {
      body: {
        content: {
          "application/json": {
            schema: ForceWakeVmBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Workspace is ready for use",
        content: {
          "application/json": {
            schema: ForceWakeVmResponse,
          },
        },
      },
      400: {
        description: "Task run is invalid or not backed by Morph",
        content: {
          "application/json": {
            schema: ForceWakeErrorResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
      403: {
        description: "User does not own this Morph instance",
        content: {
          "application/json": {
            schema: ForceWakeErrorResponse,
          },
        },
      },
      404: {
        description: "Task run or Morph instance not found",
        content: {
          "application/json": {
            schema: ForceWakeErrorResponse,
          },
        },
      },
      502: {
        description: "Morph API failed to resume the instance",
        content: {
          "application/json": {
            schema: ForceWakeErrorResponse,
          },
        },
      },
      504: {
        description: "Instance is still waking after the timeout window",
        content: {
          "application/json": {
            schema: ForceWakeErrorResponse,
          },
        },
      },
    },
  }),
  async (c) => {
    const user = await stackServerAppJs.getUser({ tokenStore: c.req.raw });
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const { accessToken } = await user.getAuthJson();
    if (!accessToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { teamSlugOrId, taskRunId } = c.req.valid("json");

    const team = await verifyTeamAccess({
      req: c.req.raw,
      accessToken,
      teamSlugOrId,
    });

    const convex = getConvex({ accessToken });
    let run: TaskRunDoc | null = null;
    try {
      run = await convex.query(api.taskRuns.get, {
        teamSlugOrId,
        id: taskRunId,
      });
    } catch (error) {
      console.error("[morph.forceWake] Failed to load task run", error);
      return c.json({ error: "Failed to load task run details." }, 500);
    }

    if (!run) {
      return c.json({ error: "Task run not found." }, 404);
    }

    if (!run.vscode || run.vscode.provider !== "morph") {
      return c.json(
        { error: "This task run is not running on a Morph VM." },
        400
      );
    }

    const morphResolution = resolveMorphInstanceFromRun(run);
    if (!morphResolution) {
      return c.json(
        { error: "Unable to determine the Morph VM for this run." },
        400
      );
    }

    const client = new MorphCloudClient({
      apiKey: env.MORPH_API_KEY,
    });

    let instance;
    try {
      instance = await client.instances.get({
        instanceId: morphResolution.info.instanceId,
      });
    } catch (error) {
      if (isNotFoundError(error)) {
        return c.json(
          {
            error: `Morph instance ${morphResolution.info.instanceId} was not found.`,
          },
          404
        );
      }
      console.error("[morph.forceWake] Failed to fetch Morph instance", error);
      return c.json(
        { error: "Failed to fetch Morph instance metadata." },
        502
      );
    }

    const metadata = instance.metadata;
    const metadataUserId =
      typeof metadata?.userId === "string" ? metadata.userId : null;
    const metadataTeamId =
      typeof metadata?.teamId === "string" ? metadata.teamId : null;
    const ownsInstance =
      (metadataUserId && metadataUserId === user.id) ||
      (metadataTeamId && metadataTeamId === team.uuid);

    if (!ownsInstance) {
      return c.json(
        {
          error: "You do not have permission to resume this workspace.",
        },
        403
      );
    }

    const currentStatus = normalizeMorphStatus(instance.status);
    if (isReadyStatus(currentStatus)) {
      return c.json({
        taskRunId,
        instanceId: morphResolution.info.instanceId,
        state: "already_ready",
        readyAt: Date.now(),
        status: currentStatus,
        message: "Workspace is already running.",
      });
    }

    try {
      await instance.resume();
    } catch (error) {
      console.error("[morph.forceWake] Failed to resume Morph instance", error);
      const description =
        error instanceof Error
          ? error.message
          : "Failed to resume Morph instance.";
      return c.json({ error: description }, 502);
    }

    const readyResult = await waitForInstanceReady(
      client,
      morphResolution.info.instanceId
    );

    if (readyResult.state === "not_found") {
      return c.json(
        {
          error: `Morph instance ${morphResolution.info.instanceId} disappeared while resuming.`,
        },
        404
      );
    }

    if (readyResult.state === "timeout") {
      return c.json(
        {
          error:
            "Morph is still waking up after two minutes. Please try again shortly.",
        },
        504
      );
    }

    if (readyResult.state === "failed") {
      return c.json({ error: readyResult.reason }, 502);
    }

    return c.json({
      taskRunId,
      instanceId: morphResolution.info.instanceId,
      state: "resumed",
      readyAt: Date.now(),
      status: normalizeMorphStatus(readyResult.instance.status),
      message: "Workspace resumed successfully.",
    });
  }
);
