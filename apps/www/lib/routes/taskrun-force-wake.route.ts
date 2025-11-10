import { getConvex } from "@/lib/utils/get-convex";
import { stackServerAppJs } from "@/lib/utils/stack";
import { env } from "@/lib/utils/www-env";
import { api } from "@cmux/convex/api";
import { extractMorphInstanceInfo } from "@cmux/shared";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { MorphCloudClient } from "morphcloud";

const BodySchema = z
  .object({
    runId: z
      .string()
      .openapi({
        description: "The ID of the task run to wake",
        example: "kmb8yyzdbvgzh2yb5eeek8xh8n783t92",
      }),
  })
  .openapi("TaskRunForceWakeBody");

const MAX_RESUME_ATTEMPTS = 3;
const RESUME_RETRY_DELAY_MS = 1_000;

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("HTTP 404");
}

type MorphInstance = Awaited<
  ReturnType<MorphCloudClient["instances"]["get"]>
>;

interface SendEventFn {
  (event: string, data: Record<string, unknown>): Promise<void>;
}

async function resumeMorphInstance(
  instanceId: string,
  sendEvent: SendEventFn,
): Promise<"resumed" | "already_ready" | "failed" | "not_found"> {
  const client = new MorphCloudClient({ apiKey: env.MORPH_API_KEY });

  let instance: MorphInstance;
  try {
    instance = await client.instances.get({ instanceId });
  } catch (error) {
    if (isNotFoundError(error)) {
      await sendEvent("instance_not_found", { instanceId });
      return "not_found";
    }

    await sendEvent("resume_failed", {
      instanceId,
      error: error instanceof Error ? error.message : "Unknown error",
      stage: "lookup",
    });
    return "failed";
  }

  if (instance.status === "ready") {
    await sendEvent("already_ready", { instanceId });
    return "already_ready";
  }

  await sendEvent("resuming", {
    instanceId,
    status: instance.status,
  });

  for (let attempt = 1; attempt <= MAX_RESUME_ATTEMPTS; attempt += 1) {
    try {
      await instance.resume();
      await sendEvent("resumed", {
        instanceId,
        attempt,
      });
      return "resumed";
    } catch (error) {
      if (attempt >= MAX_RESUME_ATTEMPTS) {
        await sendEvent("resume_failed", {
          instanceId,
          attempt,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        return "failed";
      }

      await sendEvent("resume_retry", {
        instanceId,
        attempt,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      await wait(RESUME_RETRY_DELAY_MS * attempt);
    }
  }

  await sendEvent("resume_failed", { instanceId });
  return "failed";
}

export const taskRunForceWakeRouter = new OpenAPIHono();

taskRunForceWakeRouter.openapi(
  createRoute({
    method: "post",
    path: "/taskrun/force-wake",
    tags: ["TaskRun"],
    summary: "Force wake a paused Morph VM for a task run",
    request: {
      body: {
        content: {
          "application/json": {
            schema: BodySchema,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description:
          "Streaming server-sent events describing resume attempts and final result.",
        content: {
          "text/event-stream": {
            schema: z
              .string()
              .openapi({
                description:
                  "Text/event-stream payload where each event contains JSON encoded status updates.",
              }),
          },
        },
      },
      400: {
        description: "Invalid request (task run not found or missing VSCode URL)",
      },
      401: {
        description: "Request is missing valid authentication.",
      },
      403: {
        description: "User does not have permission to wake this VM.",
      },
    },
  }),
  async (c) => {
    const user = await stackServerAppJs.getUser({ tokenStore: c.req.raw });
    if (!user) {
      return c.json(
        {
          error: "Unauthorized",
        },
        401,
      );
    }

    const { accessToken } = await user.getAuthJson();
    if (!accessToken) {
      return c.json(
        {
          error: "Unauthorized",
        },
        401,
      );
    }

    const userId = user.id;
    const convexClient = getConvex({ accessToken });

    const { runId } = c.req.valid("json");

    // Fetch the task run
    const taskRun = await convexClient.query(api.taskRuns.get, {
      runId: runId as any,
    });

    if (!taskRun) {
      return c.json(
        {
          error: "Task run not found",
        },
        400,
      );
    }

    // Check if the task run has a morph VM
    if (taskRun.vscode?.provider !== "morph" || !taskRun.vscode?.url) {
      return c.json(
        {
          error: "Task run does not have a Morph VM or VSCode URL",
        },
        400,
      );
    }

    // Extract instance ID from VSCode URL
    const morphInfo = extractMorphInstanceInfo(taskRun.vscode.url);
    if (!morphInfo) {
      return c.json(
        {
          error: "Could not extract Morph instance info from VSCode URL",
        },
        400,
      );
    }

    // Check authorization: user must own the task run or be a member of the team
    const teamMembershipsPromise = convexClient.query(
      api.teams.listTeamMemberships,
      {},
    );

    // Verify ownership
    const client = new MorphCloudClient({ apiKey: env.MORPH_API_KEY });
    let instance: MorphInstance;
    try {
      instance = await client.instances.get({
        instanceId: morphInfo.instanceId,
      });
    } catch (error) {
      if (isNotFoundError(error)) {
        return c.json(
          {
            error: `Morph instance ${morphInfo.instanceId} not found`,
          },
          400,
        );
      }
      return c.json(
        {
          error: "Failed to fetch Morph instance",
        },
        500,
      );
    }

    // Check if user has permission (same logic as iframe-preflight)
    const metadata = instance.metadata;
    if (
      typeof metadata !== "object" ||
      metadata === null ||
      Array.isArray(metadata)
    ) {
      return c.json(
        {
          error: "Unable to verify workspace ownership",
        },
        403,
      );
    }

    const metadataUserId =
      typeof metadata.userId === "string" ? metadata.userId : null;
    if (metadataUserId && metadataUserId !== userId) {
      return c.json(
        {
          error: "You do not have permission to wake this VM",
        },
        403,
      );
    }

    const metadataTeamId =
      typeof metadata.teamId === "string" ? metadata.teamId : null;

    if (metadataTeamId) {
      try {
        const memberships = await teamMembershipsPromise;
        const belongsToTeam = memberships.some((membership) => {
          const membershipTeam =
            membership.team?.teamId ?? membership.teamId;
          return membershipTeam === metadataTeamId;
        });

        if (!belongsToTeam) {
          return c.json(
            {
              error:
                "You are not a member of the team that owns this workspace",
            },
            403,
          );
        }
      } catch (error) {
        console.error(
          "[taskrun-force-wake] Failed to verify team membership",
          error,
        );
        return c.json(
          {
            error: "We could not verify your team membership for this workspace",
          },
          403,
        );
      }
    } else if (!metadataUserId) {
      return c.json(
        {
          error: "Unable to verify workspace ownership",
        },
        403,
      );
    }

    // Stream the resume progress
    return streamSSE(c, async (stream) => {
      const sendEvent: SendEventFn = async (event, data) => {
        await stream.writeSSE({
          event,
          data: JSON.stringify(data),
        });
      };

      try {
        const result = await resumeMorphInstance(
          morphInfo.instanceId,
          sendEvent,
        );

        await sendEvent("complete", {
          result,
          instanceId: morphInfo.instanceId,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error during VM wake";

        await sendEvent("error", { error: message });
      } finally {
        stream.close();
      }
    });
  },
);
