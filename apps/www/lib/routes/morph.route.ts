import {
  DEFAULT_MORPH_SNAPSHOT_ID,
  MORPH_SNAPSHOT_PRESETS,
  type MorphSnapshotId,
} from "@/lib/utils/morph-defaults";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { env } from "@/lib/utils/www-env";
import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";
import {
  extractMorphInstanceInfo,
  type MorphInstanceInfo,
} from "@cmux/shared";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { MorphCloudClient } from "morphcloud";
import { getConvex } from "../utils/get-convex";
import { selectGitIdentity } from "../utils/gitIdentity";
import { stackServerAppJs } from "../utils/stack";
import {
  configureGithubAccess,
  configureGitIdentity,
  fetchGitIdentityInputs,
} from "./sandboxes/git";

export const morphRouter = new OpenAPIHono();

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

type TaskRunDoc = Doc<"taskRuns">;
type MorphInstance = Awaited<
  ReturnType<MorphCloudClient["instances"]["get"]>
>;

const FORCE_WAKE_MAX_RESUME_ATTEMPTS = 3;
const FORCE_WAKE_RESUME_BACKOFF_MS = 1_000;
const FORCE_WAKE_READY_POLL_ATTEMPTS = 15;
const FORCE_WAKE_READY_POLL_INTERVAL_MS = 2_000;

const ForceWakeParamsSchema = z.object({
  taskRunId: z
    .string()
    .openapi({
      example: "taskRun_j6dta8a9k2h7b5p",
      description: "Convex task run identifier",
    }),
});

const ForceWakeBodySchema = z
  .object({
    teamSlugOrId: z
      .string()
      .openapi({ example: "my-team", description: "Team slug or UUID" }),
  })
  .openapi("MorphForceWakeBody");

const ForceWakeResponseSchema = z
  .object({
    action: z.enum(["already_ready", "resumed"]),
    instanceId: z.string(),
    morphId: z.string(),
    vmStatus: z.string(),
    resumeAttempts: z.number(),
    readyChecks: z.number(),
    previousStatus: z.string().optional(),
  })
  .openapi("MorphForceWakeResponse");

const ForceWakeErrorSchema = z
  .object({
    error: z.string(),
  })
  .openapi("MorphForceWakeError");

