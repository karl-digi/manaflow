"use node";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { Octokit } from "octokit";
import { generateObject, type LanguageModel } from "ai";
import { ConvexError, v } from "convex/values";
import {
  CrownEvaluationResponseSchema,
  CrownSummarizationResponseSchema,
  type CrownEvaluationCandidate,
  type CrownEvaluationResponse,
  type CrownSummarizationResponse,
  CLOUDFLARE_OPENAI_BASE_URL,
  CLOUDFLARE_ANTHROPIC_BASE_URL,
  CLOUDFLARE_GEMINI_BASE_URL,
  normalizeAnthropicBaseUrl,
} from "@cmux/shared/convex-safe";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  buildCrownEvaluationPrompt,
  parseCrownEvaluationPrompt,
} from "./retryData";
import { fetchInstallationAccessToken } from "../../_shared/githubApp";

const OPENAI_CROWN_MODEL = "gpt-5-mini-2025-08-07";
const ANTHROPIC_CROWN_MODEL = "claude-sonnet-4-5-20250929";
const GEMINI_CROWN_MODEL = "gemini-3-flash-preview";

const CROWN_PROVIDERS = ["gemini", "openai", "anthropic"] as const;
type CrownProvider = (typeof CROWN_PROVIDERS)[number];

// Configuration for retry logic
const MAX_CROWN_EVALUATION_ATTEMPTS = 3;

/**
 * Fetch git diff from GitHub using the GitHub API.
 * Compares baseBranch to headBranch and returns a unified diff string.
 */
async function fetchGitDiffFromGitHub(options: {
  installationId: number;
  repoFullName: string;
  baseBranch: string;
  headBranch: string;
}): Promise<string> {
  const { installationId, repoFullName, baseBranch, headBranch } = options;

  // Get access token for GitHub API
  const accessToken = await fetchInstallationAccessToken(installationId);
  const octokit = new Octokit({
    auth: accessToken,
    userAgent: "cmux-crown-evaluator",
  });

  // Parse owner/repo from fullName
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repo full name: ${repoFullName}`);
  }

  // Compare commits to get diff
  const response = await octokit.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${baseBranch}...${headBranch}`,
    per_page: 100,
  });

  // Build unified diff from files
  const files = response.data.files ?? [];
  if (files.length === 0) {
    return "<no code changes>";
  }

  // Combine patches into a single diff string
  const diffParts: string[] = [];
  for (const file of files) {
    if (file.patch) {
      diffParts.push(`diff --git a/${file.filename} b/${file.filename}`);
      diffParts.push(`--- a/${file.filename}`);
      diffParts.push(`+++ b/${file.filename}`);
      diffParts.push(file.patch);
      diffParts.push(""); // Empty line between files
    } else if (file.status === "added" || file.status === "removed") {
      // Binary files or files without patch
      diffParts.push(`diff --git a/${file.filename} b/${file.filename}`);
      diffParts.push(`[${file.status} file: ${file.filename}]`);
      diffParts.push("");
    }
  }

  return diffParts.join("\n") || "<no code changes>";
}
const MAX_CROWN_SUMMARIZATION_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000; // 1 second base delay, doubles each retry

/**
 * Build PR title from task prompt (inline version for Convex action)
 * @param prompt - The task prompt to use as the base title
 * @param isCrownCompetition - Whether this is a multi-candidate competition (adds [Crown] prefix)
 */
function buildPullRequestTitle(prompt: string, isCrownCompetition = true): string {
  const base = prompt.trim() || "cmux changes";
  const title = isCrownCompetition ? `[Crown] ${base}` : base;
  return title.length > 72 ? `${title.slice(0, 69)}...` : title;
}

/**
 * Build PR body/description from task details (inline version for Convex action)
 */
function buildPullRequestBody({
  summary,
  prompt,
  agentName,
  branch,
  taskId,
  runId,
}: {
  summary?: string;
  prompt: string;
  agentName: string;
  branch: string;
  taskId: string;
  runId: string;
}): string {
  const bodySummary = summary?.trim() || "Summary not available.";
  return `## Crown Winner: ${agentName}

### Task Description
${prompt}

### Summary
${bodySummary}

### Implementation Details
- **Agent**: ${agentName}
- **Task ID**: ${taskId}
- **Run ID**: ${runId}
- **Branch**: ${branch}
- **Created**: ${new Date().toISOString()}`;
}

