import { attemptResumeIfNeeded } from "@/lib/utils/morph-resume";
import { getConvex } from "@/lib/utils/get-convex";
import { stackServerAppJs } from "@/lib/utils/stack";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { extractMorphInstanceInfo } from "@cmux/shared";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

export const taskRunsRouter = new OpenAPIHono();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const ForceWakeBody = z
  .object({
    teamSlugOrId: z.string().min(1),
    taskRunId: typedZid("taskRuns"),
  })
  .openapi("ForceWakeTaskRunBody");

const ForceWakeResponse = z
  .object({
    outcome: z.enum(["already_ready", "resumed"]),
    instanceId: z.string(),
  })
  .openapi("ForceWakeTaskRunResponse");

taskRunsRouter.openapi(
  createRoute({
    method: "post",
    path: "/task-runs/force-wake",
    tags: ["TaskRuns"],
    summary: "Force resume the Morph VM backing a task run workspace",
    request: {
      body: {
        content: {
          "application/json": {
            schema: ForceWakeBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Workspace resumed or already ready",
        content: {
          "application/json": {
            schema: ForceWakeResponse,
          },
        },
      },
      400: { description: "Workspace is not backed by a Morph VM" },
      401: { description: "Unauthorized" },
      403: { description: "Forbidden" },
      404: { description: "Task run or Morph instance not found" },
      500: { description: "Failed to resume Morph instance" },
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
    const convex = getConvex({ accessToken });
    const run = await convex.query(api.taskRuns.get, {
      teamSlugOrId,
      id: taskRunId as Id<"taskRuns">,
    });

    if (!run) {
      return c.json({ error: "Task run not found" }, 404);
    }

    if (run.vscode?.provider !== "morph") {
      return c.json(
        { error: "Task run is not backed by a Morph workspace." },
        400
      );
    }

    const workspaceUrl = run.vscode?.workspaceUrl ?? run.vscode?.url ?? null;
    if (!workspaceUrl) {
      return c.json(
        { error: "Task run is missing a workspace URL." },
        400
      );
    }

    const morphInfo = extractMorphInstanceInfo(workspaceUrl);
    if (!morphInfo) {
      return c.json(
        { error: "Workspace URL could not be mapped to a Morph instance." },
        400
      );
    }

    const resumeOutcome = await attemptResumeIfNeeded(
      morphInfo,
      async () => {},
      {
        authorizeInstance: async (instance) => {
          const metadata = instance.metadata;
          if (!isRecord(metadata)) {
            return {
              authorized: false,
              reason: "Unable to verify workspace ownership.",
            };
          }

          const metadataUserId =
            typeof metadata.userId === "string" ? metadata.userId : null;
          if (metadataUserId && metadataUserId !== run.userId) {
            return {
              authorized: false,
              reason: "Workspace belongs to another user.",
            };
          }

          const metadataTeamId =
            typeof metadata.teamId === "string" ? metadata.teamId : null;
          if (metadataTeamId && metadataTeamId !== run.teamId) {
            return {
              authorized: false,
              reason: "Workspace belongs to another team.",
            };
          }

          if (!metadataUserId && !metadataTeamId) {
            return {
              authorized: false,
              reason: "Unable to verify workspace ownership.",
            };
          }

          return { authorized: true };
        },
      }
    );

    if (resumeOutcome === "already_ready" || resumeOutcome === "resumed") {
      return c.json({
        outcome: resumeOutcome,
        instanceId: morphInfo.instanceId,
      });
    }

    if (resumeOutcome === "not_found") {
      return c.json(
        {
          error: `Morph instance ${morphInfo.instanceId} was not found.`,
        },
        404
      );
    }

    if (resumeOutcome === "forbidden") {
      return c.json(
        {
          error: "You do not have permission to resume this workspace.",
        },
        403
      );
    }

    return c.json(
      {
        error: `Failed to resume Morph instance ${morphInfo.instanceId}.`,
      },
      500
    );
  }
);