type ForceWakeResponse = z.infer<typeof ForceWakeResponseSchema>;
type ForceWakeError = z.infer<typeof ForceWakeErrorSchema>;

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
    method: "post",
    path: "/morph/task-runs/{taskRunId}/force-wake",
    tags: ["Morph"],
    summary: "Force-resume the Morph VM associated with a task run",
    request: {
      params: ForceWakeParamsSchema,
      body: {
        content: {
          "application/json": {
            schema: ForceWakeBodySchema,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "The Morph VM is running",
        content: {
          "application/json": {
            schema: ForceWakeResponseSchema,
          },
        },
      },
      400: {
        description: "The task run is not backed by Morph",
        content: {
          "application/json": {
            schema: ForceWakeErrorSchema,
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: ForceWakeErrorSchema,
          },
        },
      },
      403: {
        description: "The Morph VM belongs to another team",
        content: {
          "application/json": {
            schema: ForceWakeErrorSchema,
          },
        },
      },
      404: {
        description: "Task run or Morph VM not found",
        content: {
          "application/json": {
            schema: ForceWakeErrorSchema,
          },
        },
      },
      500: {
        description: "Failed to resume the Morph VM",
        content: {
          "application/json": {
            schema: ForceWakeErrorSchema,
          },
        },
      },
    },
  }),
  async (c) => {
    const user = await stackServerAppJs.getUser({ tokenStore: c.req.raw });
    if (!user) {
      return c.json<ForceWakeError, 401>({ error: "Unauthorized" }, 401);
    }

    const { accessToken } = await user.getAuthJson();
    if (!accessToken) {
      return c.json<ForceWakeError, 401>({ error: "Unauthorized" }, 401);
    }

    const { teamSlugOrId } = c.req.valid("json");
    const { taskRunId: rawTaskRunId } = c.req.valid("param");
    const taskRunId = typedZid("taskRuns").parse(rawTaskRunId);

    const team = await verifyTeamAccess({
      req: c.req.raw,
      accessToken,
      teamSlugOrId,
    });

    const convex = getConvex({ accessToken });

    try {
      const run = (await convex.query(api.taskRuns.get, {
        teamSlugOrId,
        id: taskRunId,
      })) as TaskRunDoc | null;

      if (!run) {
        return c.json<ForceWakeError, 404>(
          { error: "Task run not found" },
          404
        );
      }

      if (run.vscode?.provider !== "morph") {
        return c.json<ForceWakeError, 400>(
          { error: "Task run is not backed by a Morph VM" },
          400
        );
      }

      const morphInfo = resolveMorphInstanceInfoFromRun(run);
      if (!morphInfo) {
        return c.json<ForceWakeError, 400>(
          {
            error:
              "Unable to determine Morph VM ID for this run. Please restart the run.",
          },
          400
        );
      }

      const client = new MorphCloudClient({ apiKey: env.MORPH_API_KEY });

      let instance: MorphInstance;
      try {
        instance = await client.instances.get({
          instanceId: morphInfo.instanceId,
        });
      } catch (error) {
        console.error(
          `[force-wake] Unable to load Morph instance ${morphInfo.instanceId}`,
          error
        );
        return c.json<ForceWakeError, 404>(
          { error: "Morph instance not found" },
          404
        );
      }

      const instanceTeamId =
        typeof instance.metadata?.teamId === "string"
          ? instance.metadata.teamId
          : null;
      if (instanceTeamId && instanceTeamId !== team.uuid) {
        return c.json<ForceWakeError, 403>(
          { error: "Forbidden: Morph instance belongs to another team" },
          403
        );
      }

      const previousStatus =
        typeof instance.status === "string" ? instance.status : undefined;

      if (instance.status === "ready") {
        return c.json<ForceWakeResponse, 200>({
          action: "already_ready" as const,
          instanceId: instance.id,
          morphId: morphInfo.morphId,
          vmStatus: instance.status ?? "ready",
          resumeAttempts: 0,
          readyChecks: 0,
          previousStatus,
        });
      }

      let resumeAttempts = 0;
      for (
        let attempt = 1;
        attempt <= FORCE_WAKE_MAX_RESUME_ATTEMPTS;
        attempt += 1
      ) {
        try {
          resumeAttempts = attempt;
          await instance.resume();
          break;
        } catch (error) {
          console.error(
            `[force-wake] Resume attempt ${attempt} failed for ${morphInfo.instanceId}`,
            error
          );
          if (attempt >= FORCE_WAKE_MAX_RESUME_ATTEMPTS) {
            return c.json<ForceWakeError, 500>(
              { error: "Unable to resume Morph VM. Please try again later." },
              500
            );
          }
          await wait(FORCE_WAKE_RESUME_BACKOFF_MS * attempt);
        }
      }

      const readyResult = await waitForInstanceReady(
        client,
        morphInfo.instanceId
      );
      if (!readyResult) {
        return c.json<ForceWakeError, 500>(
          { error: "Timed out waiting for Morph VM to become ready" },
          500
        );
      }

      instance = readyResult.instance;

      return c.json<ForceWakeResponse, 200>({
        action: "resumed" as const,
        instanceId: instance.id,
        morphId: morphInfo.morphId,
        vmStatus: instance.status ?? "ready",
        resumeAttempts,
        readyChecks: readyResult.attempts,
        previousStatus,
      });
    } catch (error) {
      console.error("[force-wake] Unexpected Morph resume error", error);
      return c.json<ForceWakeError, 500>(
        { error: "Failed to wake Morph VM. Please try again." },
        500
      );
    }
  }
);

function gatherMorphCandidateUrls(run: TaskRunDoc): string[] {
  const urls = new Set<string>();
  const add = (value?: string | null) => {
    if (typeof value === "string" && value.trim().length > 0) {
      urls.add(value);
    }
  };

  if (run.vscode) {
    add(run.vscode.url);
    add(run.vscode.workspaceUrl);
    const ports = run.vscode.ports;
    if (ports) {
      add(ports.vscode);
      add(ports.worker);
      add(ports.extension);
      add(ports.proxy);
      add(ports.vnc);
    }
  }

  if (run.networking) {
    for (const service of run.networking) {
      add(service.url);
    }
  }

  return Array.from(urls);
}

function resolveMorphInstanceInfoFromRun(
  run: TaskRunDoc
): MorphInstanceInfo | null {
  const candidates = gatherMorphCandidateUrls(run);
  for (const candidate of candidates) {
    const info = extractMorphInstanceInfo(candidate);
    if (info) {
      return info;
    }
  }
  return null;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function waitForInstanceReady(
  client: MorphCloudClient,
  instanceId: string
): Promise<{ instance: MorphInstance; attempts: number } | null> {
  for (
    let attempt = 1;
    attempt <= FORCE_WAKE_READY_POLL_ATTEMPTS;
    attempt += 1
  ) {
    const candidate = await client.instances.get({ instanceId });
    if (candidate.status === "ready") {
      return { instance: candidate, attempts: attempt };
    }
    await wait(FORCE_WAKE_READY_POLL_INTERVAL_MS);
  }
  return null;
}