/**
 * Delays execution for exponential backoff
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CrownEvaluationCandidateValidator = v.object({
  runId: v.optional(v.string()),
  agentName: v.optional(v.string()),
  modelName: v.optional(v.string()),
  gitDiff: v.string(),
  newBranch: v.optional(v.union(v.string(), v.null())),
  index: v.optional(v.number()),
});

async function getUserAnthropicBaseUrl(
  ctx: ActionCtx,
  teamId: string,
  userId: string,
): Promise<string | undefined> {
  const userBaseUrl = await ctx.runQuery(internal.apiKeys.getByEnvVarInternal, {
    teamId,
    userId,
    envVar: "ANTHROPIC_BASE_URL",
  });
  const trimmed = userBaseUrl?.value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function resolveCrownModel(options?: { anthropicBaseUrl?: string }): {
  provider: CrownProvider;
  model: LanguageModel;
} {
  // Note: AIGATEWAY_* accessed via process.env to avoid Convex static analysis
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const google = createGoogleGenerativeAI({
      apiKey: geminiKey,
      baseURL: process.env.AIGATEWAY_GEMINI_BASE_URL || CLOUDFLARE_GEMINI_BASE_URL,
    });
    return { provider: "gemini", model: google(GEMINI_CROWN_MODEL) };
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const openai = createOpenAI({
      apiKey: openaiKey,
      baseURL: process.env.AIGATEWAY_OPENAI_BASE_URL || CLOUDFLARE_OPENAI_BASE_URL,
    });
    return { provider: "openai", model: openai(OPENAI_CROWN_MODEL) };
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const rawAnthropicBaseUrl =
      options?.anthropicBaseUrl ||
      process.env.AIGATEWAY_ANTHROPIC_BASE_URL ||
      CLOUDFLARE_ANTHROPIC_BASE_URL;
    const anthropic = createAnthropic({
      apiKey: anthropicKey,
      baseURL: normalizeAnthropicBaseUrl(rawAnthropicBaseUrl).forAiSdk,
    });
    return {
      provider: "anthropic",
      model: anthropic(ANTHROPIC_CROWN_MODEL),
    };
  }

  throw new ConvexError(
    "Crown evaluation is not configured (missing Gemini, OpenAI, or Anthropic API key)"
  );
}

export async function performCrownEvaluation(
  prompt: string,
  candidates: CrownEvaluationCandidate[],
  options?: { anthropicBaseUrl?: string },
): Promise<CrownEvaluationResponse> {
  const { model, provider } = resolveCrownModel(options);

  const normalizedCandidates = candidates.map((candidate, idx) => {
    const resolvedIndex = candidate.index ?? idx;
    return {
      index: resolvedIndex,
      runId: candidate.runId,
      agentName: candidate.agentName,
      modelName:
        candidate.modelName ??
        candidate.agentName ??
        (candidate.runId ? `run-${candidate.runId}` : undefined) ??
        `candidate-${resolvedIndex}`,
      gitDiff: candidate.gitDiff,
      newBranch: candidate.newBranch ?? null,
    };
  });

  const evaluationData = {
    prompt,
    candidates: normalizedCandidates,
  };

  const evaluationPrompt = `You are evaluating code implementations from different AI models.

Here are the candidates to evaluate:
${JSON.stringify(evaluationData, null, 2)}

NOTE: The git diffs shown contain only actual code changes. Lock files, build artifacts, and other non-essential files have been filtered out.

Analyze these implementations and select the best one based on:
1. Code quality and correctness
2. Completeness of the solution
3. Following best practices
4. Actually having meaningful code changes (if one has no changes, prefer the one with changes)

Respond with a JSON object containing:
- "winner": the index (0-based) of the best implementation
- "reason": a brief explanation of why this implementation was chosen

Example response:
{"winner": 0, "reason": "Model claude/sonnet-4 provided a more complete implementation with better error handling and cleaner code structure."}

IMPORTANT: Respond ONLY with the JSON object, no other text.`;

  // Track errors for diagnostics
  const attemptErrors: Array<{ attempt: number; error: unknown }> = [];

  // Retry loop with exponential backoff
  for (let attempt = 1; attempt <= MAX_CROWN_EVALUATION_ATTEMPTS; attempt++) {
    try {
      console.info(
        `[convex.crown] Evaluation attempt ${attempt}/${MAX_CROWN_EVALUATION_ATTEMPTS} via ${provider}`
      );

      const { object } = await generateObject({
        model,
        schema: CrownEvaluationResponseSchema,
        system:
          "You select the best implementation from structured diff inputs and explain briefly why.",
        prompt: evaluationPrompt,
        maxRetries: 2,
      });

      console.info(`[convex.crown] Evaluation completed via ${provider}`);
      const result = CrownEvaluationResponseSchema.parse(object);

      // If AI returned null winner (e.g., no code changes), default to candidate 0
      // This is different from isFallback=true which indicates AI service failure
      if (result.winner === null && normalizedCandidates.length > 0) {
        console.info(
          `[convex.crown] AI returned null winner, defaulting to candidate 0`
        );
        return {
          ...result,
          winner: 0,
          reason:
            result.reason ||
            "No meaningful code changes detected; selecting first candidate as default.",
        };
      }

      return result;
    } catch (error) {
      attemptErrors.push({ attempt, error });

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[convex.crown] ${provider} evaluation attempt ${attempt}/${MAX_CROWN_EVALUATION_ATTEMPTS} failed:`,
        errorMessage
      );

      // If not the last attempt, wait with exponential backoff before retrying
      if (attempt < MAX_CROWN_EVALUATION_ATTEMPTS) {
        const backoffDelay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.info(
          `[convex.crown] Retrying in ${backoffDelay}ms (attempt ${attempt + 1}/${MAX_CROWN_EVALUATION_ATTEMPTS})`
        );
        await delay(backoffDelay);
      }
    }
  }

  // All retry attempts exhausted - fall back to "no winner" state
  console.warn(
    `[convex.crown] All ${MAX_CROWN_EVALUATION_ATTEMPTS} evaluation attempts failed via ${provider}. Falling back to no-winner state.`,
    {
      provider,
      totalAttempts: MAX_CROWN_EVALUATION_ATTEMPTS,
      errors: attemptErrors.map((e) => ({
        attempt: e.attempt,
        error: e.error instanceof Error ? e.error.message : String(e.error),
      })),
    }
  );

  // Return fallback response with metadata (null winner indicates failure)
  const fallbackReason =
    "Evaluation service unavailable - no winner selected";
  return {
    winner: null,
    reason: fallbackReason,
    isFallback: true,
    evaluationNote: `Crown evaluation failed after ${MAX_CROWN_EVALUATION_ATTEMPTS} attempts (provider: ${provider}). No winner was selected.`,
  };
}

export async function performCrownSummarization(
  prompt: string,
  gitDiff: string,
  options?: { anthropicBaseUrl?: string },
): Promise<CrownSummarizationResponse> {
  const { model, provider } = resolveCrownModel(options);

  const summarizationPrompt = `You are an expert reviewer summarizing a pull request.

GOAL
- Explain succinctly what changed and why.
- Call out areas the user should review carefully.
- Provide a quick test plan to validate the changes.

CONTEXT
- User's original request:
${prompt}
- Relevant diffs (unified):
${gitDiff || "<no code changes captured>"}

INSTRUCTIONS
- Base your summary strictly on the provided diffs and request.
- Be specific about files and functions when possible.
- Prefer clear bullet points over prose. Keep it under ~300 words.
- If there are no code changes, say so explicitly and suggest next steps.

OUTPUT FORMAT (Markdown)
## PR Review Summary
- What Changed: bullet list
- Review Focus: bullet list (risks/edge cases)
- Test Plan: bullet list of practical steps
- Follow-ups: optional bullets if applicable
`;

  const attemptErrors: Array<{ attempt: number; error: unknown }> = [];

  for (let attempt = 1; attempt <= MAX_CROWN_SUMMARIZATION_ATTEMPTS; attempt++) {
    try {
      console.info(
        `[convex.crown] Summarization attempt ${attempt}/${MAX_CROWN_SUMMARIZATION_ATTEMPTS} via ${provider}`
      );

      const { object } = await generateObject({
        model,
        schema: CrownSummarizationResponseSchema,
        system:
          "You are an expert reviewer summarizing pull requests. Provide a clear, concise summary following the requested format.",
        prompt: summarizationPrompt,
        maxRetries: 2,
      });

      console.info(`[convex.crown] Summarization completed via ${provider}`);
      return CrownSummarizationResponseSchema.parse(object);
    } catch (error) {
      attemptErrors.push({ attempt, error });
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[convex.crown] ${provider} summarization attempt ${attempt}/${MAX_CROWN_SUMMARIZATION_ATTEMPTS} failed:`,
        errorMessage
      );

      if (attempt < MAX_CROWN_SUMMARIZATION_ATTEMPTS) {
        const backoffDelay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.info(
          `[convex.crown] Retrying summarization in ${backoffDelay}ms (attempt ${attempt + 1}/${MAX_CROWN_SUMMARIZATION_ATTEMPTS})`
        );
        await delay(backoffDelay);
      }
    }
  }

  const lastError = attemptErrors[attemptErrors.length - 1]?.error;
  const lastMessage =
    lastError instanceof Error ? lastError.message : String(lastError ?? "");
  console.warn(
    `[convex.crown] All ${MAX_CROWN_SUMMARIZATION_ATTEMPTS} summarization attempts failed via ${provider}`,
    {
      provider,
      totalAttempts: MAX_CROWN_SUMMARIZATION_ATTEMPTS,
      lastMessage,
    }
  );

  throw new ConvexError(
    `Summarization failed after ${MAX_CROWN_SUMMARIZATION_ATTEMPTS} attempts (provider: ${provider})`
  );
}

export const evaluate = action({
  args: {
    prompt: v.string(),
    candidates: v.array(CrownEvaluationCandidateValidator),
    teamSlugOrId: v.string(),
    teamId: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const anthropicBaseUrl =
      args.teamId && args.userId
        ? await getUserAnthropicBaseUrl(ctx, args.teamId, args.userId)
        : undefined;
    return performCrownEvaluation(args.prompt, args.candidates, {
      anthropicBaseUrl,
    });
  },
});

export const summarize = action({
  args: {
    prompt: v.string(),
    gitDiff: v.string(),
    teamSlugOrId: v.string(),
    teamId: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const anthropicBaseUrl =
      args.teamId && args.userId
        ? await getUserAnthropicBaseUrl(ctx, args.teamId, args.userId)
        : undefined;
    return performCrownSummarization(args.prompt, args.gitDiff, {
      anthropicBaseUrl,
    });
  },
});

/**
 * Schema for parsing the stored retry data
 */
