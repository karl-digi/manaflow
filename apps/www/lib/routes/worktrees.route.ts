import { getAccessTokenFromRequest, getUserFromRequest } from "@/lib/utils/auth";
import { getConvex } from "@/lib/utils/get-convex";
import { api } from "@cmux/convex/api";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

export const worktreesRouter = new OpenAPIHono();

const RemoveWorktreeBody = z
  .object({
    teamSlugOrId: z.string(),
    worktreePath: z.string(),
  })
  .openapi("RemoveWorktreeBody");

const RemoveWorktreeResult = z
  .object({
    success: z.boolean(),
    message: z.string(),
  })
  .openapi("RemoveWorktreeResult");

/**
 * Remove a worktree from the registry.
 * This endpoint provides API access for worktree removal.
 * Note: The primary mechanism for worktree removal is through Convex mutations
 * in the frontend. This endpoint is provided for CLI/API access.
 */
worktreesRouter.openapi(
  createRoute({
    method: "post",
    path: "/worktrees/remove",
    tags: ["Worktrees"],
    summary: "Remove a worktree from the registry",
    description:
      "Removes a worktree entry from the registry. Note: This only removes the registry entry, not the actual filesystem worktree.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: RemoveWorktreeBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Worktree removal result",
        content: {
          "application/json": {
            schema: RemoveWorktreeResult,
          },
        },
      },
      401: {
        description: "Unauthorized",
      },
    },
  }),
  async (c) => {
    const user = await getUserFromRequest(c.req.raw);
    if (!user) {
      return c.json(
        {
          success: false,
          message: "Unauthorized",
        },
        401
      );
    }

    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.json(
        {
          success: false,
          message: "Missing access token",
        },
        401
      );
    }

    const { teamSlugOrId, worktreePath } = c.req.valid("json");

    // Call Convex mutation to remove the worktree from the registry
    const convex = getConvex({ accessToken });
    await convex.mutation(api.worktreeRegistry.remove, {
      teamSlugOrId,
      worktreePath,
    });

    return c.json({
      success: true,
      message: `Worktree ${worktreePath} removed from registry`,
    });
  }
);
