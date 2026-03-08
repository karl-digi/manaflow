/**
 * PVE LXC Container Management Routes
 *
 * Provides resume and status checking endpoints for PVE LXC containers,
 * mirroring the morph.route.ts API structure for consistency.
 */

import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { env } from "@/lib/utils/www-env";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { getConvex } from "../utils/get-convex";
import { api, internal } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { getPveLxcClient } from "@/lib/utils/pve-lxc-client";
import { ConvexHttpClient } from "convex/browser";

export const pveLxcRouter = new OpenAPIHono();

const ResumeTaskRunBody = z
  .object({
    teamSlugOrId: z.string(),
  })
  .openapi("PveLxcResumeTaskRunBody");

const CheckTaskRunStoppedBody = z
  .object({
    teamSlugOrId: z.string(),
  })
  .openapi("PveLxcCheckTaskRunStoppedBody");

const ResumeTaskRunResponse = z
  .object({
    resumed: z.literal(true),
  })
  .openapi("PveLxcResumeTaskRunResponse");

const CheckTaskRunStoppedResponse = z
  .object({
    stopped: z.boolean(),
    deleted: z.boolean().optional(), // True if container was deleted
  })
  .openapi("PveLxcCheckTaskRunStoppedResponse");

/**
 * Resume a stopped PVE LXC container
 */
pveLxcRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/pve-lxc/task-runs/{taskRunId}/resume",
    tags: ["PVE LXC"],
    summary: "Resume the PVE LXC container backing a task run",
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
        description: "PVE LXC container resumed",
      },
      400: { description: "Task run is not backed by a PVE LXC container" },
      401: { description: "Unauthorized" },
      403: { description: "Forbidden" },
      404: { description: "Task run or container not found" },
      500: { description: "Failed to resume container" },
      503: { description: "PVE LXC provider not configured" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    // Check if PVE LXC is configured
    if (!env.PVE_API_URL || !env.PVE_API_TOKEN) {
      return c.text("PVE LXC provider not configured", 503);
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
    const isPveLxcProvider = taskRun.vscode?.provider === "pve-lxc";

    if (!isPveLxcProvider || !instanceId) {
      return c.text("Task run is not backed by a PVE LXC container", 400);
    }

    try {
      const activity = await convex.query(api.sandboxInstances.getActivity, {
        instanceId,
      });
      if (!activity || !activity.teamId) {
        return c.text("Sandbox not found", 404);
      }
      if (activity.teamId !== team.uuid) {
        return c.text("Forbidden", 403);
      }

      const client = getPveLxcClient();
      const instance = await client.instances.get({ instanceId });

      // Start the container (resume is just start for LXC)
      await instance.start();

      // Record the resume for activity tracking
      await convex.mutation(api.sandboxInstances.recordResume, {
        instanceId,
        teamSlugOrId,
      });

      // Update VSCode status to running
      await convex.mutation(api.taskRuns.updateVSCodeStatus, {
        teamSlugOrId,
        id: taskRunId as Id<"taskRuns">,
        status: "running",
      });

      return c.json({ resumed: true });
    } catch (error) {
      console.error("[pve-lxc.resume-task-run] Failed to resume container", error);
      return c.text("Failed to resume container", 500);
    }
  }
);

// ============================================================================
// Preview Job Proxy Endpoints - For convex preview_jobs_worker
// ============================================================================

const PreviewInstanceStartBody = z
  .object({
    snapshotId: z.string(),
    templateVmid: z.number().optional(),
    metadata: z.record(z.string(), z.string().optional()).optional(),
    ttlSeconds: z.number().optional(),
    ttlAction: z.enum(["pause", "stop"]).optional(),
  })
  .openapi("PveLxcPreviewInstanceStartBody");

const PreviewInstanceStartResponse = z
  .object({
    instanceId: z.string(),
    vmid: z.number(),
    status: z.string(),
    networking: z.object({
      httpServices: z.array(
        z.object({
          name: z.string(),
          port: z.number(),
          url: z.string(),
        })
      ),
      hostname: z.string().optional(),
      fqdn: z.string().optional(),
    }),
  })
  .openapi("PveLxcPreviewInstanceStartResponse");

