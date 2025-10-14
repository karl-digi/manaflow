import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { env } from "@/lib/utils/www-env";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { MorphCloudClient } from "morphcloud";
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

const MORPH_HOST_REGEX = /^port-(\d+)-morphvm-([^.]+)\.http\.cloud\.morph\.so$/;

function parseMorphInstanceId(hostname: string): string | null {
  const match = hostname.match(MORPH_HOST_REGEX);
  if (!match) {
    return null;
  }
  return `morphvm_${match[2]}`;
}

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

const ResponseSchema = z
  .object({
    ok: z.boolean().openapi({
      description:
        "Whether the target responded successfully to the probe request.",
    }),
    status: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "HTTP status code returned by the target." }),
    method: z
      .enum(["HEAD", "GET"])
      .nullable()
      .openapi({
        description: "HTTP method used for the successful probe.",
      }),
    error: z
      .string()
      .optional()
      .openapi({ description: "Error message if the probe failed." }),
  })
  .openapi("IframePreflightResponse");

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
          "Result of the preflight check for the requested iframe URL.",
        content: {
          "application/json": {
            schema: ResponseSchema,
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
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
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
        return c.json({
          ok: true,
          status: headResponse.status,
          method: "HEAD",
        });
      }

      if (headResponse.status === 405) {
        const getResponse = await probe("GET");
        if (getResponse.ok) {
          return c.json({
            ok: true,
            status: getResponse.status,
            method: "GET",
          });
        }

        return c.json({
          ok: false,
          status: getResponse.status,
          method: "GET",
          error: `Request failed with status ${getResponse.status}.`,
        });
      }

      return c.json({
        ok: false,
        status: headResponse.status,
        method: "HEAD",
        error: `Request failed with status ${headResponse.status}.`,
      });
    } catch (error) {
      return c.json({
        ok: false,
        status: null,
        method: null,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error during preflight.",
      });
    }
  },
);

// Streaming endpoint for morph instance resume
iframePreflightRouter.openapi(
  createRoute({
    method: "get",
    path: "/iframe/preflight-stream",
    tags: ["Iframe"],
    summary: "Stream status of iframe target with morph instance resume support.",
    request: {
      query: QuerySchema,
    },
    responses: {
      200: {
        description: "Server-sent events stream with preflight and resume status.",
        content: {
          "text/event-stream": {
            schema: z.object({
              type: z.enum([
                "status",
                "resuming",
                "resumed",
                "ready",
                "error",
                "not_found",
              ]),
              message: z.string().optional(),
              attempt: z.number().optional(),
              maxAttempts: z.number().optional(),
            }),
          },
        },
      },
      400: {
        description: "The provided URL was not an HTTP(S) URL.",
      },
      401: {
        description: "Request is missing valid authentication.",
      },
      403: {
        description: "The target host is not permitted for probing.",
      },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
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

    // Check if this is a morph URL
    const instanceId = parseMorphInstanceId(target.hostname);

    return streamSSE(c, async (stream) => {
      try {
        // If it's a morph instance, try to resume it
        if (instanceId) {
          await stream.writeSSE({
            data: JSON.stringify({
              type: "status",
              message: "Detected morph instance, checking status...",
            }),
          });

          try {
            const client = new MorphCloudClient({
              apiKey: env.MORPH_API_KEY,
            });

            const instance = await client.instances.get({
              instanceId: instanceId,
            });

            const status = instance.status;

            if (status === "paused" || status === "pausing") {
              // Attempt to resume
              const maxAttempts = 3;
              let resumed = false;

              for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: "resuming",
                    message: `Resuming instance (attempt ${attempt}/${maxAttempts})...`,
                    attempt,
                    maxAttempts,
                  }),
                });

                try {
                  await instance.resume();
                  resumed = true;

                  await stream.writeSSE({
                    data: JSON.stringify({
                      type: "resumed",
                      message: "Instance resumed successfully",
                    }),
                  });

                  break;
                } catch (resumeError) {
                  if (attempt < maxAttempts) {
                    // Wait before retry with exponential backoff
                    await new Promise((resolve) =>
                      setTimeout(resolve, attempt * 1000),
                    );
                  } else {
                    throw resumeError;
                  }
                }
              }

              if (!resumed) {
                throw new Error(
                  "Failed to resume instance after maximum attempts",
                );
              }
            } else if (status === "running") {
              await stream.writeSSE({
                data: JSON.stringify({
                  type: "status",
                  message: "Instance is already running",
                }),
              });
            } else {
              await stream.writeSSE({
                data: JSON.stringify({
                  type: "status",
                  message: `Instance is in status: ${status}`,
                }),
              });
            }
          } catch (morphError) {
            const errorMessage =
              morphError instanceof Error
                ? morphError.message
                : "Unknown error";

            if (errorMessage.includes("not found")) {
              await stream.writeSSE({
                data: JSON.stringify({
                  type: "not_found",
                  message: "Instance not found",
                }),
              });
              return;
            }

            await stream.writeSSE({
              data: JSON.stringify({
                type: "error",
                message: `Failed to resume instance: ${errorMessage}`,
              }),
            });
            return;
          }
        }

        // Perform the actual preflight check
        await stream.writeSSE({
          data: JSON.stringify({
            type: "status",
            message: "Checking iframe availability...",
          }),
        });

        const probe = async (method: "HEAD" | "GET") => {
          const response = await fetch(target, {
            method,
            redirect: "manual",
          });
          await response.body?.cancel().catch(() => undefined);
          return response;
        };

        const headResponse = await probe("HEAD");

        if (headResponse.ok) {
          await stream.writeSSE({
            data: JSON.stringify({
              type: "ready",
              message: "Iframe is ready",
            }),
          });
          return;
        }

        if (headResponse.status === 405) {
          const getResponse = await probe("GET");
          if (getResponse.ok) {
            await stream.writeSSE({
              data: JSON.stringify({
                type: "ready",
                message: "Iframe is ready",
              }),
            });
            return;
          }

          await stream.writeSSE({
            data: JSON.stringify({
              type: "error",
              message: `Request failed with status ${getResponse.status}`,
            }),
          });
          return;
        }

        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            message: `Request failed with status ${headResponse.status}`,
          }),
        });
      } catch (error) {
        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : "Unknown error during preflight",
          }),
        });
      }
    });
  },
);