interface CrownRetryData {
  evaluationPrompt: string;
  candidateRunIds: string[];
  teamId: string;
  userId: string;
}

/**
 * Schema for parsing evaluation prompt to extract candidates
 * Format: "Task: <prompt>\nCandidates: <JSON array>"
 */
/**
 * Internal action to retry a failed crown evaluation.
 * Called after retryCrownEvaluation mutation resets the status.
 */
export const retryEvaluation = internalAction({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    console.log(`[Crown] Starting retry evaluation for task ${args.taskId}`);

    // Get task with retry data
    const task = await ctx.runQuery(internal.tasks.getByIdInternal, {
      id: args.taskId,
    });

    if (!task) {
      throw new Error("Task not found");
    }

    if (!task.crownEvaluationRetryData) {
      await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
        taskId: args.taskId,
        teamId: task.teamId,
        userId: task.userId,
        status: "error",
        errorMessage: "No retry data available for this task",
      });
      throw new Error("No retry data available for this task");
    }

    // Parse retry data
    let retryData: CrownRetryData;
    try {
      retryData = JSON.parse(task.crownEvaluationRetryData);
    } catch (error) {
      await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
        taskId: args.taskId,
        teamId: task.teamId,
        userId: task.userId,
        status: "error",
        errorMessage: "Invalid retry data format",
      });
      throw new Error("Invalid retry data format");
    }

    // Parse the evaluation prompt to extract candidates
    const parsedData = parseCrownEvaluationPrompt(retryData.evaluationPrompt);
    if (!parsedData) {
      // Mark as error if we can't parse the data
      await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
        taskId: args.taskId,
        teamId: retryData.teamId,
        userId: retryData.userId,
        status: "error",
        errorMessage: "Failed to parse stored evaluation data",
      });
      throw new Error("Failed to parse stored evaluation data");
    }

    // Mark as in_progress
    await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
      taskId: args.taskId,
      teamId: retryData.teamId,
      userId: retryData.userId,
      status: "in_progress",
      clearError: true,
    });

    const anthropicBaseUrl = await getUserAnthropicBaseUrl(
      ctx,
      retryData.teamId,
      retryData.userId
    );

    // Prepare candidates for evaluation
    const evaluationCandidates: CrownEvaluationCandidate[] = parsedData.candidates.map(
      (candidate, idx) => ({
        runId: candidate.runId,
        agentName: candidate.agentName,
        modelName: candidate.modelName || candidate.agentName,
        gitDiff: candidate.gitDiff,
        newBranch: candidate.newBranch,
        index: candidate.index ?? idx,
      })
    );

    console.log(`[Crown] Retrying evaluation with ${evaluationCandidates.length} candidates`);

    try {
      // Perform the evaluation
      const evaluationResponse = await performCrownEvaluation(
        parsedData.prompt,
        evaluationCandidates,
        { anthropicBaseUrl }
      );

      console.log(`[Crown] Retry evaluation result:`, {
        winner: evaluationResponse.winner,
        isFallback: evaluationResponse.isFallback,
      });

      // Handle the result
      if (evaluationResponse.winner === null) {
        // Still failing - update error state
        await ctx.runMutation(internal.crown.workerFinalize, {
          taskId: args.taskId,
          teamId: retryData.teamId,
          userId: retryData.userId,
          winnerRunId: null,
          reason: evaluationResponse.reason,
          evaluationPrompt: retryData.evaluationPrompt,
          evaluationResponse: JSON.stringify(evaluationResponse),
          candidateRunIds: retryData.candidateRunIds.map((id) => id as Id<"taskRuns">),
          isFallback: true,
          evaluationNote: evaluationResponse.evaluationNote || "Retry evaluation failed",
        });

        return { success: false, reason: evaluationResponse.reason };
      }

      // Success! Get the winner candidate
      const winnerCandidate = parsedData.candidates[evaluationResponse.winner];
      if (!winnerCandidate) {
        throw new Error(`Winner index ${evaluationResponse.winner} out of bounds`);
      }

      // Generate summary for the winning candidate (atomic: must succeed)
      let summary: string | undefined;
      try {
        console.log(
          `[Crown] Generating summary for retry winner ${winnerCandidate.runId}`
        );
        const summaryResponse = await performCrownSummarization(
          parsedData.prompt,
          winnerCandidate.gitDiff,
          { anthropicBaseUrl }
        );
        summary = summaryResponse?.summary?.slice(0, 8000);
      } catch (summaryError) {
        const message =
          summaryError instanceof Error
            ? summaryError.message
            : String(summaryError);

        console.error(
          "[Crown] Summary generation failed during retry; marking crown as failed",
          { taskId: args.taskId, error: message }
        );

        await ctx.runMutation(internal.crown.workerFinalize, {
          taskId: args.taskId,
          teamId: retryData.teamId,
          userId: retryData.userId,
          winnerRunId: null,
          reason: "Summarization failed",
          evaluationPrompt: retryData.evaluationPrompt,
          evaluationResponse: JSON.stringify(evaluationResponse),
          candidateRunIds: retryData.candidateRunIds.map(
            (id) => id as Id<"taskRuns">
          ),
          isFallback: false,
          evaluationNote: `Summarization failed: ${message}`,
        });

        return { success: false, reason: "Summarization failed" };
      }

      if (!summary || summary.trim().length === 0) {
        await ctx.runMutation(internal.crown.workerFinalize, {
          taskId: args.taskId,
          teamId: retryData.teamId,
          userId: retryData.userId,
          winnerRunId: null,
          reason: "Summarization returned empty output",
          evaluationPrompt: retryData.evaluationPrompt,
          evaluationResponse: JSON.stringify(evaluationResponse),
          candidateRunIds: retryData.candidateRunIds.map(
            (id) => id as Id<"taskRuns">
          ),
          isFallback: false,
          evaluationNote: "Summarization returned empty output",
        });
        return { success: false, reason: "Summarization returned empty output" };
      }

      // Generate PR title and description (for consistency with normal path)
      // Single-run scenarios (1 candidate) should NOT have [Crown] prefix
      const isCrownCompetition = retryData.candidateRunIds.length > 1;
      const pullRequestTitle = buildPullRequestTitle(parsedData.prompt, isCrownCompetition);
      const pullRequestDescription = buildPullRequestBody({
        summary,
        prompt: parsedData.prompt,
        agentName: winnerCandidate.agentName,
        branch: winnerCandidate.newBranch || "",
        taskId: args.taskId,
        runId: winnerCandidate.runId,
      });

      // Finalize with winner (now includes summary and PR metadata)
      await ctx.runMutation(internal.crown.workerFinalize, {
        taskId: args.taskId,
        teamId: retryData.teamId,
        userId: retryData.userId,
        winnerRunId: winnerCandidate.runId as Id<"taskRuns">,
        reason: evaluationResponse.reason,
        evaluationPrompt: retryData.evaluationPrompt,
        evaluationResponse: JSON.stringify(evaluationResponse),
        candidateRunIds: retryData.candidateRunIds.map((id) => id as Id<"taskRuns">),
        isFallback: false,
        summary,
        pullRequestTitle,
        pullRequestDescription,
      });

      // Clear retry data on success
      await ctx.runMutation(internal.tasks.clearCrownRetryData, {
        taskId: args.taskId,
      });

      console.log(`[Crown] Retry evaluation succeeded, winner: ${winnerCandidate.runId}`);
      return { success: true, winnerRunId: winnerCandidate.runId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Crown] Retry evaluation failed", { taskId: args.taskId, error: message });
      await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
        taskId: args.taskId,
        teamId: retryData.teamId,
        userId: retryData.userId,
        status: "error",
        errorMessage: message,
      });
      throw error;
    }
  },
});

