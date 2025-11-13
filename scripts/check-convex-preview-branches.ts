import { Command } from "commander";
import { spawn } from "node:child_process";

import {
  DEFAULT_BASE_URL,
  fetchPreviewDeployments,
  parseGitHubRepo,
  TokenError,
  type GitHubConfig,
  type PreviewDeploymentRecord,
} from "./lib/convexPreviews.js";

type Options = {
  readonly token?: string;
  readonly baseUrl?: string;
  readonly teamId?: string;
  readonly projectId?: string;
  readonly projectSlug?: string;
  readonly githubRepo?: string;
  readonly githubToken?: string;
  readonly githubBranchPrefix?: string;
  readonly maxPreviewDeployments?: string;
};

type PreviewAnalysis = {
  readonly preview: PreviewDeploymentRecord;
  readonly summary: string;
  readonly blocking: boolean;
  readonly branchName?: string;
  readonly prNumber?: number;
  readonly prState?: string;
};

const program = new Command()
  .name("check-convex-preview-branches")
  .description(
    "Report git state for Convex preview deployments and determine if additional releases are allowed.",
  )
  .option(
    "--token <token>",
    "Management API token. Defaults to CONVEX_MANAGEMENT_TOKEN env var.",
  )
  .option(
    "--base-url <url>",
    "Convex management API base URL.",
    DEFAULT_BASE_URL,
  )
  .option(
    "--team-id <id>",
    "Numeric team ID to scope queries. Auto-detected for team tokens when omitted.",
  )
  .option(
    "--project-id <id>",
    "Numeric project ID to filter results. Defaults to the token's project for project tokens.",
  )
  .option(
    "--project-slug <slug>",
    "Project slug to filter results (team tokens only).",
  )
  .option(
    "--github-repo <owner/repo>",
    "GitHub repository used for branch and PR lookups (required).",
  )
  .option(
    "--github-token <token>",
    "GitHub personal access token. Defaults to GITHUB_TOKEN env var or gh auth token.",
  )
  .option(
    "--github-branch-prefix <prefix>",
    "Prefix to strip from preview identifiers before matching GitHub branch names.",
  )
  .option(
    "--max-preview-deployments <count>",
    "Maximum allowed preview deployments before releases are blocked.",
  );

