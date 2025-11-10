import { attemptResumeIfNeeded, isRecord } from "@/lib/services/morph/resume";
import { getConvex } from "@/lib/utils/get-convex";
import { stackServerAppJs } from "@/lib/utils/stack";
import { api } from "@cmux/convex/api";
import {
  extractMorphInstanceInfo,
  type IframePreflightResult,
  type MorphInstanceInfo,
  type SendPhaseFn,
} from "@cmux/shared";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";

const ALLOWED_HOST_SUFFIXES = [
  ".cmux.sh",
  ".cmux.dev",
  ".cmux.local",
  ".cmux.localhost",
  ".cmux.app",
  ".autobuild.app",
  ".http.cloud.morph.so",
  ".vm.freestyle.sh",
] as const;

const ALLOWED_EXACT_HOSTS = new Set<string>([
  "cmux.sh",
  "www.cmux.sh",
  "cmux.dev",
  "www.cmux.dev",
  "cmux.local",
  "cmux.localhost",
  "cmux.app",
]);

const DEV_ONLY_HOSTS = new Set<string>(["localhost", "127.0.0.1", "::1"]);

function isAllowedHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();

  if (ALLOWED_EXACT_HOSTS.has(normalized)) {
    return true;
  }

  if (ALLOWED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return true;
  }

  const isDevelopment = process.env.NODE_ENV !== "production";

  if (isDevelopment && DEV_ONLY_HOSTS.has(normalized)) {
    return true;
  }

  return false;
}

const QuerySchema = z
  .object({
    url: z
      .string()
      .url()
      .openapi({
        description:
          "Absolute HTTP(S) URL to check before embedding in an iframe.",
      }),
  })
  .openapi("IframePreflightQuery");

async function performPreflight(target: URL): Promise<IframePreflightResult> {
  const probe = async (method: "HEAD" | "GET") => {
    const response = await fetch(target, {
      method,
      redirect: "manual",
    });
    await response.body?.cancel().catch(() => undefined);
    return response;
  };

  try {
    const headResponse = await probe("HEAD");

    if (headResponse.ok) {
      return {
        ok: true,
        status: headResponse.status,
        method: "HEAD",
      };
    }

    if (headResponse.status === 405) {
      const getResponse = await probe("GET");
      if (getResponse.ok) {
        return {
          ok: true,
          status: getResponse.status,
          method: "GET",
        };
      }

      return {
        ok: false,
        status: getResponse.status,
        method: "GET",
        error: `Request failed with status ${getResponse.status}.`,
      };
    }

    return {
      ok: false,
      status: headResponse.status,
      method: "HEAD",
      error: `Request failed with status ${headResponse.status}.`,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      method: null,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error during preflight.",
    };
  }
}

export const iframePreflightRouter = new OpenAPIHono();