/**
 * Fresh retry evaluation when stored retry data is missing.
 * This happens when evaluation failed before storing candidate data.
 *
 * Since git diffs are not stored in the database, this action marks
 * the task for manual intervention - user needs to restart the sandbox
 * workflow to collect fresh diffs.
 */
export const retryEvaluationFresh = internalAction({
  args: {
    taskId: v.id("tasks"),
    teamId: v.string(),
    userId: v.string(),
    taskRunIds: v.array(v.id("taskRuns")),
    /** Whether this is a refresh of a succeeded evaluation (vs retry of error) */
    isRefresh: v.optional(v.boolean()),
    /** Auto-refresh count to preserve across re-evaluations */
    autoRefreshCount: v.optional(v.number()),
    /** Existing evaluation to delete on successful refresh (non-destructive pattern) */
    existingEvaluationId: v.optional(v.id("crownEvaluations")),
    /** Existing winner run to uncrown on successful refresh (non-destructive pattern) */
    existingWinnerRunId: v.optional(v.id("taskRuns")),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ success: boolean; winnerRunId?: string; reason?: string }> => {
    const actionType = args.isRefresh ? "refresh" : "fresh retry";
    console.log(
      `[Crown] ${actionType} evaluation requested for task ${args.taskId}`
    );

    // Mark as in_progress and update timestamp to prevent recovery cron interference
    await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
      taskId: args.taskId,
      teamId: args.teamId,
      userId: args.userId,
      status: "in_progress",
      clearError: true,
    });

    // Get task runs to check their status
    const taskRuns: Array<Doc<"taskRuns"> | null> = await Promise.all(
      args.taskRunIds.map(
        (id): Promise<Doc<"taskRuns"> | null> =>
          ctx.runQuery(internal.taskRuns.getById, { id })
      )
    );

    const validRuns = taskRuns.filter(
      (run): run is Doc<"taskRuns"> =>
        run !== null && run.status === "completed"
    );

    if (validRuns.length === 0) {
      await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
        taskId: args.taskId,
        teamId: args.teamId,
        userId: args.userId,
        status: "error",
        errorMessage: "No completed task runs found for fresh retry.",
      });
      return { success: false, reason: "No completed runs" };
    }

    // Check if any sandbox is still running
    const runningSandboxes = validRuns.filter(
      (run: Doc<"taskRuns">) => run.vscode?.status === "running"
    );

    // For refresh mode, we can try to fetch diffs from GitHub even without running sandboxes
    // For regular retry, we need running sandboxes
    if (runningSandboxes.length === 0 && !args.isRefresh) {
      // No running sandboxes - cannot collect fresh diffs
      await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
        taskId: args.taskId,
        teamId: args.teamId,
        userId: args.userId,
        status: "error",
        errorMessage:
          "Cannot retry: All sandboxes have been stopped. " +
          "Git diffs cannot be collected without a running sandbox. " +
          "Please create a new task to re-run the evaluation.",
      });
      return { success: false, reason: "No running sandboxes" };
    }

    // Get the task for context
    const task = await ctx.runQuery(internal.tasks.getByIdInternal, {
      id: args.taskId,
    });

    if (!task) {
      await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
        taskId: args.taskId,
        teamId: args.teamId,
        userId: args.userId,
        status: "error",
        errorMessage: "Task not found",
      });
      return { success: false, reason: "Task not found" };
    }

    const anthropicBaseUrl = await getUserAnthropicBaseUrl(
      ctx,
      args.teamId,
      args.userId
    );

    // For single run: auto-crown since no comparison needed
    if (validRuns.length === 1) {
      const singleRun: Doc<"taskRuns"> = validRuns[0];
      console.log(
        `[Crown] Single run found, auto-crowning ${singleRun._id}`
      );

      try {
        // Try to fetch git diff from GitHub if we have the required info
        let gitDiff = "<git diff not available>";
        if (task.projectFullName && task.baseBranch && singleRun.newBranch) {
          console.log(
            `[Crown] Attempting to fetch git diff from GitHub for ${task.projectFullName}`
          );
          try {
            // Get installation ID for the repo
            const installationId = await ctx.runQuery(
              internal.github.getRepoInstallationIdInternal,
              {
                teamId: args.teamId,
                repoFullName: task.projectFullName,
              }
            );

            if (installationId) {
              gitDiff = await fetchGitDiffFromGitHub({
                installationId,
                repoFullName: task.projectFullName,
                baseBranch: task.baseBranch,
                headBranch: singleRun.newBranch,
              });
              console.log(
                `[Crown] Successfully fetched git diff from GitHub (${gitDiff.length} chars)`
              );
            } else {
              console.warn(
                `[Crown] No installation ID found for repo ${task.projectFullName}, using placeholder diff`
              );
            }
          } catch (diffError) {
            console.warn(
              "[Crown] Failed to fetch git diff from GitHub, using placeholder",
              diffError instanceof Error ? diffError.message : diffError
            );
          }
        } else {
          console.log(
            "[Crown] Missing projectFullName, baseBranch, or newBranch - cannot fetch diff from GitHub"
          );
        }

        // Generate summary with the git diff (real or placeholder)
        let summary: string | undefined;
        try {
          const summaryResponse = await performCrownSummarization(
            task.text || "Task completion",
            gitDiff,
            { anthropicBaseUrl }
          );
          summary = summaryResponse?.summary?.slice(0, 8000);
        } catch (summaryError) {
          // Match multi-run behavior: if summary fails, fail the whole operation
          // so user can retry to get a proper summary.
          const message =
            summaryError instanceof Error
              ? summaryError.message
              : String(summaryError);
          console.error(
            "[Crown] Summary generation failed for fresh retry - marking as error",
            { taskId: args.taskId, error: message }
          );

          // Non-destructive: restore to succeeded if we have existing evaluation
          if (args.existingEvaluationId) {
            await ctx.runMutation(internal.crown.restoreAfterFailedRefresh, {
              taskId: args.taskId,
              errorMessage: `Summarization failed: ${message}`,
            });
            return { success: false, reason: "Summarization failed (restored)" };
          }

          await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
            taskId: args.taskId,
            teamId: args.teamId,
            userId: args.userId,
            status: "error",
            errorMessage: `Summarization failed: ${message}. Single completed run ready to be crowned on retry.`,
          });

          console.log(
            `[Crown] Fresh retry failed for single run due to summarization error`
          );
          return { success: false, reason: "Summarization failed" };
        }

        // SUCCESS: Clean up old evaluation before creating new one (non-destructive pattern)
        if (args.existingEvaluationId) {
          await ctx.runMutation(internal.crown.cleanupOldEvaluation, {
            existingEvaluationId: args.existingEvaluationId,
            existingWinnerRunId: args.existingWinnerRunId,
          });
        }

        // Finalize with single run as winner
        await ctx.runMutation(internal.crown.workerFinalize, {
          taskId: args.taskId,
          teamId: args.teamId,
          userId: args.userId,
          winnerRunId: singleRun._id,
          reason: "Single completed run - automatically selected as winner.",
          summary,
          evaluationPrompt: `Task: ${task.text || "N/A"}`,
          evaluationResponse: JSON.stringify({
            winner: 0,
            reason: "Single run auto-crowned",
          }),
          candidateRunIds: [singleRun._id],
          isFallback: false,
          evaluationNote:
            "Fresh retry with single run - no comparison evaluation needed.",
          autoRefreshCount: args.autoRefreshCount,
        });

        console.log(
          `[Crown] Fresh retry succeeded with single run: ${singleRun._id}`
        );
        return { success: true, winnerRunId: singleRun._id };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[Crown] Fresh retry failed", { error: message });
        // Non-destructive: restore to succeeded if we have existing evaluation
        if (args.existingEvaluationId) {
          await ctx.runMutation(internal.crown.restoreAfterFailedRefresh, {
            taskId: args.taskId,
            errorMessage: `Fresh retry failed: ${message}`,
          });
          return { success: false, reason: `${message} (restored)` };
        }
        await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
          taskId: args.taskId,
          teamId: args.teamId,
          userId: args.userId,
          status: "error",
          errorMessage: `Fresh retry failed: ${message}`,
        });
        return { success: false, reason: message };
      }
    }

    // Multiple runs - for refresh mode, try to fetch diffs from GitHub
    if (args.isRefresh && task.projectFullName && task.baseBranch) {
      console.log(
        `[Crown] Refresh mode with ${validRuns.length} runs - attempting to fetch diffs from GitHub`
      );

      // Get installation ID for the repo
      const installationId = await ctx.runQuery(
        internal.github.getRepoInstallationIdInternal,
        {
          teamId: args.teamId,
          repoFullName: task.projectFullName,
        }
      );

      if (!installationId) {
        console.warn(
          `[Crown] No installation ID found for repo ${task.projectFullName}`
        );
        // Non-destructive: restore to succeeded if we have existing evaluation
        if (args.existingEvaluationId) {
          await ctx.runMutation(internal.crown.restoreAfterFailedRefresh, {
            taskId: args.taskId,
            errorMessage:
              "Refresh failed: GitHub App not installed for this repository.",
          });
          return { success: false, reason: "No GitHub installation (restored)" };
        }
        await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
          taskId: args.taskId,
          teamId: args.teamId,
          userId: args.userId,
          status: "error",
          errorMessage:
            "Cannot refresh: GitHub App not installed for this repository. " +
            "Please use the 'Crown Winner' button in each sandbox to manually select the best solution.",
        });
        return { success: false, reason: "No GitHub installation" };
      }

      // Fetch diffs for all runs with newBranch
      const candidatesWithDiffs: Array<{
        run: Doc<"taskRuns">;
        gitDiff: string;
      }> = [];

      for (const run of validRuns) {
        if (!run.newBranch) {
          console.log(
            `[Crown] Run ${run._id} has no newBranch - skipping diff fetch`
          );
          candidatesWithDiffs.push({
            run,
            gitDiff: "<no branch available>",
          });
          continue;
        }

        try {
          const gitDiff = await fetchGitDiffFromGitHub({
            installationId,
            repoFullName: task.projectFullName,
            baseBranch: task.baseBranch,
            headBranch: run.newBranch,
          });
          console.log(
            `[Crown] Fetched diff for run ${run._id}: ${gitDiff.length} chars`
          );
          candidatesWithDiffs.push({ run, gitDiff });
        } catch (diffError) {
          console.warn(
            `[Crown] Failed to fetch diff for run ${run._id}:`,
            diffError instanceof Error ? diffError.message : diffError
          );
          candidatesWithDiffs.push({
            run,
            gitDiff: "<git diff not available>",
          });
        }
      }

      // Check if we got any real diffs
      const hasRealDiffs = candidatesWithDiffs.some(
        (c) =>
          c.gitDiff.length > 20 &&
          !c.gitDiff.startsWith("<") &&
          c.gitDiff !== "<no code changes>"
      );

      if (!hasRealDiffs) {
        console.log(
          `[Crown] No real diffs found for any run - marking as error`
        );
        // Non-destructive: restore to succeeded if we have existing evaluation
        if (args.existingEvaluationId) {
          await ctx.runMutation(internal.crown.restoreAfterFailedRefresh, {
            taskId: args.taskId,
            errorMessage:
              "Refresh failed: Could not fetch code diffs from GitHub. " +
              "The branches may have been deleted or merged.",
          });
          return { success: false, reason: "No diffs available (restored)" };
        }
        await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
          taskId: args.taskId,
          teamId: args.teamId,
          userId: args.userId,
          status: "error",
          errorMessage:
            "Refresh failed: Could not fetch code diffs from GitHub. " +
            "The branches may have been deleted or merged. " +
            "Please use the 'Crown Winner' button in each sandbox to manually select the best solution.",
        });
        return { success: false, reason: "No diffs available from GitHub" };
      }

      // Build candidates for crown evaluation
      const candidates = candidatesWithDiffs.map((c, idx) => ({
        runId: c.run._id as string,
        agentName: c.run.agentName || `Agent ${idx + 1}`,
        gitDiff: c.gitDiff,
        newBranch: c.run.newBranch,
        index: idx,
      }));

      // Perform crown evaluation with fresh diffs
      try {
        const result = await performCrownEvaluation(
          task.text || "Task completion",
          candidates,
          { anthropicBaseUrl }
        );

        // winner is just an index number (0-based), not an object
        if (result.winner === null || result.winner === undefined) {
          throw new Error("Evaluation did not select a winner");
        }

        const winnerIndex = result.winner;
        const winnerCandidate = candidates[winnerIndex];
        const winnerRunId = winnerCandidate.runId as Id<"taskRuns">;

        // Generate summary for winner (Fix 5: fail properly if summarization fails)
        let summary: string | undefined;
        try {
          const summaryResponse = await performCrownSummarization(
            task.text || "Task completion",
            winnerCandidate.gitDiff,
            { anthropicBaseUrl }
          );
          summary = summaryResponse?.summary?.slice(0, 8000);
        } catch (summaryError) {
          const summaryMessage =
            summaryError instanceof Error
              ? summaryError.message
              : String(summaryError);
          console.error(
            "[Crown] Summary generation failed during refresh - marking as error",
            { taskId: args.taskId, error: summaryMessage }
          );
          // Non-destructive: restore to succeeded if we have existing evaluation
          if (args.existingEvaluationId) {
            await ctx.runMutation(internal.crown.restoreAfterFailedRefresh, {
              taskId: args.taskId,
              errorMessage: `Summarization failed: ${summaryMessage}`,
            });
            return { success: false, reason: "Summarization failed (restored)" };
          }
          await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
            taskId: args.taskId,
            teamId: args.teamId,
            userId: args.userId,
            status: "error",
            errorMessage: `Summarization failed: ${summaryMessage}`,
          });
          return { success: false, reason: "Summarization failed" };
        }

        if (!summary || summary.trim().length === 0) {
          // Non-destructive: restore to succeeded if we have existing evaluation
          if (args.existingEvaluationId) {
            await ctx.runMutation(internal.crown.restoreAfterFailedRefresh, {
              taskId: args.taskId,
              errorMessage: "Summarization returned empty output",
            });
            return { success: false, reason: "Empty summary (restored)" };
          }
          await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
            taskId: args.taskId,
            teamId: args.teamId,
            userId: args.userId,
            status: "error",
            errorMessage: "Summarization returned empty output",
          });
          return { success: false, reason: "Empty summary" };
        }

        // SUCCESS: Clean up old evaluation before creating new one (non-destructive pattern)
        if (args.existingEvaluationId) {
          await ctx.runMutation(internal.crown.cleanupOldEvaluation, {
            existingEvaluationId: args.existingEvaluationId,
            existingWinnerRunId: args.existingWinnerRunId,
          });
        }

        // Finalize with fresh evaluation results
        await ctx.runMutation(internal.crown.workerFinalize, {
          taskId: args.taskId,
          teamId: args.teamId,
          userId: args.userId,
          winnerRunId,
          reason: result.reason || "Selected by crown evaluation",
          summary,
          evaluationPrompt: buildCrownEvaluationPrompt(
            task.text || "Task completion",
            candidates
          ),
          evaluationResponse: JSON.stringify(result),
          candidateRunIds: candidates.map((c) => c.runId as Id<"taskRuns">),
          isFallback: false,
          evaluationNote: `Refreshed with fresh GitHub diffs. ${args.autoRefreshCount ? `Auto-refresh attempt ${args.autoRefreshCount}.` : ""}`,
          autoRefreshCount: args.autoRefreshCount,
        });

        console.log(
          `[Crown] Refresh succeeded with winner: ${winnerRunId}`
        );
        return { success: true, winnerRunId };
      } catch (evalError) {
        const message =
          evalError instanceof Error ? evalError.message : String(evalError);
        console.error("[Crown] Refresh evaluation failed", { error: message });
        // Non-destructive: restore to succeeded if we have existing evaluation
        if (args.existingEvaluationId) {
          await ctx.runMutation(internal.crown.restoreAfterFailedRefresh, {
            taskId: args.taskId,
            errorMessage: `Refresh evaluation failed: ${message}`,
          });
          return { success: false, reason: `${message} (restored)` };
        }
        await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
          taskId: args.taskId,
          teamId: args.teamId,
          userId: args.userId,
          status: "error",
          errorMessage: `Refresh evaluation failed: ${message}`,
        });
        return { success: false, reason: message };
      }
    }

    // Multiple runs without refresh mode - cannot perform fair evaluation without git diffs
    // Mark as error with guidance
    await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
      taskId: args.taskId,
      teamId: args.teamId,
      userId: args.userId,
      status: "error",
      errorMessage:
        `Cannot retry with ${validRuns.length} completed runs: ` +
        "Git diffs were not stored from the original evaluation. " +
        "To compare multiple runs, please open each sandbox and use the " +
        "'Crown Winner' button in the UI to manually select the best solution.",
    });

    return {
      success: false,
      reason: "Multiple runs require manual selection without stored diffs",
    };
  },
});
