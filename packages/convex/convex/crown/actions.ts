"use node";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, type LanguageModel } from "ai";
import { ConvexError, v } from "convex/values";
import {
  CROWN_HARNESS_OPTIONS_BY_ID,
  DEFAULT_CROWN_HARNESS_ID,
  DEFAULT_CROWN_SYSTEM_PROMPT,
  getDefaultModelForHarness,
  type CrownHarnessId,
  type CrownHarnessOption,
} from "../../../shared/src/crown/config";
import {
  CrownEvaluationResponseSchema,
  CrownSummarizationResponseSchema,
  type CrownEvaluationCandidate,
  type CrownEvaluationResponse,
  type CrownSummarizationResponse,
} from "../../../shared/src/convex-safe";
import { api } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { env } from "../../_shared/convex-env";
import { action } from "../_generated/server";

const CrownEvaluationCandidateValidator = v.object({
  runId: v.optional(v.string()),
  agentName: v.optional(v.string()),
  modelName: v.optional(v.string()),
  gitDiff: v.string(),
  newBranch: v.optional(v.union(v.string(), v.null())),
  index: v.optional(v.number()),
});

export async function performCrownEvaluation(
  model: LanguageModel,
  systemPrompt: string,
  prompt: string,
  candidates: CrownEvaluationCandidate[],
): Promise<CrownEvaluationResponse> {
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

  try {
    const { object } = await generateObject({
      model,
      schema: CrownEvaluationResponseSchema,
      system: systemPrompt,
      prompt: evaluationPrompt,
      temperature: 0,
      maxRetries: 2,
    });

    return CrownEvaluationResponseSchema.parse(object);
  } catch (error) {
    console.error("[convex.crown] Evaluation error", error);
    throw new ConvexError("Evaluation failed");
  }
}

export async function performCrownSummarization(
  model: LanguageModel,
  prompt: string,
  gitDiff: string,
): Promise<CrownSummarizationResponse> {
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
      model,
      schema: CrownSummarizationResponseSchema,
      system:
        "You are an expert reviewer summarizing pull requests. Provide a clear, concise summary following the requested format.",
      prompt: anthropicPrompt,
      temperature: 0,
      maxRetries: 2,
    });

    return CrownSummarizationResponseSchema.parse(object);
  } catch (error) {
    console.error("[convex.crown] Summarization error", error);
    throw new ConvexError("Summarization failed");
  }
}

export const evaluate = action({
  args: {
    prompt: v.string(),
    candidates: v.array(CrownEvaluationCandidateValidator),
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    let settings: Doc<"workspaceSettings"> | null = null;
    let apiKeys: Record<string, string> = {};

    try {
      settings = await ctx.runQuery(api.workspaceSettings.get, {
        teamSlugOrId: args.teamSlugOrId,
      });
    } catch (error) {
      console.warn("[convex.crown] Failed to load workspace settings", error);
    }

    try {
      apiKeys = await ctx.runQuery(api.apiKeys.getAllForAgents, {
        teamSlugOrId: args.teamSlugOrId,
      });
    } catch (error) {
      console.warn("[convex.crown] Failed to load API keys for crown", error);
      apiKeys = {};
    }

    const { model, systemPrompt } = resolveCrownInferenceConfig(
      settings,
      apiKeys,
    );

    return performCrownEvaluation(
      model,
      systemPrompt,
      args.prompt,
      args.candidates,
    );
  },
});

export const summarize = action({
  args: {
    prompt: v.string(),
    gitDiff: v.string(),
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    let settings: Doc<"workspaceSettings"> | null = null;
    let apiKeys: Record<string, string> = {};

    try {
      settings = await ctx.runQuery(api.workspaceSettings.get, {
        teamSlugOrId: args.teamSlugOrId,
      });
    } catch (error) {
      console.warn("[convex.crown] Failed to load workspace settings", error);
    }

    try {
      apiKeys = await ctx.runQuery(api.apiKeys.getAllForAgents, {
        teamSlugOrId: args.teamSlugOrId,
      });
    } catch (error) {
      console.warn("[convex.crown] Failed to load API keys for crown", error);
      apiKeys = {};
    }

    const { model } = resolveCrownInferenceConfig(settings, apiKeys);

    return performCrownSummarization(model, args.prompt, args.gitDiff);
  },
});

type WorkspaceSettingsDoc =
  | (Doc<"workspaceSettings"> & {
      crownHarness?: string | null;
      crownModel?: string | null;
      crownSystemPrompt?: string | null;
    })
  | null;

