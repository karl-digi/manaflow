import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { getConvex } from "@/lib/utils/get-convex";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { stackServerAppJs } from "@/lib/utils/stack";
import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { Octokit } from "octokit";

export const previewRouter = new OpenAPIHono();

const PreviewConfigSchema = z
  .object({
    id: z.string(),
    repoFullName: z.string(),
    environmentId: z.string().optional().nullable(),
    repoInstallationId: z.number(),
    repoDefaultBranch: z.string().optional().nullable(),
    status: z.enum(["active", "paused", "disabled"]),
    lastRunAt: z.number().optional().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .openapi("PreviewConfig");

const PreviewConfigListResponse = z
  .object({
    configs: z.array(PreviewConfigSchema),
  })
  .openapi("PreviewConfigListResponse");

const PreviewConfigMutationBody = z
  .object({
    previewConfigId: z.string().optional(),
    teamSlugOrId: z.string(),
    repoFullName: z.string(),
    environmentId: z.string().optional(),
    repoInstallationId: z.number(),
    repoDefaultBranch: z.string().optional(),
    status: z.enum(["active", "paused", "disabled"]).optional(),
  })
  .openapi("PreviewConfigMutationBody");

const PreviewRunSchema = z
  .object({
    id: z.string(),
    prNumber: z.number(),
    prUrl: z.string(),
    headSha: z.string(),
    baseSha: z.string().optional().nullable(),
    status: z.enum(["pending", "running", "completed", "failed", "skipped"]),
    createdAt: z.number(),
    updatedAt: z.number(),
    dispatchedAt: z.number().optional().nullable(),
    startedAt: z.number().optional().nullable(),
    completedAt: z.number().optional().nullable(),
  })
  .openapi("PreviewRun");

const PreviewRunsResponse = z
  .object({
    runs: z.array(PreviewRunSchema),
  })
  .openapi("PreviewRunsResponse");

type PreviewConfigDoc = Doc<"previewConfigs">;
type PreviewRunDoc = Doc<"previewRuns">;

function formatPreviewConfig(config: PreviewConfigDoc) {
  return {
    id: config._id,
    repoFullName: config.repoFullName,
    environmentId: config.environmentId ?? null,
    repoInstallationId: config.repoInstallationId,
    repoDefaultBranch: config.repoDefaultBranch ?? null,
    status: config.status ?? "active",
    lastRunAt: config.lastRunAt ?? null,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  } satisfies z.infer<typeof PreviewConfigSchema>;
}

function formatPreviewRun(run: PreviewRunDoc) {
  return {
    id: run._id,
    prNumber: run.prNumber,
    prUrl: run.prUrl,
    headSha: run.headSha,
    baseSha: run.baseSha ?? null,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    dispatchedAt: run.dispatchedAt ?? null,
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
  } satisfies z.infer<typeof PreviewRunSchema>;
}

const ListQuery = z
  .object({
    teamSlugOrId: z.string(),
  })
  .openapi("PreviewConfigsQuery");

previewRouter.openapi(
  createRoute({
    method: "get",
    path: "/preview/configs",
    tags: ["Preview"],
    summary: "List preview configurations for a team",
    request: {
      query: ListQuery,
    },
    responses: {
      200: {
        description: "Configurations fetched",
        content: {
          "application/json": {
            schema: PreviewConfigListResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }
    const query = c.req.valid("query");
    await verifyTeamAccess({ req: c.req.raw, teamSlugOrId: query.teamSlugOrId });
    const convex = getConvex({ accessToken });
    const configs = await convex.query(api.previewConfigs.listByTeam, {
      teamSlugOrId: query.teamSlugOrId,
    });
    return c.json({ configs: configs.map(formatPreviewConfig) });
  },
);

previewRouter.openapi(
  createRoute({
    method: "post",
    path: "/preview/configs",
    tags: ["Preview"],
    summary: "Create or update a preview configuration",
    request: {
      body: {
        content: {
          "application/json": {
            schema: PreviewConfigMutationBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Configuration saved",
        content: {
          "application/json": {
            schema: PreviewConfigSchema,
          },
        },
      },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const body = c.req.valid("json");
    await verifyTeamAccess({ req: c.req.raw, teamSlugOrId: body.teamSlugOrId });
    const convex = getConvex({ accessToken });

    const previewConfigId = await convex.mutation(api.previewConfigs.upsert, {
      teamSlugOrId: body.teamSlugOrId,
      repoFullName: body.repoFullName,
      environmentId: body.environmentId
        ? typedZid("environments").parse(body.environmentId)
        : undefined,
      repoInstallationId: body.repoInstallationId,
      repoDefaultBranch: body.repoDefaultBranch,
      status: body.status,
    });

    const saved = await convex.query(api.previewConfigs.get, {
      teamSlugOrId: body.teamSlugOrId,
      previewConfigId,
    });
    if (!saved) {
      throw new HTTPException(500, { message: "Failed to load saved configuration" });
    }
    return c.json(formatPreviewConfig(saved));
  },
);

previewRouter.openapi(
  createRoute({
    method: "delete",
    path: "/preview/configs/{previewConfigId}",
    tags: ["Preview"],
    summary: "Delete a preview configuration",
    request: {
      params: z.object({ previewConfigId: z.string() }),
      query: z.object({
        teamSlugOrId: z.string(),
      }),
    },
    responses: {
      200: {
        description: "Deleted",
        content: {
          "application/json": {
            schema: z.object({ id: z.string() }),
          },
        },
      },
      401: { description: "Unauthorized" },
      404: { description: "Not found" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    await verifyTeamAccess({ req: c.req.raw, teamSlugOrId: query.teamSlugOrId });
    const convex = getConvex({ accessToken });
    try {
      const result = await convex.mutation(api.previewConfigs.remove, {
        teamSlugOrId: query.teamSlugOrId,
        previewConfigId: typedZid("previewConfigs").parse(params.previewConfigId),
      });
      return c.json(result);
    } catch (error) {
      console.error("Failed to delete preview config", error);
      return c.text("Not found", 404);
    }
  },
);

previewRouter.openapi(
  createRoute({
    method: "get",
    path: "/preview/configs/{previewConfigId}/runs",
    tags: ["Preview"],
    summary: "List recent preview runs for a configuration",
    request: {
      params: z.object({ previewConfigId: z.string() }),
      query: z.object({
        teamSlugOrId: z.string(),
        limit: z.coerce.number().min(1).max(100).optional(),
      }),
    },
    responses: {
      200: {
        description: "Runs fetched",
        content: {
          "application/json": {
            schema: PreviewRunsResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    await verifyTeamAccess({ req: c.req.raw, teamSlugOrId: query.teamSlugOrId });
    const convex = getConvex({ accessToken });
    const runs = await convex.query(api.previewRuns.listByConfig, {
      teamSlugOrId: query.teamSlugOrId,
      previewConfigId: typedZid("previewConfigs").parse(params.previewConfigId),
      limit: query.limit,
    });
    return c.json({ runs: runs.map(formatPreviewRun) });
  },
);

// Test PR creation endpoint
const CreateTestPRBody = z
  .object({
    teamSlugOrId: z.string(),
    previewConfigId: z.string(),
    repoFullName: z.string(),
    baseBranch: z.string().optional(),
  })
  .openapi("CreateTestPRBody");

const CreateTestPRResponse = z
  .object({
    success: z.boolean(),
    prUrl: z.string().optional(),
    prNumber: z.number().optional(),
    error: z.string().optional(),
  })
  .openapi("CreateTestPRResponse");

previewRouter.openapi(
  createRoute({
    method: "post",
    path: "/preview/test-pr",
    tags: ["Preview"],
    summary: "Create a test PR to verify preview configuration",
    request: {
      body: {
        content: {
          "application/json": {
            schema: CreateTestPRBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Test PR created",
        content: {
          "application/json": {
            schema: CreateTestPRResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
      400: { description: "Bad request" },
      500: { description: "Internal server error" },
    },
  }),
  async (c) => {
    const user = await stackServerAppJs.getUser({ tokenStore: c.req.raw });
    if (!user) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }

    const [{ accessToken }, githubAccount] = await Promise.all([
      user.getAuthJson(),
      user.getConnectedAccount("github"),
    ]);

    if (!accessToken) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }

    if (!githubAccount) {
      return c.json(
        { success: false, error: "GitHub account is not connected" },
        401,
      );
    }

    const { accessToken: githubAccessToken } = await githubAccount.getAccessToken();
    if (!githubAccessToken) {
      return c.json(
        { success: false, error: "GitHub access token unavailable" },
        401,
      );
    }

    const body = c.req.valid("json");
    const { teamSlugOrId, repoFullName, baseBranch = "main" } = body;

    await verifyTeamAccess({ req: c.req.raw, teamSlugOrId });

    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) {
      return c.json(
        { success: false, error: "Invalid repository name" },
        400,
      );
    }

    const octokit = new Octokit({
      auth: githubAccessToken,
      request: { timeout: 30_000 },
    });

    try {
      // Get the SHA of the base branch
      const { data: baseBranchData } = await octokit.rest.repos.getBranch({
        owner,
        repo,
        branch: baseBranch,
      });
      const baseSha = baseBranchData.commit.sha;

      // Create a unique branch name
      const timestamp = Date.now();
      const testBranchName = `cmux-test-preview-${timestamp}`;

      // Create the test branch
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${testBranchName}`,
        sha: baseSha,
      });

      // Create a test HTML page in public/ so it's accessible as a page
      const testFileName = "public/cmux-test-preview.html";
      const testFileContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>cmux - AI Code Review for Every PR</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000;
      padding: 20px;
    }
    .container {
      max-width: 600px;
      width: 100%;
      text-align: center;
    }
    .logo {
      font-size: 48px;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.02em;
      margin-bottom: 24px;
    }
    .logo span {
      background: linear-gradient(135deg, #10b981 0%, #34d399 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    h1 {
      font-size: 36px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 16px;
      line-height: 1.2;
    }
    .subtitle {
      font-size: 18px;
      color: #a1a1aa;
      margin-bottom: 40px;
      line-height: 1.6;
    }
    .features {
      display: flex;
      gap: 24px;
      margin-bottom: 40px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .feature {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #d4d4d8;
      font-size: 14px;
    }
    .feature svg {
      width: 20px;
      height: 20px;
      color: #10b981;
    }
    .cta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #fff;
      color: #000;
      font-size: 16px;
      font-weight: 600;
      padding: 16px 32px;
      border-radius: 8px;
      text-decoration: none;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .cta:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 40px rgba(16, 185, 129, 0.3);
    }
    .cta svg {
      width: 20px;
      height: 20px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #10b981;
      font-size: 12px;
      font-weight: 500;
      padding: 6px 12px;
      border-radius: 9999px;
      margin-top: 32px;
    }
    .badge::before {
      content: '';
      width: 6px;
      height: 6px;
      background: #10b981;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">c<span>mux</span></div>
    <h1>AI-Powered Preview Environments for Every Pull Request</h1>
    <p class="subtitle">
      Get instant visual previews and AI code review on every PR.
      Ship faster with confidence.
    </p>
    <div class="features">
      <div class="feature">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Automatic Screenshots
      </div>
      <div class="feature">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        AI Code Review
      </div>
      <div class="feature">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        GitHub Integration
      </div>
    </div>
    <a href="https://cmux.dev" class="cta" target="_blank">
      Try cmux Free
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
      </svg>
    </a>
    <div class="badge">Preview Environment Active</div>
  </div>
</body>
</html>
`;

      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: testFileName,
        message: "test: add cmux preview test page",
        content: Buffer.from(testFileContent).toString("base64"),
        branch: testBranchName,
      });

      // Create the pull request
      const { data: pr } = await octokit.rest.pulls.create({
        owner,
        repo,
        title: "Test cmux Preview Configuration",
        head: testBranchName,
        base: baseBranch,
        body: `## Test Preview Configuration

This PR was automatically created by cmux to test your preview configuration.

### What this PR adds

A test HTML page at \`public/cmux-test-preview.html\` that will be accessible at \`/cmux-test-preview.html\` in your preview environment.

### What to expect

A preview environment will be created for this PR. This typically takes **2-5 minutes**.

Once complete, you'll see a comment on this PR with a screenshot of the test page and a link to the preview environment.

### After testing

- If the preview works correctly, you can close this PR
- The test branch \`${testBranchName}\` will be automatically deleted when the PR is closed

---

*Created by [cmux](https://cmux.sh)*
`,
        draft: false,
      });

      return c.json({
        success: true,
        prUrl: pr.html_url,
        prNumber: pr.number,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to create test PR:", error);
      return c.json(
        { success: false, error: message },
        500,
      );
    }
  },
);
