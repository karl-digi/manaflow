import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { detectFrameworkAndPackageManager } from "@/lib/github/framework-detection";
import { stackServerApp } from "@/lib/utils/stack";

export const githubFrameworkDetectionRouter = new OpenAPIHono();

const Query = z
  .object({
    repo: z.string().min(1).openapi({ description: "Repository full name (owner/repo)" }),
  })
  .openapi("GithubFrameworkDetectionQuery");

const FrameworkDetectionResponse = z
  .object({
    framework: z.enum(["other", "next", "vite", "remix", "nuxt", "sveltekit", "angular", "cra", "vue"]),
    packageManager: z.enum(["npm", "yarn", "pnpm", "bun"]),
    maintenanceScript: z.string(),
    devScript: z.string(),
  })
  .openapi("FrameworkDetectionResponse");

githubFrameworkDetectionRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/integrations/github/framework-detection",
    tags: ["Integrations"],
    summary: "Detect framework and package manager for a GitHub repository",
    request: { query: Query },
    responses: {
      200: {
        description: "OK",
        content: {
          "application/json": {
            schema: FrameworkDetectionResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
      400: { description: "Bad request" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.text("Unauthorized", 401);

    const { repo } = c.req.valid("query");

    // Get the user's GitHub access token for better rate limits
    let githubAccessToken: string | undefined;
    try {
      const user = await stackServerApp.getUser({ tokenStore: c.req.raw });
      if (user) {
        const githubAccount = await user.getConnectedAccount("github");
        if (githubAccount) {
          const tokenResult = await githubAccount.getAccessToken();
          if (tokenResult.accessToken) {
            githubAccessToken = tokenResult.accessToken;
          }
        }
      }
    } catch (error) {
      console.error("Failed to fetch GitHub access token for framework detection", error);
    }

    const result = await detectFrameworkAndPackageManager(repo, githubAccessToken);

    return c.json(result);
  }
);