const PreviewInstanceExecBody = z
  .object({
    command: z.string(),
    timeoutMs: z.number().optional(),
  })
  .openapi("PveLxcPreviewInstanceExecBody");

const PreviewInstanceExecResponse = z
  .object({
    exit_code: z.number(),
    stdout: z.string(),
    stderr: z.string(),
  })
  .openapi("PveLxcPreviewInstanceExecResponse");

/**
 * Start a PVE LXC instance for preview jobs (called from convex)
 * This endpoint uses an internal API key for authentication instead of user tokens.
 */
pveLxcRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/pve-lxc/preview/instances/start",
    tags: ["PVE LXC Preview"],
    summary: "Start a PVE LXC instance for preview jobs (internal)",
    request: {
      body: {
        content: {
          "application/json": {
            schema: PreviewInstanceStartBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: PreviewInstanceStartResponse,
          },
        },
        description: "PVE LXC instance started",
      },
      401: { description: "Unauthorized - missing or invalid internal API key" },
      500: { description: "Failed to start instance" },
      503: { description: "PVE LXC provider not configured" },
    },
  }),
  async (c) => {
    // Authenticate with internal API key (used by convex preview_jobs_worker)
    const authHeader = c.req.header("Authorization");
    const expectedKey = process.env.CMUX_TASK_RUN_JWT_SECRET;
    if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
      return c.text("Unauthorized - missing or invalid internal API key", 401);
    }

    // Check if PVE LXC is configured
    if (!env.PVE_API_URL || !env.PVE_API_TOKEN) {
      return c.text("PVE LXC provider not configured", 503);
    }

    const body = c.req.valid("json");

    try {
      const client = getPveLxcClient();
      const instance = await client.instances.start({
        snapshotId: body.snapshotId,
        templateVmid: body.templateVmid,
        ttlSeconds: body.ttlSeconds ?? 3600,
        ttlAction: body.ttlAction ?? "stop",
        metadata: body.metadata,
      });

      // Record activity for maintenance tracking (best effort).
      // This endpoint is called by internal preview workers, so we use admin auth.
      try {
        const deployKey = process.env.CONVEX_DEPLOY_KEY;
        if (!deployKey) {
          console.warn(
            "[pve-lxc.preview.start] CONVEX_DEPLOY_KEY not configured; skipping activity record"
          );
        } else {
          type ConvexAdminClient = {
            setAdminAuth: (token: string) => void;
            mutation: (mutationRef: unknown, args: unknown) => Promise<unknown>;
          };
          const convex = new ConvexHttpClient(
            env.NEXT_PUBLIC_CONVEX_URL
          ) as unknown as ConvexAdminClient;
          convex.setAdminAuth(deployKey);
          await convex.mutation(internal.sandboxInstances.recordCreateInternal, {
            instanceId: instance.id,
            provider: "pve-lxc",
            vmid: instance.vmid,
            hostname: instance.networking.hostname,
            snapshotId: body.snapshotId,
            snapshotProvider: "pve-lxc",
            templateVmid: body.templateVmid,
            teamId: body.metadata?.teamId,
            userId: body.metadata?.userId,
          });
        }
      } catch (error) {
        // Non-fatal: preview flow should continue even if tracking write fails.
        console.error(
          "[pve-lxc.preview.start] Failed to record instance creation (non-fatal):",
          error
        );
      }

      return c.json({
        instanceId: instance.id,
        vmid: instance.vmid,
        status: instance.status,
        networking: {
          httpServices: instance.networking.httpServices,
          hostname: instance.networking.hostname,
          fqdn: instance.networking.fqdn,
        },
      });
    } catch (error) {
      console.error("[pve-lxc.preview.start] Failed to start instance", error);
      return c.text(
        `Failed to start instance: ${error instanceof Error ? error.message : String(error)}`,
        500
      );
    }
  }
);

