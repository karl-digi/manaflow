import { z } from "zod";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../logger";
import { execAsync, WORKSPACE_ROOT } from "./utils";
import { getDefaultBaseBranch } from "./git";
import type {
  CandidateData,
  CrownWorkerCheckResponse,
  PullRequestMetadata,
  WorkerRunContext,
} from "./types";

const MEMORY_DAILY_DIR = "/root/lifecycle/memory/daily";

/**
 * Extract execution summary from agent daily logs.
 * Reads all daily/*.md files and returns the content under "## Execution Summary".
 */
export function extractExecutionSummary(): string | undefined {
  if (!existsSync(MEMORY_DAILY_DIR)) {
    return undefined;
  }

  const files = readdirSync(MEMORY_DAILY_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse(); // newest first

  for (const file of files) {
    const content = readFileSync(join(MEMORY_DAILY_DIR, file), "utf-8");
    const matches = [...content.matchAll(
      /## Execution Summary\n([\s\S]*?)(?=\n## |\n---\s*$|$)/g
    )];
    const lastMatch = matches[matches.length - 1];
    if (lastMatch?.[1]?.trim()) {
      return lastMatch[1].trim();
    }
  }

  return undefined;
}

export function buildPullRequestTitle(prompt: string): string {
  const base = prompt.trim() || "manaflow changes";
  const title = `[Crown] ${base}`;
  return title.length > 72 ? `${title.slice(0, 69)}...` : title;
}

export function buildPullRequestBody({
  summary,
  executionSummary,
  prompt,
  agentName,
  branch,
  taskId,
  runId,
}: {
  summary?: string;
  executionSummary?: string;
  prompt: string;
  agentName: string;
  branch: string;
  taskId: string;
  runId: string;
}): string {
  const bodySummary = summary?.trim() || "Summary not available.";
  const execSummarySection = executionSummary?.trim()
    ? `\n\n### Execution Summary\n${executionSummary.trim()}`
    : "";
  return `## 🏆 Crown Winner: ${agentName}

### Task Description
${prompt}

### Summary
${bodySummary}${execSummarySection}

### Implementation Details
- **Agent**: ${agentName}
- **Task ID**: ${taskId}
- **Run ID**: ${runId}
- **Branch**: ${branch}
- **Created**: ${new Date().toISOString()}`;
}

function mapGhState(
  state: string | undefined
): "none" | "draft" | "open" | "merged" | "closed" | "unknown" {
  if (!state) return "unknown";
  const normalized = state.toLowerCase();
  if (
    normalized === "open" ||
    normalized === "closed" ||
    normalized === "merged"
  ) {
    return normalized;
  }
  return "unknown";
}

const ghPrCreateResponseSchema = z.object({
  url: z.url(),
  number: z
    .union([
      z.number().int(),
      z
        .string()
        .trim()
        .regex(/^[0-9]+$/)
        .transform(Number),
    ])
    .optional(),
  state: z.string().optional(),
  isDraft: z.boolean().optional(),
});

type GhPrCreateResponse = z.infer<typeof ghPrCreateResponseSchema>;

function parseGhPrCreateResponse(input: unknown): GhPrCreateResponse | null {
  const result = ghPrCreateResponseSchema.safeParse(input);
  if (!result.success) {
    return null;
  }
  return result.data;
}

export async function createPullRequest(options: {
  check: CrownWorkerCheckResponse;
  winner: CandidateData;
  summary?: string;
  context: WorkerRunContext;
}): Promise<PullRequestMetadata | null> {
  const { check, winner, summary, context } = options;
  if (!check.task.autoPrEnabled) {
    return null;
  }

  const branch = winner.newBranch;
  if (!branch) {
    log("WARNING", "Skipping PR creation - winner branch missing", {
      taskId: check.taskId,
      runId: winner.runId,
    });
    return null;
  }

  // Auto-detect base branch if not set (for repos using master instead of main)
  const baseBranch = check.task.baseBranch || await getDefaultBaseBranch();
  const prTitle = buildPullRequestTitle(check.task.text);
  const executionSummary = extractExecutionSummary();
  const prBody = buildPullRequestBody({
    summary,
    executionSummary,
    prompt: check.task.text,
    agentName: winner.agentName,
    branch,
    taskId: context.taskId ?? check.taskId,
    runId: winner.runId,
  });

  const script = `set -e
BODY_FILE=$(mktemp /tmp/cmux-pr-XXXXXX.md)
cat <<'CMUX_EOF' > "$BODY_FILE"
${prBody}
CMUX_EOF
gh pr create --base "$PR_BASE" --head "$PR_HEAD" --title "$PR_TITLE" --body-file "$BODY_FILE"
rm -f "$BODY_FILE"
`;

  try {
    const { stdout } = await execAsync(script, {
      cwd: WORKSPACE_ROOT,
      env: {
        ...process.env,
        // Ensure HOME is set for gh CLI to find its config
        HOME: process.env.HOME || "/root",
        PR_TITLE: prTitle,
        PR_BASE: baseBranch,
        PR_HEAD: branch,
      },
      maxBuffer: 5 * 1024 * 1024,
    });

    const trimmed = stdout.trim();
    if (!trimmed) {
      log("ERROR", "gh pr create returned empty output", {
        taskId: check.taskId,
        runId: winner.runId,
      });
      return null;
    }

    // gh pr create outputs just the PR URL on success (e.g., https://github.com/owner/repo/pull/123)
    const prUrlMatch = trimmed.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
    if (!prUrlMatch) {
      log("ERROR", "Failed to parse PR URL from gh pr create output", {
        stdout: trimmed,
      });
      return null;
    }

    const prUrl = prUrlMatch[0];
    const prNumberStr = prUrlMatch[1];
    if (!prNumberStr) {
      log("ERROR", "Failed to extract PR number from URL", {
        stdout: trimmed,
        prUrl,
      });
      return null;
    }
    const prNumber = parseInt(prNumberStr, 10);

    const metadata: PullRequestMetadata = {
      pullRequest: {
        url: prUrl,
        number: prNumber,
        state: "open",
        isDraft: false,
      },
      title: prTitle,
      description: prBody,
    };

    log("INFO", "Created pull request", {
      taskId: check.taskId,
      runId: winner.runId,
      url: prUrl,
    });

    return metadata;
  } catch (error) {
    log("ERROR", "Failed to create pull request", {
      taskId: check.taskId,
      runId: winner.runId,
      error,
    });
    return null;
  }
}
