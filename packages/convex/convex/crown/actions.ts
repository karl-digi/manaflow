"use node";

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { ConvexError, v } from "convex/values";
import {
  CrownEvaluationResponseSchema,
  CrownSummarizationResponseSchema,
  type CrownEvaluationCandidate,
  type CrownEvaluationResponse,
  type CrownSummarizationResponse,
} from "../../../shared/src/convex-safe";
import {
  DEFAULT_CROWN_HARNESS_ID,
  DEFAULT_CROWN_MODEL_ID,
  DEFAULT_CROWN_SYSTEM_PROMPT,
  getCrownHarnessOption,
  getCrownModelOption,
  type CrownHarnessId,
  type CrownModelOption,
} from "../../../shared/src/crown/config";
import { env } from "../../_shared/convex-env";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { action } from "../_generated/server";

const CrownEvaluationCandidateValidator = v.object({
  runId: v.optional(v.string()),
  agentName: v.optional(v.string()),
  modelName: v.optional(v.string()),
  gitDiff: v.string(),
  newBranch: v.optional(v.union(v.string(), v.null())),
  index: v.optional(v.number()),
});

type ApiKeyMap = Record<string, string>;

type ResolvedCrownRuntimeConfig = {
  apiKey: string;
  model: CrownModelOption;
  harness: CrownHarnessId;
  systemPrompt: string;
  allowCustom: boolean;
};

function mergeApiKeysWithEnv(apiKeys: ApiKeyMap): ApiKeyMap {
  const merged: ApiKeyMap = { ...apiKeys };
  if (!merged.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY) {
    merged.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  }
  return merged;
}

function computeRuntimeConfig(
  settings: Doc<"workspaceSettings"> | null,
  apiKeys: ApiKeyMap,
): ResolvedCrownRuntimeConfig {
  const fallbackModel = getCrownModelOption(DEFAULT_CROWN_MODEL_ID);
  if (!fallbackModel) {
    throw new ConvexError("Default crown model is not available");
  }

  const mergedKeys = mergeApiKeysWithEnv(apiKeys);

  const selectedModel = getCrownModelOption(settings?.crownModel);
  const selectedModelKey =
    selectedModel && apiKeys[selectedModel.envVar]
      ? apiKeys[selectedModel.envVar]
      : undefined;
  const allowCustom = Boolean(selectedModel && selectedModelKey);

  if (selectedModel && !selectedModelKey) {
    console.warn(
      `[convex.crown] No user API key found for selected crown model ${selectedModel.id}; falling back to default.`,
    );
  }

  const model = allowCustom ? (selectedModel as CrownModelOption) : fallbackModel;
  const apiKey = allowCustom
    ? (selectedModelKey as string)
    : mergedKeys[model.envVar];

  if (!apiKey) {
    throw new ConvexError("Missing API key for crown evaluation");
  }

  const harness = allowCustom
    ? getCrownHarnessOption(settings?.crownHarness)?.id ?? DEFAULT_CROWN_HARNESS_ID
    : DEFAULT_CROWN_HARNESS_ID;

  const trimmedPrompt = settings?.crownSystemPrompt?.trim() ?? "";
  const systemPrompt =
    allowCustom && trimmedPrompt
      ? trimmedPrompt
      : DEFAULT_CROWN_SYSTEM_PROMPT;

  return { apiKey, model, harness, systemPrompt, allowCustom };
}

function buildEvaluationPrompt(
  harness: CrownHarnessId,
  taskPrompt: string,
  candidates: Array<{
    index: number;
    runId?: string;
    agentName?: string;
    modelName?: string;
    gitDiff: string;
    newBranch: string | null;
  }>,
): string {
  const serialized = JSON.stringify(
    {
      task: taskPrompt,
      candidates,
    },
    null,
    2,
  );

  if (harness === "scorecard") {
    return `You are evaluating code implementations from multiple AI coding agents.

Your job is to score each candidate on correctness, completeness, and maintainability before choosing a winner.

Context (JSON):
${serialized}

Instructions:
1. Review the task description and diffs for every candidate.
2. Internally score each candidate from 1-5 for correctness, completeness, and maintainability. Use the diff contents to justify the scores.
3. Select the highest-scoring candidate overall. Break ties in favor of safer, clearer changes.
4. Return ONLY a JSON object: {"winner": <index>, "reason": "<concise justification referencing why the winner beats the others>"}.
5. Do not include the score table or any extra commentary.`;
  }

  return `You are evaluating code implementations from different AI models.

Context (JSON):
${serialized}

Consider:
1. Code quality and correctness.
2. Completeness of the solution.
3. Adherence to best practices.
4. Whether the diff contains meaningful changes (prefer substantive improvements over no-op edits).

Respond ONLY with the JSON object {"winner": <index>, "reason": "<concise justification>"} explaining why the winner is superior.`;
}

