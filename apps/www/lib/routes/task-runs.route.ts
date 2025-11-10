import {
  attemptResumeIfNeeded,
  isNotFoundError,
  isRecord,
  wait,
  type AuthorizationResult,
  type MorphInstance,
} from "@/lib/services/morph/resume";
import { getConvex } from "@/lib/utils/get-convex";
import { stackServerAppJs } from "@/lib/utils/stack";
import { env } from "@/lib/utils/www-env";
import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";
import { extractMorphInstanceInfo } from "@cmux/shared";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { MorphCloudClient } from "morphcloud";

const READY_POLL_INTERVAL_MS = 2_000;
const READY_TIMEOUT_MS = 60_000;

type TaskRunDoc = Doc<"taskRuns">;

const ForceWakeBody = z
  .object({
    teamSlugOrId: z.string(),
  })
  .openapi("TaskRunForceWakeBody");

const ForceWakeResponse = z
  .object({
    status: z.enum(["already_ready", "resumed"]),
    instanceId: z.string(),
    morphId: z.string(),
  })
  .openapi("TaskRunForceWakeResponse");

export const taskRunsRouter = new OpenAPIHono();

taskRunsRouter.openapi(
  createRoute({
    method: "post",
    path: "/task-runs/{taskRunId}/force-wake",
    tags: ["TaskRuns"],
    summary: "Force wake the Morph VM that backs a task run",
    request: {
      params: z.object({
        taskRunId: z.string(),
      }),
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
        description: "The Morph VM is ready",
        content: {
          "application/json": {
            schema: ForceWakeResponse,
          },
        },
      },
      400: { description: "Task run does not have a Morph workspace" },
      401: { description: "Unauthorized" },
      403: { description: "Forbidden" },
      404: { description: "Task run or Morph VM not found" },
      502: { description: "Failed to resume the Morph VM" },
      504: { description: "Timed out waiting for the Morph VM" },
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

    const { taskRunId } = c.req.valid("param");
    const { teamSlugOrId } = c.req.valid("json");
    const normalizedTaskRunId = typedZid("taskRuns").parse(taskRunId);

    const convex = getConvex({ accessToken });
    const run = await convex.query(api.taskRuns.get, {
      teamSlugOrId,
      id: normalizedTaskRunId,
    });

    if (!run) {
      return c.json({ error: "Task run not found" }, 404);
    }

    if (run.vscode?.provider !== "morph") {
      return c.json(
        { error: "This task run is not backed by a Morph workspace" },
        400,
      );
    }

    const morphInfo = resolveMorphInstanceInfo(run);
    if (!morphInfo) {
      return c.json(
        {
          error:
            "Unable to determine the Morph workspace for this task run",
        },
        400,
      );
    }

    const phaseLog: Array<Record<string, unknown>> = [];
    let forbiddenReason: string | null = null;
    let failureReason: string | null = null;

    const resumeOutcome = await attemptResumeIfNeeded(
      morphInfo,
      async (phase, extra) => {
        phaseLog.push({ phase, ...(extra ?? {}) });
        if (phase === "resume_forbidden" && extra?.reason) {
          forbiddenReason = String(extra.reason);
        }
        if (phase === "resume_failed" && extra?.error) {
          failureReason = String(extra.error);
        }
      },
      {
        authorizeInstance: (instance) =>
          authorizeMorphInstance(instance, {
            run,
            userId: user.id,
          }),
      },
    );

    if (resumeOutcome === "not_found") {
      return c.json(
        {
          error: `Morph instance ${morphInfo.instanceId} was not found`,
        },
        404,
      );
    }

    if (resumeOutcome === "forbidden") {
      return c.json(
        {
          error:
            forbiddenReason ??
            "You do not have permission to resume this workspace",
        },
        403,
      );
    }

    if (resumeOutcome === "failed") {
      console.error("[taskRuns.forceWake] Failed to resume Morph VM", {
        morphInfo,
        phaseLog,
      });
      return c.json(
        {
          error:
            failureReason ??
            `Failed to resume Morph instance ${morphInfo.instanceId}`,
        },
        502,
      );
    }

    const readyState = await waitForInstanceReady(morphInfo.instanceId);
    if (readyState === "timeout") {
      return c.json(
        {
          error: "Timed out waiting for the workspace to become ready",
        },
        504,
      );
    }

    if (readyState === "not_found") {
      return c.json(
        {
          error: `Morph instance ${morphInfo.instanceId} disappeared while resuming`,
        },
        404,
      );
    }

    if (readyState === "failed") {
      return c.json(
        {
          error: "Failed to verify workspace readiness",
        },
        502,
      );
    }

    return c.json({
      status: resumeOutcome,
      instanceId: morphInfo.instanceId,
      morphId: morphInfo.morphId,
    });
  },
);

function resolveMorphInstanceInfo(run: TaskRunDoc) {
  const candidates: Array<string | undefined | null> = [
    run.vscode?.workspaceUrl,
    run.vscode?.url,
    ...(run.networking?.map((service) => service.url) ?? []),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const info = extractMorphInstanceInfo(candidate);
    if (info) {
      return info;
    }
  }
  return null;
}

async function authorizeMorphInstance(
  instance: MorphInstance,
  context: { run: TaskRunDoc; userId: string },
): Promise<AuthorizationResult> {
  const metadata = instance.metadata;
  if (!isRecord(metadata)) {
    return {
      authorized: false,
      reason: "Unable to verify workspace ownership.",
    };
  }

  const metadataUserId =
    typeof metadata.userId === "string" ? metadata.userId : null;
  const metadataTeamId =
    typeof metadata.teamId === "string" ? metadata.teamId : null;
  const metadataRunId =
    typeof metadata.taskRunId === "string" ? metadata.taskRunId : null;
  const runId = String(context.run._id);

  if (
    metadataUserId &&
    metadataUserId !== context.userId &&
    metadataUserId !== context.run.userId
  ) {
    return {
      authorized: false,
      reason: "You do not have permission to resume this workspace.",
    };
  }

  if (metadataTeamId && metadataTeamId !== context.run.teamId) {
    return {
      authorized: false,
      reason: "This workspace belongs to a different team.",
    };
  }

  if (metadataRunId && metadataRunId !== runId) {
    return {
      authorized: false,
      reason: "This workspace is linked to a different task run.",
    };
  }

  if (!metadataUserId && !metadataTeamId && !metadataRunId) {
    return {
      authorized: false,
      reason: "Unable to verify workspace ownership.",
    };
  }

  return { authorized: true };
}

async function waitForInstanceReady(
  instanceId: string,
): Promise<"ready" | "timeout" | "not_found" | "failed"> {
  const client = new MorphCloudClient({ apiKey: env.MORPH_API_KEY });
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const instance = await client.instances.get({ instanceId });
      if (instance.status === "ready") {
        return "ready";
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        return "not_found";
      }
      console.error("[taskRuns.forceWake] Failed to poll Morph instance", {
        instanceId,
        error,
      });
      return "failed";
    }

    await wait(READY_POLL_INTERVAL_MS);
  }

  return "timeout";
}