async function main() {
  program.parse();
  const options = program.opts<Options>();

  const rawToken = options.token ?? process.env.CONVEX_MANAGEMENT_TOKEN ?? "";

  let optionTeamId: number | null = null;
  let optionProjectId: number | null = null;
  let optionMaxPreviewDeployments: number | null = null;
  try {
    optionTeamId = parseIntegerOption("team-id", options.teamId);
    optionProjectId = parseIntegerOption("project-id", options.projectId);
    optionMaxPreviewDeployments = parseIntegerOption(
      "max-preview-deployments",
      options.maxPreviewDeployments,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const optionProjectSlug =
    options.projectSlug === undefined ? null : options.projectSlug;

  const githubRepoInput =
    options.githubRepo ??
    process.env.GITHUB_REPO ??
    process.env.GITHUB_REPOSITORY ??
    null;

  if (!githubRepoInput) {
    console.error(
      "A GitHub repository must be specified via --github-repo or GITHUB_REPO.",
    );
    process.exit(1);
  }

  const githubBranchPrefix = options.githubBranchPrefix ?? "";
  const githubToken =
    options.githubToken ??
    process.env.GITHUB_TOKEN ??
    (await readGhCliTokenOrNull());

  let githubConfig: GitHubConfig;
  try {
    const { owner, repo } = parseGitHubRepo(githubRepoInput);
    githubConfig = {
      owner,
      repo,
      branchPrefix: githubBranchPrefix,
      token: githubToken?.trim()?.length ? githubToken.trim() : null,
      onError: (identifier, error) => {
        console.error(
          `GitHub lookup failed for preview identifier "${identifier}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      },
    };
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  try {
    const previews = await fetchPreviewDeployments({
      token: rawToken,
      baseUrl: options.baseUrl,
      teamId: optionTeamId,
      projectId: optionProjectId,
      projectSlug: optionProjectSlug,
      github: githubConfig,
    });

    if (previews.length === 0) {
      console.log("No preview deployments found for the provided scope.");
      const limitText =
        optionMaxPreviewDeployments === null
          ? ""
          : ` (limit ${optionMaxPreviewDeployments})`;
      console.log(
        `Total preview deployments: 0${limitText}. Remaining capacity is ${
          optionMaxPreviewDeployments ?? "unlimited"
        }.`,
      );
      console.log("Can release more preview deployments? yes");
      return;
    }

    const analyses = previews.map(analyzePreview);
    const blockingAnalyses = analyses.filter((item) => item.blocking);
    const totalCount = previews.length;
    const limit = optionMaxPreviewDeployments;
    const atLimit = limit !== null && totalCount >= limit;
    const capacityRemaining =
      limit === null ? null : Math.max(0, limit - totalCount);
    const canReleaseMore = !atLimit && blockingAnalyses.length === 0;

    const rowsByProject = new Map<number, PreviewAnalysis[]>();
    for (const analysis of analyses) {
      const bucket = rowsByProject.get(analysis.preview.projectId) ?? [];
      bucket.push(analysis);
      rowsByProject.set(analysis.preview.projectId, bucket);
    }

    for (const [projectId, rows] of rowsByProject) {
      const label =
        rows[0]?.preview.projectName &&
        rows[0]?.preview.projectName !== `Project ${projectId}`
          ? `${rows[0]?.preview.projectName} (${
              rows[0]?.preview.projectSlug ?? "slug unavailable"
            })`
          : `Project ${projectId}`;
      console.log(`Preview deployments for ${label}:`);
      for (const row of rows) {
        const identifier =
          row.preview.previewIdentifier ?? "no preview identifier";
        const details = [row.summary, `created ${row.preview.createdAt}`];
        if (row.branchName) {
          details.push(`branch ${row.branchName}`);
        }
        if (row.prNumber !== undefined && row.prState) {
          details.push(`PR #${row.prNumber} ${row.prState}`);
        }
        if (row.blocking) {
          details.push("blocking release");
        }
        console.log(
          `- ${row.preview.deploymentName} (${identifier}) — ${details.join(", ")}`,
        );
      }
    }

    console.log("");
    const limitPhrase =
      limit === null ? "" : ` (limit ${limit}, remaining ${capacityRemaining})`;
    console.log(
      `Total preview deployments: ${totalCount}${limitPhrase}.`,
    );
    if (blockingAnalyses.length > 0) {
      console.log("Blocking deployments:");
      for (const item of blockingAnalyses) {
        console.log(
          `- ${item.preview.deploymentName} (${item.preview.previewIdentifier ?? "no identifier"}) — ${item.summary}`,
        );
      }
    }
    console.log(
      `Can release more preview deployments? ${canReleaseMore ? "yes" : "no"}.`,
    );
    if (!canReleaseMore) {
      if (atLimit) {
        console.log("Reached the maximum allowed preview deployments.");
      }
      if (blockingAnalyses.length > 0) {
        console.log(
          "Resolve or remove blocking deployments before releasing more.",
        );
      }
    }
  } catch (error) {
    if (error instanceof TokenError) {
      console.error(error.message);
      process.exit(1);
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function analyzePreview(preview: PreviewDeploymentRecord): PreviewAnalysis {
  if (preview.previewIdentifier === null) {
    return {
      preview,
      summary: "preview identifier unavailable",
      blocking: false,
    };
  }

  const github = preview.github;
  if (github === null || github === undefined) {
    return {
      preview,
      summary: "GitHub lookup unavailable",
      blocking: false,
    };
  }

  if (!github.branchExists) {
    return {
      preview,
      summary: `branch ${github.branchName} missing`,
      blocking: false,
      branchName: github.branchName,
    };
  }

  const pullRequest = github.pullRequest;
  if (!pullRequest) {
    return {
      preview,
      summary: `branch ${github.branchName} exists without a pull request`,
      blocking: true,
      branchName: github.branchName,
    };
  }

  if (pullRequest.state === "open") {
    return {
      preview,
      summary: `branch ${github.branchName} with open pull request`,
      blocking: true,
      branchName: github.branchName,
      prNumber: pullRequest.number,
      prState: "open",
    };
  }

  if (pullRequest.state === "merged") {
    return {
      preview,
      summary: `branch ${github.branchName} merged at ${pullRequest.mergedAt ?? "unknown time"}`,
      blocking: false,
      branchName: github.branchName,
      prNumber: pullRequest.number,
      prState: "merged",
    };
  }

  return {
    preview,
    summary: `branch ${github.branchName} with closed pull request`,
    blocking: false,
    branchName: github.branchName,
    prNumber: pullRequest.number,
    prState: "closed",
  };
}

function parseIntegerOption(
  optionName: string,
  value?: string,
): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected ${optionName} to be a non-negative integer.`);
  }
  return parsed;
}

async function readGhCliTokenOrNull(): Promise<string | null> {
  return await new Promise((resolve) => {
    const child = spawn("gh", ["auth", "token"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        resolve(null);
      }
    });
  });
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
