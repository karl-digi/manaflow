import { stackServerAppJs } from "@/lib/utils/stack";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Octokit } from "octokit";

export const githubBranchesRouter = new OpenAPIHono();

// Schema for branch data
const GithubBranch = z
  .object({
    name: z.string(),
    lastCommitSha: z.string().optional(),
    lastCommitDate: z.string().optional().openapi({ description: "ISO 8601 date of the last commit on this branch" }),
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
      .openapi({ description: "Max branches to return per page (default 30, max 100)" }),
    page: z.coerce
      .number()
      .min(1)
      .default(1)
      .optional()
      .openapi({ description: "1-based page index for pagination (default 1)" }),
  })
  .openapi("GithubBranchesQuery");

const BranchesResponse = z
  .object({
    branches: z.array(GithubBranch),
    defaultBranch: z.string().nullable(),
    error: z.string().nullable(),
  })
  .openapi("GithubBranchesResponse");

// GraphQL query to fetch branches with commit dates for sorting
const BRANCHES_QUERY = `
  query($owner: String!, $repo: String!, $first: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      defaultBranchRef {
        name
      }
      refs(refPrefix: "refs/heads/", first: $first, after: $after, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          name
          target {
            ... on Commit {
              oid
              committedDate
            }
          }
        }
      }
    }
  }
`;

type GraphQLBranchNode = {
  name: string;
  target: {
    oid: string;
    committedDate: string;
  } | null;
};

type GraphQLBranchesResponse = {
  repository: {
    defaultBranchRef: {
      name: string;
    } | null;
    refs: {
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      nodes: GraphQLBranchNode[];
    };
  };
};

githubBranchesRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/integrations/github/branches",
    tags: ["Integrations"],
    summary: "List branches for a repository with optional search filter, sorted by most recent commit",
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

    const { repo, search, limit = 30, page = 1 } = c.req.valid("query");

    try {
      const githubAccount = await user.getConnectedAccount("github");
      if (!githubAccount) {
        return c.json({ branches: [], defaultBranch: null, error: "GitHub account not connected" }, 200);
      }

      const { accessToken } = await githubAccount.getAccessToken();
      if (!accessToken || accessToken.trim().length === 0) {
        return c.json({ branches: [], defaultBranch: null, error: "GitHub access token not found" }, 200);
      }

      const octokit = new Octokit({ auth: accessToken.trim() });
      const [owner, repoName] = repo.split("/");

      if (!owner || !repoName) {
        return c.json({ branches: [], defaultBranch: null, error: "Invalid repository format" }, 200);
      }

      const branches: Array<z.infer<typeof GithubBranch>> = [];
      let defaultBranchName: string | null = null;

      if (!search) {
        // Use GraphQL to fetch branches sorted by commit date
        // For pagination, we need to skip (page-1) * limit items
        // GraphQL doesn't support offset, so we fetch all pages up to the requested one
        const itemsToSkip = (page - 1) * limit;
        const itemsToFetch = itemsToSkip + limit;

        let cursor: string | null = null;
        let fetchedCount = 0;
        const allBranches: Array<z.infer<typeof GithubBranch>> = [];

        while (fetchedCount < itemsToFetch) {
          const batchSize = Math.min(100, itemsToFetch - fetchedCount);
          const result: GraphQLBranchesResponse = await octokit.graphql<GraphQLBranchesResponse>(BRANCHES_QUERY, {
            owner,
            repo: repoName,
            first: batchSize,
            after: cursor,
          });

          if (!defaultBranchName && result.repository.defaultBranchRef) {
            defaultBranchName = result.repository.defaultBranchRef.name;
          }

          const nodes = result.repository.refs.nodes;
          for (const node of nodes) {
            allBranches.push({
              name: node.name,
              lastCommitSha: node.target?.oid,
              lastCommitDate: node.target?.committedDate,
              isDefault: node.name === defaultBranchName,
            });
          }

          fetchedCount += nodes.length;

          if (!result.repository.refs.pageInfo.hasNextPage) {
            break;
          }
          cursor = result.repository.refs.pageInfo.endCursor;
        }

        // Return only the branches for the requested page
        branches.push(...allBranches.slice(itemsToSkip, itemsToSkip + limit));
      } else {
        // With search - fetch pages until we find enough matches for the requested page
        const searchLower = search.toLowerCase();
        const itemsToSkip = (page - 1) * limit;
        const matchedBranches: Array<z.infer<typeof GithubBranch>> = [];
        let cursor: string | null = null;
        let hasMore = true;

        while (matchedBranches.length < itemsToSkip + limit && hasMore) {
          const result: GraphQLBranchesResponse = await octokit.graphql<GraphQLBranchesResponse>(BRANCHES_QUERY, {
            owner,
            repo: repoName,
            first: 100,
            after: cursor,
          });

          if (!defaultBranchName && result.repository.defaultBranchRef) {
            defaultBranchName = result.repository.defaultBranchRef.name;
          }

          for (const node of result.repository.refs.nodes) {
            if (node.name.toLowerCase().includes(searchLower)) {
              matchedBranches.push({
                name: node.name,
                lastCommitSha: node.target?.oid,
                lastCommitDate: node.target?.committedDate,
                isDefault: node.name === defaultBranchName,
              });
            }
          }

          hasMore = result.repository.refs.pageInfo.hasNextPage;
          cursor = result.repository.refs.pageInfo.endCursor;
        }

        // Return only the branches for the requested page
        branches.push(...matchedBranches.slice(itemsToSkip, itemsToSkip + limit));
      }

      return c.json({ branches, defaultBranch: defaultBranchName, error: null }, 200);
    } catch (error) {
      console.error("[github.branches] Error fetching branches:", error);
      return c.json({
        branches: [],
        defaultBranch: null,
        error: error instanceof Error ? error.message : "Failed to fetch branches",
      }, 200);
    }
  }
);
