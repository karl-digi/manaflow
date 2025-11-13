import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { api } from "@cmux/convex/api";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { getConvex } from "../utils/get-convex";

export const githubInstallStateRouter = new OpenAPIHono();

const RequestBody = z
  .object({
    teamSlugOrId: z
      .string()
      .min(1)
      .openapi({ description: "Team slug or UUID" }),
    returnUrl: z
      .string()
      .url()
      .optional()
      .openapi({
        description:
          "Optional URL to redirect to after installation (web flows)",
      }),
  })
  .openapi("GithubInstallStateRequest");

const ResponseBody = z
  .object({
    state: z.string(),
  })
  .openapi("GithubInstallStateResponse");

githubInstallStateRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/integrations/github/install-state",
    tags: ["Integrations"],
    summary: "Generate a signed install state token for GitHub App installation",
    request: {
      body: {
        content: {
          "application/json": {
            schema: RequestBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "OK",
        content: {
          "application/json": {
            schema: ResponseBody,
          },
        },
      },
      401: { description: "Unauthorized" },
      403: { description: "Forbidden" },
      500: { description: "Server error" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const body = c.req.valid("json");

    try {
      const convex = getConvex({ accessToken });
      const result = await convex.mutation(api.github_app.mintInstallState, {
        teamSlugOrId: body.teamSlugOrId,
        ...(body.returnUrl ? { returnUrl: body.returnUrl } : {}),
      });

      return c.json({ state: result.state });
    } catch (error) {
      console.error("[githubInstallState] Failed to mint install state", error);
      const message = error instanceof Error ? error.message : "Unknown error";

      if (message.includes("Forbidden") || message.includes("Unknown team")) {
        return c.text("Forbidden", 403);
      }

      return c.text("Internal server error", 500);
    }
  },
);