function sanitizeSystemPrompt(value?: string | null): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_CROWN_SYSTEM_PROMPT;
}

function isKnownHarnessId(value?: string | null): value is CrownHarnessId {
  if (!value) return false;
  return value in CROWN_HARNESS_OPTIONS_BY_ID;
}

function createLanguageModelForHarness(
  option: CrownHarnessOption,
  modelId: string,
  apiKeys: Record<string, string>,
): LanguageModel | null {
  const trimmedModelId = modelId.trim();
  if (!trimmedModelId) return null;

  const resolvedKey = option.usesCmuxKey
    ? env.ANTHROPIC_API_KEY
    : option.requiresApiKey
    ? apiKeys[option.requiresApiKey]?.trim()
    : undefined;

  try {
    switch (option.provider) {
      case "anthropic": {
        const apiKey = resolvedKey ?? apiKeys.ANTHROPIC_API_KEY?.trim();
        if (!apiKey) return null;
        const anthropic = createAnthropic({ apiKey });
        return anthropic(trimmedModelId);
      }
      case "openai": {
        const apiKey = resolvedKey ?? apiKeys.OPENAI_API_KEY?.trim();
        if (!apiKey) return null;
        const openai = createOpenAI({ apiKey });
        return openai(trimmedModelId);
      }
      case "gemini": {
        const apiKey = resolvedKey ?? apiKeys.GEMINI_API_KEY?.trim();
        if (!apiKey) return null;
        const google = createGoogleGenerativeAI({ apiKey });
        return google(trimmedModelId);
      }
      default:
        return null;
    }
  } catch (error) {
    console.error(
      "[convex.crown] Failed to initialize harness",
      {
        harnessId: option.id,
        modelId: trimmedModelId,
        error,
      },
    );
    return null;
  }
}

function resolveCrownInferenceConfig(
  settings: WorkspaceSettingsDoc,
  apiKeys: Record<string, string>,
): {
  model: LanguageModel;
  harnessId: CrownHarnessId;
  modelId: string;
  systemPrompt: string;
} {
  const requestedHarnessId = isKnownHarnessId(settings?.crownHarness)
    ? (settings?.crownHarness as CrownHarnessId)
    : DEFAULT_CROWN_HARNESS_ID;

  const harnessCandidates: CrownHarnessId[] = [requestedHarnessId];
  if (!harnessCandidates.includes(DEFAULT_CROWN_HARNESS_ID)) {
    harnessCandidates.push(DEFAULT_CROWN_HARNESS_ID);
  }

  const rawModelId =
    typeof settings?.crownModel === "string"
      ? settings.crownModel.trim()
      : undefined;
  const systemPrompt = sanitizeSystemPrompt(settings?.crownSystemPrompt);

  for (const harnessId of harnessCandidates) {
    const option = CROWN_HARNESS_OPTIONS_BY_ID[harnessId];
    if (!option) continue;

    if (option.requiresApiKey) {
      const hasKey = Boolean(apiKeys[option.requiresApiKey]?.trim());
      if (!hasKey) {
        if (harnessId === requestedHarnessId) {
          console.warn(
            "[convex.crown] Required API key missing for selected harness",
            {
              harnessId,
              requiredKey: option.requiresApiKey,
            },
          );
        }
        continue;
      }
    }

    const effectiveModelId = option.models.some((model) => model.id === rawModelId)
      ? (rawModelId as string)
      : getDefaultModelForHarness(harnessId);

    const languageModel = createLanguageModelForHarness(
      option,
      effectiveModelId,
      apiKeys,
    );

    if (languageModel) {
      return {
        model: languageModel,
        harnessId,
        modelId: effectiveModelId,
        systemPrompt,
      };
    }
  }

  const fallbackOption = CROWN_HARNESS_OPTIONS_BY_ID[DEFAULT_CROWN_HARNESS_ID];
  const fallbackModelId = getDefaultModelForHarness(DEFAULT_CROWN_HARNESS_ID);
  const fallbackModel = createLanguageModelForHarness(
    fallbackOption,
    fallbackModelId,
    apiKeys,
  );

  if (!fallbackModel) {
    throw new ConvexError("No harness available for crown evaluation");
  }

  return {
    model: fallbackModel,
    harnessId: DEFAULT_CROWN_HARNESS_ID,
    modelId: fallbackModelId,
    systemPrompt,
  };
}
