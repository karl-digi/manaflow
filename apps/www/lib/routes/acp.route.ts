import { getConvex } from "@/lib/utils/get-convex";
import { stackServerApp } from "@/lib/utils/stack";
import { api } from "@cmux/convex/api";
import { env } from "@/lib/utils/www-env";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { SignJWT } from "jose";

const acpRouter = new OpenAPIHono();

const ListThreadsResponseSchema = z
  .array(
    z.object({
      _id: z.string(),
      provider: z.string(),
      status: z.string(),
      sessionId: z.string().nullable().optional(),
      title: z.string().nullable().optional(),
      createdAt: z.number(),
      updatedAt: z.number(),
      lastStopReason: z.string().nullable().optional(),
      errorMessage: z.string().nullable().optional(),
    })
  )
  .openapi("ListAcpThreadsResponse");

const CreateThreadRequestSchema = z
  .object({
    teamSlugOrId: z.string().min(1).openapi({ example: "default" }),
    provider: z.string().min(1).openapi({ example: "opencode" }),
    title: z.string().optional().openapi({ example: "New ACP session" }),
  })
  .openapi("CreateAcpThreadRequest");

const CreateThreadResponseSchema = z
  .object({
    threadId: z.string(),
  })
  .openapi("CreateAcpThreadResponse");

const StartThreadRequestSchema = z
  .object({
    teamSlugOrId: z.string().min(1).openapi({ example: "default" }),
    threadId: z.string().min(1).openapi({ example: "thread_123" }),
    workerUrl: z
      .string()
      .optional()
      .openapi({ example: "http://localhost:39377" }),
    prompt: z.string().optional(),
  })
  .openapi("StartAcpThreadRequest");

const StartThreadResponseSchema = z
  .object({
    ok: z.boolean(),
    threadId: z.string(),
  })
  .openapi("StartAcpThreadResponse");

acpRouter.openapi(
  createRoute({
    method: "get",
    path: "/acp",
    tags: ["ACP"],
    summary: "List ACP threads",
    request: {
      query: z.object({
        teamSlugOrId: z.string().optional(),
        limit: z.number().optional(),
      }),
    },
    responses: {
      200: {
        description: "Threads",
        content: {
          "application/json": {
            schema: ListThreadsResponseSchema,
          },
        },
      },
      400: {
        description: "Missing team context",
        content: {
          "application/json": {
            schema: z
              .object({
                code: z.number(),
                message: z.string(),
              })
              .openapi("AcpBadRequestResponse"),
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: z
              .object({
                code: z.number(),
                message: z.string(),
              })
              .openapi("AcpUnauthorizedResponse"),
          },
        },
      },
      500: {
        description: "Failed to load threads",
        content: {
          "application/json": {
            schema: z
              .object({
                code: z.number(),
                message: z.string(),
              })
              .openapi("AcpErrorResponse"),
          },
        },
      },
    },
  }),
  async (c) => {
    const query = c.req.valid("query");
    const teamSlugOrId = query.teamSlugOrId;
    const user = await stackServerApp.getUser({ tokenStore: c.req.raw });

    if (!user) {
      return c.json({ code: 401, message: "Unauthorized" }, 401);
    }

    const authJson = await user.getAuthJson();
    if (!authJson.accessToken) {
      return c.json({ code: 401, message: "Unauthorized" }, 401);
    }

    const convex = getConvex({ accessToken: authJson.accessToken });

    if (!teamSlugOrId) {
      return c.json({ code: 400, message: "Missing team context" }, 400);
    }

    try {
      const threads = await convex.query(api.acp.listThreads, {
        teamSlugOrId,
        limit: query.limit,
      });
      return c.json(threads, 200);
    } catch (error) {
      console.error("Failed to list ACP threads", error);
      return c.json(
        { code: 500, message: "Failed to load ACP threads" },
        500
      );
    }
  }
);

