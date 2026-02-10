import {
  DEFAULT_MORPH_SNAPSHOT_ID,
  MORPH_SNAPSHOT_PRESETS,
  type MorphSnapshotId,
} from "@/lib/utils/morph-defaults";
import { DEFAULT_PVE_LXC_SNAPSHOT_ID } from "@/lib/utils/pve-lxc-defaults";
import { getAccessTokenFromRequest, getUserFromRequest } from "@/lib/utils/auth";
import { getPveLxcClient } from "@/lib/utils/pve-lxc-client";
import { getActiveSandboxProvider } from "@/lib/utils/sandbox-provider";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { env } from "@/lib/utils/www-env";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { type Instance, MorphCloudClient } from "morphcloud";
import { getConvex } from "../utils/get-convex";
import { selectGitIdentity } from "../utils/gitIdentity";
import { stackServerAppJs } from "../utils/stack";
import { generateGitHubInstallationToken } from "@/lib/utils/github-app-token";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import {
  configureGithubAccess,
  configureGitIdentity,
  fetchGitIdentityInputs,
  getFreshGitHubToken,
} from "./sandboxes/git";
import { wrapMorphInstance, wrapPveLxcInstance, type SandboxInstance } from "@/lib/utils/sandbox-instance";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import * as Sentry from "@sentry/nextjs";

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

const ResumeTaskRunBody = z
  .object({
    teamSlugOrId: z.string(),
  })
  .openapi("ResumeTaskRunBody");

const CheckTaskRunPausedBody = z
  .object({
    teamSlugOrId: z.string(),
  })
  .openapi("CheckTaskRunPausedBody");

const ResumeTaskRunResponse = z
  .object({
    resumed: z.literal(true),
  })
  .openapi("ResumeTaskRunResponse");

const CheckTaskRunPausedResponse = z
  .object({
    paused: z.boolean(),
    stopped: z.boolean().optional(), // True if instance was permanently stopped by cleanup cron
    stoppedAt: z.number().optional(), // When the instance was stopped
  })
  .openapi("CheckTaskRunPausedResponse");

morphRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/morph/task-runs/{taskRunId}/resume",
    tags: ["Morph"],
    summary: "Resume the Morph instance backing a task run",
    request: {
      params: z.object({
        taskRunId: typedZid("taskRuns"),
      }),
      body: {
        content: {
          "application/json": {
            schema: ResumeTaskRunBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: ResumeTaskRunResponse,
          },
        },
        description: "Morph instance resumed",
      },
      400: { description: "Task run is not backed by a Morph instance" },
      401: { description: "Unauthorized" },
      403: { description: "Forbidden" },
      404: { description: "Task run or instance not found" },
      500: { description: "Failed to resume instance" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const { taskRunId } = c.req.valid("param");
    const { teamSlugOrId } = c.req.valid("json");

    const convex = getConvex({ accessToken });
    const team = await verifyTeamAccess({ req: c.req.raw, teamSlugOrId });

    const taskRun = await convex.query(api.taskRuns.get, {
      teamSlugOrId,
      id: taskRunId,
    });

    if (!taskRun) {
      return c.text("Task run not found", 404);
    }

    const instanceId = taskRun.vscode?.containerName;
    const isMorphProvider = taskRun.vscode?.provider === "morph";

    if (!isMorphProvider || !instanceId) {
      return c.text("Task run is not backed by a Morph instance", 400);
    }

    try {
      const client = new MorphCloudClient({ apiKey: env.MORPH_API_KEY });
      const instance = await client.instances.get({ instanceId });
      void (async () => {
        try {
          await instance.setWakeOn(true, true);
        } catch (error) {
          console.error("[morph.resume-task-run] Failed to set wake on", error);
        }
      })();

      const metadataTeamId = (
        instance as unknown as {
          metadata?: { teamId?: string };
        }
      ).metadata?.teamId;

      if (metadataTeamId && metadataTeamId !== team.uuid) {
        return c.text("Forbidden", 403);
      }

      await instance.resume();

      // Record the resume for activity tracking (used by cleanup cron)
      await convex.mutation(api.sandboxInstances.recordResume, {
        instanceId,
        teamSlugOrId,
      });

      await convex.mutation(api.taskRuns.updateVSCodeStatus, {
        teamSlugOrId,
        id: taskRunId as Id<"taskRuns">,
        status: "running",
      });

      return c.json({ resumed: true });
    } catch (error) {
      console.error("[morph.resume-task-run] Failed to resume instance", error);
      return c.text("Failed to resume instance", 500);
    }
  }
);

morphRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/morph/task-runs/{taskRunId}/is-paused",
    tags: ["Morph"],
    summary: "Check if the Morph instance backing a task run is paused",
    request: {
      params: z.object({
        taskRunId: typedZid("taskRuns"),
      }),
      body: {
        content: {
          "application/json": {
            schema: CheckTaskRunPausedBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: CheckTaskRunPausedResponse,
          },
        },
        description: "Morph instance status returned",
      },
      400: { description: "Task run is not backed by a Morph instance" },
      401: { description: "Unauthorized" },
      403: { description: "Forbidden" },
      404: { description: "Task run or instance not found" },
      500: { description: "Failed to check instance status" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const { taskRunId } = c.req.valid("param");
    const { teamSlugOrId } = c.req.valid("json");

    const convex = getConvex({ accessToken });
    const team = await verifyTeamAccess({ req: c.req.raw, teamSlugOrId });

    const taskRun = await convex.query(api.taskRuns.get, {
      teamSlugOrId,
      id: taskRunId,
    });

    if (!taskRun) {
      return c.text("Task run not found", 404);
    }

    const instanceId = taskRun.vscode?.containerName;
    const isMorphProvider = taskRun.vscode?.provider === "morph";

    if (!isMorphProvider || !instanceId) {
      return c.text("Task run is not backed by a Morph instance", 400);
    }

    try {
      const client = new MorphCloudClient({ apiKey: env.MORPH_API_KEY });

      let instance: Instance;
      try {
        instance = await client.instances.get({ instanceId });
      } catch (instanceError) {
        // If instance not found, it was likely stopped/deleted
        const errorMessage = instanceError instanceof Error ? instanceError.message : String(instanceError);
        if (errorMessage.includes("404") || errorMessage.includes("not found")) {
          return c.json({
            paused: true,
            stopped: true,
            stoppedAt: undefined, // We don't know exactly when it was stopped
          });
        }
        throw instanceError;
      }

      const metadataTeamId = (
        instance as unknown as {
          metadata?: { teamId?: string };
        }
      ).metadata?.teamId;

      if (metadataTeamId && metadataTeamId !== team.uuid) {
        return c.text("Forbidden", 403);
      }

      return c.json({ paused: instance.status === "paused", stopped: false });
    } catch (error) {
      console.error(
        "[morph.check-task-run-paused] Failed to check instance status",
        error
      );
      return c.text("Failed to check instance status", 500);
    }
  }
);

const RefreshGitHubAuthBody = z
  .object({
    teamSlugOrId: z.string(),
  })
  .openapi("RefreshGitHubAuthBody");

const RefreshGitHubAuthResponse = z
  .object({
    refreshed: z.literal(true),
  })
  .openapi("RefreshGitHubAuthResponse");

morphRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/morph/task-runs/{taskRunId}/refresh-github-auth",
    tags: ["Morph"],
    summary: "Refresh GitHub authentication on a Morph instance",
    description:
      "Re-authenticates the GitHub CLI inside a running Morph VM with a fresh token. " +
      "Useful when the token has expired or the user has re-connected their GitHub account.",
    request: {
      params: z.object({
        taskRunId: typedZid("taskRuns"),
      }),
      body: {
        content: {
          "application/json": {
            schema: RefreshGitHubAuthBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: RefreshGitHubAuthResponse,
          },
        },
        description: "GitHub authentication refreshed successfully",
      },
      400: { description: "Task run is not backed by a Morph instance" },
      401: { description: "Unauthorized or GitHub not connected" },
      403: { description: "Forbidden - instance does not belong to this team" },
      404: { description: "Task run not found" },
      409: { description: "Instance is paused - resume it first" },
      500: { description: "Failed to refresh GitHub authentication" },
    },
  }),
  async (c) => {
    // Authenticate user via Stack Auth (server-side token retrieval)
    const user = await stackServerAppJs.getUser({ tokenStore: c.req.raw });
    if (!user) {
      return c.text("Unauthorized", 401);
    }

    const { accessToken } = await user.getAuthJson();
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const { taskRunId } = c.req.valid("param");
    const { teamSlugOrId } = c.req.valid("json");

    // Verify team access
    const convex = getConvex({ accessToken });
    const team = await verifyTeamAccess({ req: c.req.raw, teamSlugOrId });

    // Get task run
    const taskRun = await convex.query(api.taskRuns.get, {
      teamSlugOrId,
      id: taskRunId,
    });

    if (!taskRun) {
      return c.text("Task run not found", 404);
    }

    const instanceId = taskRun.vscode?.containerName;
    const isMorphProvider = taskRun.vscode?.provider === "morph";

    if (!isMorphProvider || !instanceId) {
      return c.text("Task run is not backed by a Morph instance", 400);
    }

    try {
      const client = new MorphCloudClient({ apiKey: env.MORPH_API_KEY });
      const instance = await client.instances.get({ instanceId });

      // Security: ensure the instance belongs to the requested team
      const metadataTeamId = (
        instance as unknown as {
          metadata?: { teamId?: string };
        }
      ).metadata?.teamId;

      if (metadataTeamId && metadataTeamId !== team.uuid) {
        return c.text("Forbidden", 403);
      }

      // Check if instance is paused - auth refresh requires running instance
      if (instance.status === "paused") {
        return c.text("Instance is paused - resume it first", 409);
      }

      // Try to use GitHub App installation token (same logic as /sandboxes/start)
      // to maintain consistency with initial sandbox setup
      let gitAuthToken: string | undefined;

      // Get the task to find projectFullName for GitHub App token preference
      const task = await convex.query(api.tasks.getById, {
        teamSlugOrId,
        id: taskRun.taskId,
      });

      if (task?.projectFullName) {
        const [owner] = task.projectFullName.split("/");
        try {
          const connections = await convex.query(api.github.listProviderConnections, {
            teamSlugOrId,
          });
          const targetConnection = connections.find(
            (co) =>
              co.isActive && co.accountLogin?.toLowerCase() === owner.toLowerCase()
          );
          if (targetConnection) {
            console.log(
              `[morph.refresh-github-auth] Found GitHub App installation ${targetConnection.installationId} for ${owner}`
            );
            gitAuthToken = await generateGitHubInstallationToken({
              installationId: targetConnection.installationId,
              repositories: [task.projectFullName],
              permissions: {
                contents: "write",
                metadata: "read",
                workflows: "write",
              },
            });
            console.log(
              `[morph.refresh-github-auth] Using GitHub App token for git authentication`
            );
          }
        } catch (error) {
          console.error(
            `[morph.refresh-github-auth] Failed to get GitHub App token, falling back to user OAuth:`,
            error
          );
        }
      }

      // Fall back to personal OAuth token if no GitHub App token
      if (!gitAuthToken) {
        const tokenResult = await getFreshGitHubToken(user);
        if ("error" in tokenResult) {
          return c.text(tokenResult.error, tokenResult.status);
        }
        gitAuthToken = tokenResult.token;
        console.log(
          `[morph.refresh-github-auth] Using personal OAuth token for git authentication`
        );
      }

      // Use the existing configureGithubAccess function to refresh auth
      await configureGithubAccess(wrapMorphInstance(instance), gitAuthToken);

      console.log(
        `[morph.refresh-github-auth] Successfully refreshed GitHub auth for instance ${instanceId}`
      );

      return c.json({ refreshed: true });
    } catch (error) {
      console.error(
        "[morph.refresh-github-auth] Failed to refresh GitHub auth:",
        error
      );
      return c.text("Failed to refresh GitHub authentication", 500);
    }
  }
);

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
    // Use getUserFromRequest which supports both cookie-based (web) and Bearer token (CLI) auth
    const user = await Sentry.startSpan(
      { name: "getUserFromRequest", op: "auth" },
      () => getUserFromRequest(c.req.raw)
    );
    if (!user) {
      return c.text("Unauthorized", 401);
    }
    const { accessToken } = await Sentry.startSpan(
      { name: "user.getAuthJson", op: "auth" },
      () => user.getAuthJson()
    );
    if (!accessToken) return c.text("Unauthorized", 401);
    const {
      teamSlugOrId,
      instanceId: existingInstanceId,
      selectedRepos,
      ttlSeconds,
      snapshotId,
    } = c.req.valid("json");

    const convex = getConvex({ accessToken });

    const verifyTeamPromise = Sentry.startSpan(
      { name: "verifyTeamAccess", op: "auth" },
      () => verifyTeamAccess({ req: c.req.raw, teamSlugOrId })
    );

    const githubAccessTokenPromise = Sentry.startSpan(
      { name: "getGithubAccessToken", op: "auth" },
      async () => {
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
      }
    );

    const gitIdentityPromise = githubAccessTokenPromise.then(
      ({ githubAccessToken }) => {
        if (!githubAccessToken) {
          throw new Error("GitHub access token not found");
        }
        return Sentry.startSpan(
          { name: "fetchGitIdentityInputs", op: "db" },
          () => fetchGitIdentityInputs(convex, githubAccessToken)
        );
      }
    );

    try {
      const providerConfig = getActiveSandboxProvider();
      const provider = providerConfig.provider;
      const selectedSnapshotId =
        snapshotId ??
        (provider === "pve-lxc"
          ? DEFAULT_PVE_LXC_SNAPSHOT_ID
          : DEFAULT_MORPH_SNAPSHOT_ID);

      let sandboxInstance: SandboxInstance;
      let instanceId = existingInstanceId;
      let vscodeUrl: string | undefined;

      if (provider === "pve-lxc") {
        const team = await verifyTeamPromise;
        const pveClient = getPveLxcClient();

        if (!instanceId) {
          console.log(
            `[morph.setup-instance] Creating new PVE LXC instance (snapshot: ${selectedSnapshotId})`
          );
          const pveInstance = await pveClient.instances.start({
            snapshotId: selectedSnapshotId,
            ttlSeconds,
            metadata: {
              app: "cmux",
              userId: user.id,
              teamId: team.uuid,
            },
          });
          instanceId = pveInstance.id;
          sandboxInstance = wrapPveLxcInstance(pveInstance);

          void convex
            .mutation(api.sandboxInstances.recordCreate, {
              instanceId,
              provider: "pve-lxc",
              teamSlugOrId,
            })
            .catch((error) =>
              console.error(
                "[morph.setup-instance] Failed to record PVE instance creation (non-fatal):",
                error
              )
            );
        } else {
          console.log(
            `[morph.setup-instance] Using existing PVE LXC instance: ${instanceId}`
          );
          const pveInstance = await pveClient.instances.get({ instanceId });
          sandboxInstance = wrapPveLxcInstance(pveInstance);
        }

        vscodeUrl = sandboxInstance.networking.httpServices.find(
          (service) => service.port === 39378
        )?.url;
      } else {
        const client = new MorphCloudClient({
          apiKey: env.MORPH_API_KEY,
        });
        let instance: Instance | undefined;

        if (!instanceId) {
          const team = await verifyTeamPromise;

          console.log(
            `Creating new Morph instance (snapshot: ${selectedSnapshotId})`
          );

          // Retry logic for instance start to handle connection timeouts
          const maxRetries = 3;
          let lastError: Error | undefined;
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              instance = await Sentry.startSpan(
                { name: "client.instances.start", op: "morph", attributes: { attempt } },
                () =>
                  client.instances.start({
                    snapshotId: selectedSnapshotId,
                    ttlSeconds,
                    ttlAction: "pause",
                    metadata: {
                      app: "cmux-dev",
                      userId: user.id,
                      teamId: team.uuid,
                    },
                  })
              );
              break; // Success, exit retry loop
            } catch (error) {
              lastError = error instanceof Error ? error : new Error(String(error));
              const isConnectTimeout =
                lastError.message.includes("fetch failed") ||
                lastError.message.includes("ConnectTimeoutError") ||
                (lastError.cause instanceof Error &&
                  (lastError.cause.message.includes("Connect Timeout") ||
                    (lastError.cause as NodeJS.ErrnoException).code === "UND_ERR_CONNECT_TIMEOUT"));

              if (!isConnectTimeout || attempt === maxRetries) {
                throw lastError;
              }

              console.log(
                `[morph.setup-instance] Connection timeout on attempt ${attempt}/${maxRetries}, retrying in ${attempt * 2}s...`
              );
              await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
            }
          }
          instanceId = instance!.id;
          void Sentry.startSpan(
            { name: "instance.setWakeOn", op: "morph" },
            () => instance!.setWakeOn(true, true)
          );
        } else {
          console.log(`Using existing Morph instance: ${instanceId}`);

          const team = await verifyTeamPromise;

          // Retry logic for instance get to handle connection timeouts
          const maxRetries = 3;
          let lastError: Error | undefined;
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              instance = await Sentry.startSpan(
                { name: "client.instances.get", op: "morph", attributes: { attempt } },
                () => client.instances.get({ instanceId: instanceId! })
              );
              break; // Success, exit retry loop
            } catch (error) {
              lastError = error instanceof Error ? error : new Error(String(error));
              const isConnectTimeout =
                lastError.message.includes("fetch failed") ||
                lastError.message.includes("ConnectTimeoutError") ||
                (lastError.cause instanceof Error &&
                  (lastError.cause.message.includes("Connect Timeout") ||
                    (lastError.cause as NodeJS.ErrnoException).code === "UND_ERR_CONNECT_TIMEOUT"));

              if (!isConnectTimeout || attempt === maxRetries) {
                throw lastError;
              }

              console.log(
                `[morph.setup-instance] Connection timeout on get attempt ${attempt}/${maxRetries}, retrying in ${attempt * 2}s...`
              );
              await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
            }
          }

          const meta = instance!.metadata;
          const instanceTeamId = meta?.teamId;
          if (!instanceTeamId || instanceTeamId !== team.uuid) {
            return c.text(
              "Forbidden: Instance does not belong to this team",
              403
            );
          }
        }

        sandboxInstance = wrapMorphInstance(instance!);
        vscodeUrl = sandboxInstance.networking.httpServices.find(
          (service) => service.port === 39378
        )?.url;
      }

      if (!vscodeUrl || !instanceId) {
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

      const wrappedInstance = sandboxInstance;
      const configureGithubPromise = Sentry.startSpan(
        { name: "configureGithubAccess", op: "sandbox.exec" },
        () => configureGithubAccess(wrappedInstance, githubAccessToken)
      );

      void gitIdentityPromise
        .then(([who, gh]) => {
          const { name, email } = selectGitIdentity(who, gh);
          return Sentry.startSpan(
            { name: "configureGitIdentity", op: "sandbox.exec" },
            () => configureGitIdentity(wrappedInstance, { name, email })
          );
        })
        .catch((error) => {
          console.log(
            `[sandboxes.start] Failed to configure git identity; continuing...`,
            error
          );
        });

      await configureGithubPromise;

      const url = `${vscodeUrl}/?folder=/root/workspace`;

      const removedRepos: string[] = [];
      const clonedRepos: string[] = [];
      const failedClones: { repo: string; error: string; isAuth: boolean }[] =
        [];

      if (selectedRepos && selectedRepos.length > 0) {
        const isSingleRepo = selectedRepos.length === 1;
        const repoNames = new Map<string, string>();
        const reposByOwner = new Map<string, string[]>();
        for (const repo of selectedRepos) {
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

          if (repoNames.has(repoName)) {
            return c.text(
              `Duplicate repository name detected: '${repoName}' from both '${repoNames.get(repoName)}' and '${repo}'. ` +
                `Repositories with the same name cannot be cloned to the same workspace.`,
              400
            );
          }
          repoNames.set(repoName, repo);

          if (!reposByOwner.has(owner)) {
            reposByOwner.set(owner, []);
          }
          reposByOwner.get(owner)!.push(repo);
        }

        const rootRepoCheck = await Sentry.startSpan(
          { name: "instance.exec (check root repo)", op: "sandbox.exec" },
          () =>
            sandboxInstance.exec(
              'if [ -d "/root/workspace/.git" ]; then git -C /root/workspace remote get-url origin 2>/dev/null || echo "no-remote"; else echo "no-git"; fi'
            )
        );
        const rootRepoRemote = rootRepoCheck.stdout.trim();
        const hasRootRepo = rootRepoRemote !== "no-git";
        const clearWorkspaceCmd =
          "rm -rf /root/workspace/.git /root/workspace/* /root/workspace/.[!.]* 2>/dev/null || true";

        if (isSingleRepo) {
          const selectedRepo = selectedRepos[0]!;

          const listReposCmd = await Sentry.startSpan(
            { name: "instance.exec (list repos)", op: "sandbox.exec" },
            () =>
              sandboxInstance.exec(
                "for dir in /root/workspace/*/; do " +
                  'if [ -d "$dir/.git" ]; then ' +
                  'basename "$dir"; ' +
                  "cd \"$dir\" && git remote get-url origin 2>/dev/null || echo 'no-remote'; " +
                  "fi; done"
              )
          );

          const lines = listReposCmd.stdout.split("\n").filter(Boolean);
          const subdirectoryRepos = new Set<string>();
          for (let i = 0; i < lines.length; i += 2) {
            const repoName = lines[i]?.trim();
            if (repoName) {
              subdirectoryRepos.add(repoName);
            }
          }

          for (const existingName of subdirectoryRepos) {
            console.log(`Removing repository: ${existingName}`);
            await Sentry.startSpan(
              { name: `instance.exec (rm ${existingName})`, op: "sandbox.exec" },
              () => sandboxInstance.exec(`rm -rf /root/workspace/${existingName}`)
            );
            removedRepos.push(existingName);
          }

          const rootRepoMatchesSelected =
            hasRootRepo &&
            rootRepoRemote !== "no-remote" &&
            (rootRepoRemote.endsWith(`/${selectedRepo}.git`) ||
              rootRepoRemote.endsWith(`/${selectedRepo}`));

          if (hasRootRepo && !rootRepoMatchesSelected) {
            console.log(
              `Root workspace repository points to different remote, clearing workspace for re-clone`
            );
            await Sentry.startSpan(
              { name: "instance.exec (clear workspace)", op: "sandbox.exec" },
              () => sandboxInstance.exec(clearWorkspaceCmd)
            );
          }

          if (!rootRepoMatchesSelected) {
            console.log(`Cloning repository to workspace root: ${selectedRepo}`);

            const maxRetries = 3;
            let lastError: string | undefined;
            let isAuthError = false;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              const cloneCmd = await Sentry.startSpan(
                {
                  name: "instance.exec (clone root repo)",
                  op: "sandbox.exec",
                  attributes: { attempt },
                },
                () =>
                  sandboxInstance.exec(
                    `mkdir -p /root/workspace && cd /root/workspace && git clone https://github.com/${selectedRepo}.git . 2>&1`
                  )
              );

              if (cloneCmd.exit_code === 0) {
                clonedRepos.push(selectedRepo);
                lastError = undefined;
                break;
              }

              lastError = cloneCmd.stderr || cloneCmd.stdout;
              isAuthError =
                lastError.includes("Authentication failed") ||
                lastError.includes("could not read Username") ||
                lastError.includes("could not read Password") ||
                lastError.includes("Invalid username or password") ||
                lastError.includes("Permission denied") ||
                lastError.includes("Repository not found") ||
                lastError.includes("403");

              if (isAuthError) {
                console.error(
                  `Authentication failed for ${selectedRepo}: ${lastError}`
                );
                break;
              }

              if (attempt < maxRetries) {
                console.log(
                  `Clone attempt ${attempt} failed for ${selectedRepo}, retrying...`
                );
                await sandboxInstance.exec(clearWorkspaceCmd);
                await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
              }
            }

            if (lastError) {
              const errorMsg = isAuthError
                ? `Authentication failed - check repository access permissions`
                : `Failed after ${maxRetries} attempts`;

              console.error(
                `Failed to clone ${selectedRepo}: ${errorMsg}\nDetails: ${lastError}`
              );
              failedClones.push({
                repo: selectedRepo,
                error: lastError || "Unknown error",
                isAuth: isAuthError,
              });
            }
          } else {
            console.log(
              `Repository ${selectedRepo} already exists at workspace root with correct remote, skipping clone`
            );
          }
        } else {
          if (hasRootRepo) {
            console.log(
              `Root workspace has a single-repo layout, clearing workspace for multi-repo clone`
            );
            await Sentry.startSpan(
              { name: "instance.exec (clear workspace)", op: "sandbox.exec" },
              () => sandboxInstance.exec(clearWorkspaceCmd)
            );
          }

          const listReposCmd = await Sentry.startSpan(
            { name: "instance.exec (list repos)", op: "sandbox.exec" },
            () =>
              sandboxInstance.exec(
                "for dir in /root/workspace/*/; do " +
                  'if [ -d "$dir/.git" ]; then ' +
                  'basename "$dir"; ' +
                  "cd \"$dir\" && git remote get-url origin 2>/dev/null || echo 'no-remote'; " +
                  "fi; done"
              )
          );

          const lines = listReposCmd.stdout.split("\n").filter(Boolean);
          const existingRepos = new Map<string, string>();

          for (let i = 0; i < lines.length; i += 2) {
            const repoName = lines[i]?.trim();
            const remoteUrl = lines[i + 1]?.trim();
            if (repoName && remoteUrl && remoteUrl !== "no-remote") {
              existingRepos.set(repoName, remoteUrl);
            } else if (repoName) {
              existingRepos.set(repoName, "");
            }
          }

          for (const [existingName, existingUrl] of existingRepos) {
            const selectedRepo = repoNames.get(existingName);

            if (!selectedRepo) {
              console.log(`Removing repository: ${existingName}`);
              await Sentry.startSpan(
                { name: `instance.exec (rm ${existingName})`, op: "sandbox.exec" },
                () => sandboxInstance.exec(`rm -rf /root/workspace/${existingName}`)
              );
              removedRepos.push(existingName);
            } else if (
              existingUrl &&
              !(
                existingUrl.endsWith(`/${selectedRepo}.git`) ||
                existingUrl.endsWith(`/${selectedRepo}`)
              )
            ) {
              console.log(
                `Repository ${existingName} points to different remote, removing for re-clone`
              );
              await Sentry.startSpan(
                { name: `instance.exec (rm ${existingName})`, op: "sandbox.exec" },
                () => sandboxInstance.exec(`rm -rf /root/workspace/${existingName}`)
              );
              removedRepos.push(existingName);
              existingRepos.delete(existingName);
            }
          }

          for (const [, repos] of reposByOwner) {
            const clonePromises = repos.map(async (repo) => {
              const repoName = repo.split("/").pop()!;
              if (!existingRepos.has(repoName)) {
                console.log(`Cloning repository: ${repo}`);

                const maxRetries = 3;
                let lastError: string | undefined;
                let isAuthError = false;

                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                  const cloneCmd = await Sentry.startSpan(
                    {
                      name: `instance.exec (clone ${repoName})`,
                      op: "sandbox.exec",
                      attributes: { attempt },
                    },
                    () =>
                      sandboxInstance.exec(
                        `mkdir -p /root/workspace && cd /root/workspace && git clone https://github.com/${repo}.git ${repoName} 2>&1`
                      )
                  );

                  if (cloneCmd.exit_code === 0) {
                    return { success: true as const, repo };
                  } else {
                    lastError = cloneCmd.stderr || cloneCmd.stdout;

                    isAuthError =
                      lastError.includes("Authentication failed") ||
                      lastError.includes("could not read Username") ||
                      lastError.includes("could not read Password") ||
                      lastError.includes("Invalid username or password") ||
                      lastError.includes("Permission denied") ||
                      lastError.includes("Repository not found") ||
                      lastError.includes("403");

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
                      await sandboxInstance.exec(
                        `rm -rf /root/workspace/${repoName}`
                      );
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
      if (error instanceof HTTPException) {
        throw error;
      }
      console.error("Failed to setup instance:", error);
      return c.text("Failed to setup instance", 500);
    }
  }
);

// =============================================================================
// List Morph Instances
// =============================================================================

const ListInstancesQuery = z
  .object({
    teamId: z.string().optional(),
  })
  .openapi("ListInstancesQuery");

const InstanceInfo = z
  .object({
    id: z.string(),
    status: z.string(),
    createdAt: z.string().optional(),
    metadata: z
      .object({
        app: z.string().optional(),
        userId: z.string().optional(),
        teamId: z.string().optional(),
      })
      .optional(),
  })
  .openapi("InstanceInfo");

const ListInstancesResponse = z.array(InstanceInfo).openapi("ListInstancesResponse");

morphRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/morph/instances",
    tags: ["Morph"],
    summary: "List Morph instances for the authenticated user",
    request: {
      query: ListInstancesQuery,
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: ListInstancesResponse,
          },
        },
        description: "List of Morph instances",
      },
      401: { description: "Unauthorized" },
      500: { description: "Failed to list instances" },
    },
  }),
  async (c) => {
    const user = await getUserFromRequest(c.req.raw);
    if (!user) {
      return c.text("Unauthorized", 401);
    }
    const { accessToken } = await user.getAuthJson();
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const { teamId } = c.req.valid("query");

    try {
      const convex = getConvex({ accessToken });

      // Get user's team memberships to scope the results
      const memberships = await convex.query(api.teams.listTeamMemberships, {});
      const userTeamIds = new Set(memberships.map((m) => m.team.teamId));

      // If teamId filter is specified, verify user belongs to that team
      if (teamId && !userTeamIds.has(teamId)) {
        return c.text("Forbidden - not a member of this team", 403);
      }

      const client = new MorphCloudClient({ apiKey: env.MORPH_API_KEY });

      // List all instances from Morph
      const instances = await client.instances.list();

      // Filter instances: user must own them directly or be a member of the owning team
      const filteredInstances = instances.filter((instance) => {
        const meta = instance.metadata as
          | { app?: string; teamId?: string; userId?: string }
          | undefined;

        // Only show cmux instances
        if (meta?.app !== "cmux-dev") {
          return false;
        }

        // Filter by team if specified
        if (teamId && meta?.teamId !== teamId) {
          return false;
        }

        // Security: Only show instances the user owns or belongs to their teams
        const isOwner = meta?.userId === user.id;
        const isTeamMember = meta?.teamId ? userTeamIds.has(meta.teamId) : false;

        if (!isOwner && !isTeamMember) {
          return false;
        }

        return true;
      });

      // Map to response format
      const response = filteredInstances.map((instance) => ({
        id: instance.id,
        status: instance.status,
        createdAt: (instance as unknown as { created?: string }).created,
        metadata: instance.metadata as
          | { app?: string; userId?: string; teamId?: string }
          | undefined,
      }));

      return c.json(response);
    } catch (error) {
      console.error("[morph.list-instances] Failed to list instances:", error);
      return c.text("Failed to list instances", 500);
    }
  }
);

// NOTE: CLI Credentials endpoint was removed for security reasons.
// The shared Morph API key should NEVER be exposed to clients.
// All Morph operations must be proxied through the backend which enforces
// proper team/user access controls.
