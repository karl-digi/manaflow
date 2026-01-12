import { stackServerAppJs } from "@/lib/utils/stack";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Octokit } from "octokit";

export const githubBranchesRouter = new OpenAPIHono();

// Schema for branch data
const GithubBranch = z
  .object({
    name: z.string(),
    lastCommitSha: z.string().optional(),
    isDefault: z.boolean().optional(),
  })
  .openapi("GithubBranch");

// --- Default Branch Endpoint (fast - single API call) ---

const DefaultBranchQuery = z
  .object({
    repo: z.string().min(1).openapi({ description: "Repository full name (owner/repo)" }),
  })
  .openapi("GithubDefaultBranchQuery");

const DefaultBranchResponse = z
  .object({
    defaultBranch: z.string().nullable(),
    error: z.string().nullable(),
  })
  .openapi("GithubDefaultBranchResponse");

githubBranchesRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/integrations/github/default-branch",
    tags: ["Integrations"],
    summary: "Get the default branch for a repository (fast - single API call)",
    request: { query: DefaultBranchQuery },
    responses: {
      200: {
        description: "Default branch response",
        content: {
          "application/json": {
            schema: DefaultBranchResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const user = await stackServerAppJs.getUser({ tokenStore: c.req.raw });
    if (!user) {
      return c.text("Unauthorized", 401);
    }

    const { repo } = c.req.valid("query");

    try {
      const githubAccount = await user.getConnectedAccount("github");
      if (!githubAccount) {
        return c.json({ defaultBranch: null, error: "GitHub account not connected" }, 200);
      }

      const { accessToken } = await githubAccount.getAccessToken();
      if (!accessToken || accessToken.trim().length === 0) {
        return c.json({ defaultBranch: null, error: "GitHub access token not found" }, 200);
      }

      const octokit = new Octokit({ auth: accessToken.trim() });
      const [owner, repoName] = repo.split("/");

      const { data } = await octokit.request("GET /repos/{owner}/{repo}", {
        owner: owner!,
        repo: repoName!,
      });

      return c.json({ defaultBranch: data.default_branch, error: null }, 200);
    } catch (error) {
      console.error("[github.branches] Error getting default branch:", error);
      return c.json({
        defaultBranch: null,
        error: error instanceof Error ? error.message : "Failed to get default branch",
      }, 200);
    }
  }
);

// --- Branches List Endpoint (with optional search) ---

const BranchesQuery = z
  .object({
    repo: z.string().min(1).openapi({ description: "Repository full name (owner/repo)" }),
    search: z
      .string()
      .trim()
      .optional()
      .openapi({ description: "Optional search term to filter branches by name" }),
    limit: z.coerce
      .number()
      .min(1)
      .max(100)
      .default(30)
      .optional()
      .openapi({ description: "Max branches to return (default 30, max 100)" }),
    cursor: z
      .string()
      .trim()
      .optional()
      .openapi({ description: "Pagination cursor for fetching the next batch" }),
  })
  .openapi("GithubBranchesQuery");

const BranchesResponse = z
  .object({
    branches: z.array(GithubBranch),
    defaultBranch: z.string().nullable(),
    error: z.string().nullable(),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  })
  .openapi("GithubBranchesResponse");

githubBranchesRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/integrations/github/branches",
    tags: ["Integrations"],
    summary: "List branches for a repository with optional search filter",
    request: { query: BranchesQuery },
    responses: {
      200: {
        description: "Branches list response",
        content: {
          "application/json": {
            schema: BranchesResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const user = await stackServerAppJs.getUser({ tokenStore: c.req.raw });
    if (!user) {
      return c.text("Unauthorized", 401);
    }

    const { repo, search, limit = 30, cursor } = c.req.valid("query");

    try {
      const githubAccount = await user.getConnectedAccount("github");
      if (!githubAccount) {
        return c.json({
          branches: [],
          defaultBranch: null,
          error: "GitHub account not connected",
          nextCursor: null,
          hasMore: false,
        }, 200);
      }

      const { accessToken } = await githubAccount.getAccessToken();
      if (!accessToken || accessToken.trim().length === 0) {
        return c.json({
          branches: [],
          defaultBranch: null,
          error: "GitHub access token not found",
          nextCursor: null,
          hasMore: false,
        }, 200);
      }

      const octokit = new Octokit({ auth: accessToken.trim() });
      const [owner, repoName] = repo.split("/");
      if (!owner || !repoName) {
        return c.json({
          branches: [],
          defaultBranch: null,
          error: "Invalid repository name",
          nextCursor: null,
          hasMore: false,
        }, 200);
      }

      type BranchEdge = {
        cursor: string;
        node: {
          name: string;
          target: { oid?: string | null } | null;
        };
      };

      type BranchQueryResponse = {
        repository: {
          defaultBranchRef: { name: string } | null;
          refs: {
            edges: BranchEdge[];
            pageInfo: { endCursor: string | null; hasNextPage: boolean };
          };
        } | null;
      };

      const branches: Array<z.infer<typeof GithubBranch>> = [];
      const searchTerm = search?.trim() ?? "";
      const searchLower = searchTerm ? searchTerm.toLowerCase() : "";
      const perPage = Math.min(100, Math.max(30, limit));

      let nextCursor: string | null = null;
      let hasMore = false;
      let afterCursor: string | null = cursor ?? null;
      let defaultBranchName: string | null = null;

      const branchQuery = `
        query($owner: String!, $repo: String!, $after: String, $first: Int!) {
          repository(owner: $owner, name: $repo) {
            defaultBranchRef {
              name
            }
            refs(
              refPrefix: "refs/heads/"
              first: $first
              after: $after
              orderBy: { field: TAG_COMMIT_DATE, direction: DESC }
            ) {
              edges {
                cursor
                node {
                  name
                  target {
                    ... on Commit {
                      oid
                    }
                  }
                }
              }
              pageInfo {
                endCursor
                hasNextPage
              }
            }
          }
        }
      `;

      while (branches.length < limit) {
        const response = await octokit.graphql<BranchQueryResponse>(branchQuery, {
          owner,
          repo: repoName,
          after: afterCursor ?? undefined,
          first: perPage,
        });

        const repository = response.repository;
        if (!repository) {
          break;
        }

        if (defaultBranchName === null) {
          defaultBranchName = repository.defaultBranchRef?.name ?? null;
        }

        const edges = repository.refs.edges ?? [];
        if (edges.length === 0) {
          hasMore = false;
          nextCursor = null;
          break;
        }

        for (let index = 0; index < edges.length; index += 1) {
          const edge = edges[index];
          const branchName = edge.node.name;
          if (searchLower && !branchName.toLowerCase().includes(searchLower)) {
            continue;
          }

          branches.push({
            name: branchName,
            lastCommitSha: edge.node.target?.oid ?? undefined,
            isDefault: branchName === defaultBranchName,
          });

          if (branches.length >= limit) {
            const isLastEdge = index === edges.length - 1;
            hasMore = !isLastEdge || repository.refs.pageInfo.hasNextPage;
            nextCursor = edge.cursor ?? null;
            break;
          }
        }

        if (branches.length >= limit) {
          break;
        }

        if (!repository.refs.pageInfo.hasNextPage) {
          hasMore = false;
          nextCursor = null;
          break;
        }

        afterCursor = repository.refs.pageInfo.endCursor;
        if (!afterCursor) {
          hasMore = false;
          nextCursor = null;
          break;
        }

        hasMore = true;
        nextCursor = afterCursor;
      }

      return c.json({
        branches,
        defaultBranch: defaultBranchName,
        error: null,
        nextCursor,
        hasMore,
      }, 200);
    } catch (error) {
      console.error("[github.branches] Error fetching branches:", error);
      return c.json({
        branches: [],
        defaultBranch: null,
        error: error instanceof Error ? error.message : "Failed to fetch branches",
        nextCursor: null,
        hasMore: false,
      }, 200);
    }
  }
);