iframePreflightRouter.openapi(
  createRoute({
    method: "get",
    path: "/iframe/preflight",
    tags: ["Iframe"],
    summary: "Validate iframe target availability via server-side preflight.",
    request: {
      query: QuerySchema,
    },
    responses: {
      200: {
        description:
          "Streaming server-sent events describing resume attempts and preflight result.",
        content: {
          "text/event-stream": {
            schema: z
              .string()
              .openapi({
                description:
                  "Text/event-stream payload where each event contains JSON encoded status updates and the final result.",
              }),
          },
        },
      },
      400: {
        description: "The provided URL was not an HTTP(S) URL.",
      },
      403: {
        description: "The target host is not permitted for probing.",
      },
      401: {
        description: "Request is missing valid authentication.",
      },
    },
  }),
  async (c) => {
    const user = await stackServerAppJs.getUser({ tokenStore: c.req.raw });
    if (!user) {
      return c.json(
        {
          ok: false,
          status: null,
          method: null,
          error: "Unauthorized",
        },
        401,
      );
    }

    const { accessToken } = await user.getAuthJson();
    if (!accessToken) {
      return c.json(
        {
          ok: false,
          status: null,
          method: null,
          error: "Unauthorized",
        },
        401,
      );
    }

    const userId = user.id;
    const convexClient = getConvex({ accessToken });

    const { url } = c.req.valid("query");
    const target = new URL(url);

    if (target.protocol !== "https:" && target.protocol !== "http:") {
      return c.json(
        {
          ok: false,
          status: null,
          method: null,
          error: "Only HTTP(S) URLs are supported.",
        },
        400,
      );
    }

    if (target.username || target.password) {
      return c.json(
        {
          ok: false,
          status: null,
          method: null,
          error: "Authentication credentials in URL are not supported.",
        },
        400,
      );
    }

    if (!isAllowedHost(target.hostname)) {
      return c.json(
        {
          ok: false,
          status: null,
          method: null,
          error: `Requests to ${target.hostname} are not permitted.`,
        },
        403,
      );
    }

    const morphInfo = extractMorphInstanceInfo(target);

    return streamSSE(c, async (stream) => {
      const sendPhase: SendPhaseFn = async (phase, extra) => {
        await stream.writeSSE({
          event: "phase",
          data: JSON.stringify({
            phase,
            ...(extra ?? {}),
          }),
        });
      };

      const sendResult = async (result: IframePreflightResult) => {
        await stream.writeSSE({
          event: "result",
          data: JSON.stringify(result),
        });
      };

      try {
        if (morphInfo) {
          const teamMembershipsPromise = convexClient
            .query(api.teams.listTeamMemberships, {});

          const resumeOutcome = await attemptResumeIfNeeded(
            morphInfo,
            sendPhase,
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
                  typeof metadata.userId === "string"
                    ? metadata.userId
                    : null;
                if (metadataUserId && metadataUserId !== userId) {
                  return {
                    authorized: false,
                    reason:
                      "You do not have permission to resume this workspace.",
                  };
                }

                const metadataTeamId =
                  typeof metadata.teamId === "string"
                    ? metadata.teamId
                    : null;

                if (metadataTeamId) {
                  try {
                    const memberships = await teamMembershipsPromise;
                    const belongsToTeam = memberships.some((membership) => {
                      const membershipTeam =
                        membership.team?.teamId ?? membership.teamId;
                      return membershipTeam === metadataTeamId;
                    });

                    if (!belongsToTeam) {
                      return {
                        authorized: false,
                        reason:
                          "You are not a member of the team that owns this workspace.",
                      };
                    }
                  } catch (error) {
                    console.error(
                      "[iframe-preflight] Failed to verify team membership",
                      error,
                    );
                    return {
                      authorized: false,
                      reason:
                        "We could not verify your team membership for this workspace.",
                    };
                  }
                } else if (!metadataUserId) {
                  return {
                    authorized: false,
                    reason: "Unable to verify workspace ownership.",
                  };
                }

                return { authorized: true };
              },
            },
          );

          if (resumeOutcome === "not_found") {
            await sendResult({
              ok: false,
              status: null,
              method: null,
              error: `Morph instance ${morphInfo.instanceId} was not found.`,
            });
            return;
          }

          if (resumeOutcome === "forbidden") {
            await sendResult({
              ok: false,
              status: null,
              method: null,
              error:
                "You do not have permission to resume this workspace.",
            });
            return;
          }

          if (resumeOutcome === "failed") {
            await sendResult({
              ok: false,
              status: null,
              method: null,
              error: `Failed to resume Morph instance ${morphInfo.instanceId}.`,
            });
            return;
          }
        }

        const preflightResult = await performPreflight(target);

        if (preflightResult.ok) {
          await sendPhase("ready", {
            status: preflightResult.status,
            method: preflightResult.method,
          });
        } else {
          await sendPhase("preflight_failed", {
            status: preflightResult.status,
            error: preflightResult.error,
          });
        }

        await sendResult(preflightResult);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown error during iframe preflight.";

        await sendPhase("error", { error: message });
        await sendResult({
          ok: false,
          status: null,
          method: null,
          error: message,
        });
      } finally {
        stream.close();
      }
    });
  },
);