/**
 * Execute a command in a PVE LXC instance for preview jobs (called from convex)
 */
pveLxcRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/pve-lxc/preview/instances/{instanceId}/exec",
    tags: ["PVE LXC Preview"],
    summary: "Execute a command in a PVE LXC instance for preview jobs (internal)",
    request: {
      params: z.object({
        instanceId: z.string(),
      }),
      body: {
        content: {
          "application/json": {
            schema: PreviewInstanceExecBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: PreviewInstanceExecResponse,
          },
        },
        description: "Command executed",
      },
      401: { description: "Unauthorized - missing or invalid internal API key" },
      404: { description: "Instance not found" },
      500: { description: "Failed to execute command" },
      503: { description: "PVE LXC provider not configured" },
    },
  }),
  async (c) => {
    // Authenticate with internal API key
    const authHeader = c.req.header("Authorization");
    const expectedKey = process.env.CMUX_TASK_RUN_JWT_SECRET;
    if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
      return c.text("Unauthorized - missing or invalid internal API key", 401);
    }

    // Check if PVE LXC is configured
    if (!env.PVE_API_URL || !env.PVE_API_TOKEN) {
      return c.text("PVE LXC provider not configured", 503);
    }

    const { instanceId } = c.req.valid("param");
    const body = c.req.valid("json");

    try {
      const client = getPveLxcClient();
      const instance = await client.instances.get({ instanceId });

      const result = await instance.exec(body.command, {
        timeoutMs: body.timeoutMs,
      });

      return c.json({
        exit_code: result.exit_code,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("404") || errorMessage.includes("not found")) {
        return c.text("Instance not found", 404);
      }
      console.error("[pve-lxc.preview.exec] Failed to execute command", error);
      return c.text("Failed to execute command", 500);
    }
  }
);

/**
 * Stop a PVE LXC instance for preview jobs (called from convex)
 */
pveLxcRouter.openapi(
  createRoute({
    method: "delete" as const,
    path: "/pve-lxc/preview/instances/{instanceId}",
    tags: ["PVE LXC Preview"],
    summary: "Stop a PVE LXC instance for preview jobs (internal)",
    request: {
      params: z.object({
        instanceId: z.string(),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ stopped: z.literal(true) }),
          },
        },
        description: "PVE LXC instance stopped",
      },
      401: { description: "Unauthorized - missing or invalid internal API key" },
      404: { description: "Instance not found" },
      500: { description: "Failed to stop instance" },
      503: { description: "PVE LXC provider not configured" },
    },
  }),
  async (c) => {
    // Authenticate with internal API key
    const authHeader = c.req.header("Authorization");
    const expectedKey = process.env.CMUX_TASK_RUN_JWT_SECRET;
    if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
      return c.text("Unauthorized - missing or invalid internal API key", 401);
    }

    // Check if PVE LXC is configured
    if (!env.PVE_API_URL || !env.PVE_API_TOKEN) {
      return c.text("PVE LXC provider not configured", 503);
    }

    const { instanceId } = c.req.valid("param");

    try {
      const client = getPveLxcClient();
      const instance = await client.instances.get({ instanceId });
      await instance.stop();

      return c.json({ stopped: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("404") || errorMessage.includes("not found")) {
        return c.text("Instance not found", 404);
      }
      console.error("[pve-lxc.preview.stop] Failed to stop instance", error);
      return c.text("Failed to stop instance", 500);
    }
  }
);

/**
 * Read a file from a PVE LXC instance for preview jobs (called from convex)
 * Returns file content as base64.
 */
pveLxcRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/pve-lxc/preview/instances/{instanceId}/read-file",
    tags: ["PVE LXC Preview"],
    summary: "Read a file from a PVE LXC instance for preview jobs (internal)",
    request: {
      params: z.object({
        instanceId: z.string(),
      }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              filePath: z.string(),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              base64: z.string(),
              size: z.number(),
            }),
          },
        },
        description: "File content returned",
      },
      401: { description: "Unauthorized - missing or invalid internal API key" },
      404: { description: "Instance or file not found" },
      500: { description: "Failed to read file" },
      503: { description: "PVE LXC provider not configured" },
    },
  }),
  async (c) => {
    // Authenticate with internal API key
    const authHeader = c.req.header("Authorization");
    const expectedKey = process.env.CMUX_TASK_RUN_JWT_SECRET;
    if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
      return c.text("Unauthorized - missing or invalid internal API key", 401);
    }

    // Check if PVE LXC is configured
    if (!env.PVE_API_URL || !env.PVE_API_TOKEN) {
      return c.text("PVE LXC provider not configured", 503);
    }

    const { instanceId } = c.req.valid("param");
    const { filePath } = c.req.valid("json");

    try {
      const client = getPveLxcClient();
      const instance = await client.instances.get({ instanceId });

      // Read file via exec using base64 encoding
      const result = await instance.exec(`base64 -w 0 "${filePath}"`);
      if (result.exit_code !== 0) {
        if (result.stderr.includes("No such file")) {
          return c.text("File not found", 404);
        }
        throw new Error(`Failed to read file: ${result.stderr}`);
      }

      const base64Content = result.stdout.trim();
      const size = Math.floor((base64Content.length * 3) / 4);

      return c.json({
        base64: base64Content,
        size,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("404") || errorMessage.includes("not found")) {
        return c.text("Instance not found", 404);
      }
      console.error("[pve-lxc.preview.read-file] Failed to read file", error);
      return c.text("Failed to read file", 500);
    }
  }
);

/**
 * Check if a PVE LXC container is stopped
 */
pveLxcRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/pve-lxc/task-runs/{taskRunId}/is-stopped",
    tags: ["PVE LXC"],
    summary: "Check if the PVE LXC container backing a task run is stopped",
    request: {
      params: z.object({
        taskRunId: typedZid("taskRuns"),
      }),
      body: {
        content: {
          "application/json": {
            schema: CheckTaskRunStoppedBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: CheckTaskRunStoppedResponse,
          },
        },
        description: "PVE LXC container status returned",
      },
      400: { description: "Task run is not backed by a PVE LXC container" },
      401: { description: "Unauthorized" },
      403: { description: "Forbidden" },
      404: { description: "Task run not found" },
      500: { description: "Failed to check container status" },
      503: { description: "PVE LXC provider not configured" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    // Check if PVE LXC is configured
    if (!env.PVE_API_URL || !env.PVE_API_TOKEN) {
      return c.text("PVE LXC provider not configured", 503);
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
    const isPveLxcProvider = taskRun.vscode?.provider === "pve-lxc";

    if (!isPveLxcProvider || !instanceId) {
      return c.text("Task run is not backed by a PVE LXC container", 400);
    }

    try {
      const activity = await convex.query(api.sandboxInstances.getActivity, {
        instanceId,
      });
      if (!activity || !activity.teamId) {
        return c.text("Sandbox not found", 404);
      }
      if (activity.teamId !== team.uuid) {
        return c.text("Forbidden", 403);
      }

      const client = getPveLxcClient();

      let instance;
      try {
        instance = await client.instances.get({ instanceId });
      } catch (instanceError) {
        // If instance not found, it was deleted
        const errorMessage = instanceError instanceof Error ? instanceError.message : String(instanceError);
        if (errorMessage.includes("404") || errorMessage.includes("not found")) {
          return c.json({
            stopped: true,
            deleted: true,
          });
        }
        throw instanceError;
      }

      // Verify instance belongs to this team via metadata
      const metadataTeamId = instance.metadata?.teamId;
      if (metadataTeamId && metadataTeamId !== team.uuid) {
        return c.text("Forbidden", 403);
      }

      // LXC containers are either running or stopped (no hibernate/pause like VMs)
      return c.json({
        stopped: instance.status === "stopped",
        deleted: false,
      });
    } catch (error) {
      console.error(
        "[pve-lxc.check-task-run-stopped] Failed to check container status",
        error
      );
      return c.text("Failed to check container status", 500);
    }
  }
);