export async function performCrownEvaluation({
  runtime,
  prompt,
  candidates,
}: {
  runtime: ResolvedCrownRuntimeConfig;
  prompt: string;
  candidates: CrownEvaluationCandidate[];
}): Promise<CrownEvaluationResponse> {
  const anthropic = createAnthropic({ apiKey: runtime.apiKey });

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

  const evaluationPrompt = buildEvaluationPrompt(
    runtime.harness,
    prompt,
    normalizedCandidates,
  );

  try {
    const { object } = await generateObject({
      model: anthropic(runtime.model.model),
      schema: CrownEvaluationResponseSchema,
      system: runtime.systemPrompt,
      prompt: evaluationPrompt,
      temperature: 0,
      maxRetries: 2,
    });

    return CrownEvaluationResponseSchema.parse(object);
  } catch (error) {
    console.error(
      `[convex.crown] Evaluation error (model=${runtime.model.id}, harness=${runtime.harness})`,
      error,
    );
    throw new ConvexError("Evaluation failed");
  }
}

export async function performCrownSummarization({
  runtime,
  prompt,
  gitDiff,
}: {
  runtime: ResolvedCrownRuntimeConfig;
  prompt: string;
  gitDiff: string;
}): Promise<CrownSummarizationResponse> {
  const anthropic = createAnthropic({ apiKey: runtime.apiKey });

  const anthropicPrompt = `You are an expert reviewer summarizing a pull request.

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

  try {
    const { object } = await generateObject({
      model: anthropic(runtime.model.model),
      schema: CrownSummarizationResponseSchema,
      system:
        "You are an expert reviewer summarizing pull requests. Provide a clear, concise summary following the requested format.",
      prompt: anthropicPrompt,
      temperature: 0,
      maxRetries: 2,
    });

    return CrownSummarizationResponseSchema.parse(object);
  } catch (error) {
    console.error(
      `[convex.crown] Summarization error (model=${runtime.model.id})`,
      error,
    );
    throw new ConvexError("Summarization failed");
  }
}

export const evaluate = action({
  args: {
    prompt: v.string(),
    candidates: v.array(CrownEvaluationCandidateValidator),
    teamSlugOrId: v.string(),
    teamId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const [settings, apiKeys] = await Promise.all([
      ctx.runQuery(internal.workspaceSettings.getByTeamAndUserInternal, {
        teamId: args.teamId,
        userId: args.userId,
      }),
      ctx.runQuery(internal.apiKeys.getAllForAgentsInternal, {
        teamId: args.teamId,
        userId: args.userId,
      }),
    ]);

    const runtime = computeRuntimeConfig(settings, apiKeys);

    return performCrownEvaluation({
      runtime,
      prompt: args.prompt,
      candidates: args.candidates,
    });
  },
});

export const summarize = action({
  args: {
    prompt: v.string(),
    gitDiff: v.string(),
    teamSlugOrId: v.string(),
    teamId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const [settings, apiKeys] = await Promise.all([
      ctx.runQuery(internal.workspaceSettings.getByTeamAndUserInternal, {
        teamId: args.teamId,
        userId: args.userId,
      }),
      ctx.runQuery(internal.apiKeys.getAllForAgentsInternal, {
        teamId: args.teamId,
        userId: args.userId,
      }),
    ]);

    const runtime = computeRuntimeConfig(settings, apiKeys);

    return performCrownSummarization({
      runtime,
      prompt: args.prompt,
      gitDiff: args.gitDiff,
    });
  },
});
