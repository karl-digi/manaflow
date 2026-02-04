import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { env } from "@/lib/utils/www-env";
import { api } from "@cmux/convex/api";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";
import { getConvex } from "../utils/get-convex";
import { githubPrivateKey } from "../utils/githubPrivateKey";

export const githubCompareRouter = new OpenAPIHono();

const Query = z
  .object({
    team: z.string().min(1).openapi({ description: "Team slug or UUID" }),
    owner: z.string().min(1).openapi({ description: "GitHub owner/org" }),
    repo: z.string().min(1).openapi({ description: "GitHub repo name" }),
    base: z.string().min(1).openapi({ description: "Base branch/ref to compare from" }),
    head: z.string().min(1).openapi({ description: "Head branch/ref to compare to" }),
    includeContents: z.coerce
      .boolean()
      .optional()
      .default(true)
      .openapi({ description: "If true, include file contents (default true)" }),
    maxFileBytes: z.coerce
      .number()
      .min(1)
      .max(5_000_000)
      .optional()
      .default(1_000_000)
      .openapi({
        description: "Skip fetching contents when file size exceeds this (default 1MB)",
      }),
    maxFiles: z.coerce
      .number()
      .min(1)
      .max(3000)
      .optional()
      .default(300)
      .openapi({
        description: "Max files to include (default 300)",
      }),
  })
  .openapi("GithubCompareQuery");

const DiffEntry = z
  .object({
    filePath: z.string(),
    oldPath: z.string().optional(),
    status: z.enum(["added", "modified", "deleted", "renamed", "copied"]),
    additions: z.number(),
    deletions: z.number(),
    isBinary: z.boolean(),
    contentOmitted: z.boolean().optional(),
    patch: z.string().optional(),
    oldContent: z.string().optional(),
    newContent: z.string().optional(),
  })
  .openapi("GithubCompareDiffEntry");

const CompareResponse = z
  .object({
    repoFullName: z.string(),
    base: z.object({ ref: z.string(), sha: z.string() }),
    head: z.object({ ref: z.string(), sha: z.string() }),
    diffs: z.array(DiffEntry),
    totalFiles: z.number(),
    truncated: z.boolean(),
  })
  .openapi("GithubCompareResponse");

githubCompareRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/integrations/github/compare",
    tags: ["Integrations"],
    summary: "Compare two branches/refs and return diffs with optional file contents",
    request: { query: Query },
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: CompareResponse } },
      },
      401: { description: "Unauthorized" },
      404: { description: "Not found" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.text("Unauthorized", 401);

    const {
      team,
      owner,
      repo,
      base,
      head,
      includeContents = true,
      maxFileBytes = 1_000_000,
      maxFiles = 300,
    } = c.req.valid("query");

    const convex = getConvex({ accessToken });
    const connections = await convex.query(api.github.listProviderConnections, {
      teamSlugOrId: team,
    });
    type Conn = {
      installationId: number;
      accountLogin?: string | null;
      isActive?: boolean | null;
    };
    const target = (connections as Conn[]).find(
      (co) =>
        (co.isActive ?? true) &&
        (co.accountLogin ?? "").toLowerCase() === owner.toLowerCase()
    );
    if (!target) return c.text("Installation not found for owner", 404);

    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: env.CMUX_GITHUB_APP_ID,
        privateKey: githubPrivateKey,
        installationId: target.installationId,
      },
    });

    // Use GitHub's compare API
    const compareRes = await octokit.request(
      "GET /repos/{owner}/{repo}/compare/{basehead}",
      {
        owner,
        repo,
        basehead: `${base}...${head}`,
        per_page: 1, // We only need the comparison metadata initially
      }
    );

    const comparison = compareRes.data;
    const baseSha = comparison.base_commit.sha;
    // The commits array contains all commits between base and head
    // The last commit is the head commit
    const commits = comparison.commits ?? [];
    const headSha = commits.length > 0
      ? commits[commits.length - 1].sha
      : comparison.merge_base_commit.sha;

    // Fetch files with pagination (compare API returns up to 300 files per page)
    type CompareFile = {
      filename: string;
      status: string;
      sha?: string | null;
      additions: number;
      deletions: number;
      changes: number;
      previous_filename?: string;
      patch?: string;
      raw_url?: string;
      blob_url?: string;
      contents_url?: string;
    };

    const files: CompareFile[] = [];
    let page = 1;
    const perPage = 100;

    while (files.length < maxFiles) {
      const filesRes = await octokit.request(
        "GET /repos/{owner}/{repo}/compare/{basehead}",
        {
          owner,
          repo,
          basehead: `${base}...${head}`,
          per_page: perPage,
          page,
        }
      );

      const chunk = (filesRes.data.files ?? []) as CompareFile[];
      files.push(...chunk);

      // If we got fewer files than requested, we've reached the end
      if (chunk.length < perPage) break;
      page++;

      // Safety limit
      if (page > 30) break;
    }

    const truncated = files.length >= maxFiles;
    const filesToProcess = files.slice(0, maxFiles);

    // Convert to ReplaceDiffEntry format
    const diffs: z.infer<typeof DiffEntry>[] = [];

    for (const f of filesToProcess) {
      const status = normalizeStatus(f.status);
      const isBinary = !f.patch && f.changes > 0;

      const entry: z.infer<typeof DiffEntry> = {
        filePath: f.filename,
        oldPath: f.previous_filename,
        status,
        additions: f.additions,
        deletions: f.deletions,
        isBinary,
        patch: f.patch,
      };

      // Fetch file contents if requested and not binary
      if (includeContents && !isBinary) {
        // Fetch head (new) content for non-deleted files
        if (status !== "deleted") {
          try {
            const contentsRes = await octokit.request(
              "GET /repos/{owner}/{repo}/contents/{path}",
              {
                owner,
                repo,
                path: f.filename,
                ref: headSha,
              }
            );
            const contentObj = contentsRes.data as {
              size?: number;
              encoding?: string;
              content?: string;
              type?: string;
            };
            if (
              contentObj.type === "file" &&
              contentObj.encoding === "base64" &&
              typeof contentObj.content === "string" &&
              (contentObj.size === undefined || contentObj.size <= maxFileBytes)
            ) {
              entry.newContent = Buffer.from(contentObj.content, "base64").toString("utf-8");
            } else {
              entry.contentOmitted = true;
            }
          } catch {
            entry.contentOmitted = true;
          }
        }

        // Fetch base (old) content for non-added files
        if (status !== "added") {
          const oldPath = f.previous_filename ?? f.filename;
          try {
            const baseRes = await octokit.request(
              "GET /repos/{owner}/{repo}/contents/{path}",
              {
                owner,
                repo,
                path: oldPath,
                ref: baseSha,
              }
            );
            const baseObj = baseRes.data as {
              size?: number;
              encoding?: string;
              content?: string;
              type?: string;
            };
            if (
              baseObj.type === "file" &&
              baseObj.encoding === "base64" &&
              typeof baseObj.content === "string" &&
              (baseObj.size === undefined || baseObj.size <= maxFileBytes)
            ) {
              entry.oldContent = Buffer.from(baseObj.content, "base64").toString("utf-8");
            } else {
              entry.contentOmitted = true;
            }
          } catch {
            entry.contentOmitted = true;
          }
        }
      }

      diffs.push(entry);
    }

    return c.json({
      repoFullName: `${owner}/${repo}`,
      base: { ref: base, sha: baseSha },
      head: { ref: head, sha: headSha },
      diffs,
      totalFiles: comparison.files?.length ?? files.length,
      truncated,
    });
  }
);

function normalizeStatus(
  status: string
): "added" | "modified" | "deleted" | "renamed" | "copied" {
  switch (status) {
    case "added":
      return "added";
    case "removed":
      return "deleted";
    case "renamed":
      return "renamed";
    case "copied":
      return "copied";
    case "modified":
    case "changed":
    default:
      return "modified";
  }
}