acpRouter.openapi(
  createRoute({
    method: "post",
    path: "/acp/new",
    tags: ["ACP"],
    summary: "Create ACP thread",
    request: {
      body: {
        content: {
          "application/json": {
            schema: CreateThreadRequestSchema,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Thread created",
        content: {
          "application/json": {
            schema: CreateThreadResponseSchema,
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: z
              .object({
                code: z.number(),
                message: z.string(),
              })
              .openapi("AcpNewUnauthorizedResponse"),
          },
        },
      },
      500: {
        description: "Failed to create thread",
        content: {
          "application/json": {
            schema: z
              .object({
                code: z.number(),
                message: z.string(),
              })
              .openapi("AcpNewErrorResponse"),
          },
        },
      },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const user = await stackServerApp.getUser({ tokenStore: c.req.raw });

    if (!user) {
      return c.json({ code: 401, message: "Unauthorized" }, 401);
    }

    const authJson = await user.getAuthJson();
    if (!authJson.accessToken) {
      return c.json({ code: 401, message: "Unauthorized" }, 401);
    }

    const convex = getConvex({ accessToken: authJson.accessToken });

    try {
      const result = await convex.mutation(api.acp.createThread, {
        teamSlugOrId: body.teamSlugOrId,
        provider: body.provider,
        title: body.title,
      });
      return c.json(result, 200);
    } catch (error) {
      console.error("Failed to create ACP thread", error);
      return c.json(
        { code: 500, message: "Failed to create ACP thread" },
        500
      );
    }
  }
);

acpRouter.openapi(
  createRoute({
    method: "post",
    path: "/acp/start",
    tags: ["ACP"],
    summary: "Start ACP session on worker",
    request: {
      body: {
        content: {
          "application/json": {
            schema: StartThreadRequestSchema,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Started",
        content: {
          "application/json": {
            schema: StartThreadResponseSchema,
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: z
              .object({
                code: z.number(),
                message: z.string(),
              })
              .openapi("AcpStartUnauthorizedResponse"),
          },
        },
      },
      500: {
        description: "Failed to start ACP",
        content: {
          "application/json": {
            schema: z
              .object({
                code: z.number(),
                message: z.string(),
              })
              .openapi("AcpStartErrorResponse"),
          },
        },
      },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const user = await stackServerApp.getUser({ tokenStore: c.req.raw });

    if (!user) {
      return c.json({ code: 401, message: "Unauthorized" }, 401);
    }

    const authJson = await user.getAuthJson();
    if (!authJson.accessToken) {
      return c.json({ code: 401, message: "Unauthorized" }, 401);
    }

    const convex = getConvex({ accessToken: authJson.accessToken });
    const team = await convex.query(api.teams.get, {
      teamSlugOrId: body.teamSlugOrId,
    });
    if (!team) {
      return c.json({ code: 500, message: "Team not found" }, 500);
    }
    const teamId = team.uuid;

    const secret = env.CMUX_TASK_RUN_JWT_SECRET;
    const token = await new SignJWT({
      taskRunId: body.threadId,
      teamId,
      userId: user.id,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .sign(new TextEncoder().encode(secret));

    const workerUrl =
      body.workerUrl ||
      `http://localhost:${process.env.CMUX_WORKER_PORT || "39377"}`;
    const workerEndpoint = new URL("/acp/opencode", workerUrl);

    try {
      const response = await fetch(workerEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: body.prompt,
          convexUrl: env.NEXT_PUBLIC_CONVEX_URL,
          token,
        }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "start failed");
        console.error("ACP worker start failed", { status: response.status, errText });
        return c.json({ code: 500, message: "Failed to start ACP worker" }, 500);
      }
    } catch (error) {
      console.error("ACP worker call failed", error);
      return c.json(
        { code: 500, message: "Failed to call ACP worker" },
        500
      );
    }

    return c.json({ ok: true, threadId: body.threadId }, 200);
  }
);

export { acpRouter };
