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
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { getPveLxcClient } from "@/lib/utils/pve-lxc-client";

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
      const client = getPveLxcClient();
      const instance = await client.instances.get({ instanceId });

      // Verify instance belongs to this team via metadata
      const metadataTeamId = instance.metadata?.teamId;
      if (metadataTeamId && metadataTeamId !== team.uuid) {
        return c.text("Forbidden", 403);
      }

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
