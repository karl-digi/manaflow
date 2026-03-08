import type { AgentConfig, AgentConfigApiKeys } from "../../agentConfig";
import {
  ANTHROPIC_API_KEY,
  OPENAI_API_KEY,
  OPENROUTER_API_KEY,
  XAI_API_KEY,
} from "../../apiKeys";
import {
  checkOpencodeRequirements,
  createOpencodeRequirementsChecker,
} from "./check-requirements";
import { startOpenCodeCompletionDetector } from "./completion-detector";
import { OPENCODE_FREE_MODEL_IDS } from "./free-models";

import {
  getOpencodeEnvironment,
  getOpencodeEnvironmentSkipAuth,
  getOpencodeEnvironmentWithXai,
  OPENCODE_HTTP_HOST,
  OPENCODE_HTTP_PORT,
} from "./environment";

// Common args for all opencode configs - starts HTTP server for prompt submission
const OPENCODE_BASE_ARGS = [
  "--hostname",
  OPENCODE_HTTP_HOST,
  "--port",
  String(OPENCODE_HTTP_PORT),
];

// Free model configs (unchanged - already using factory pattern)
const OPENCODE_FREE_MODEL_CONFIGS: AgentConfig[] = OPENCODE_FREE_MODEL_IDS.map(
  (modelId) => ({
    name: `opencode/${modelId}`,
    command: "opencode",
    args: [...OPENCODE_BASE_ARGS, "--model", `opencode/${modelId}`],
    environment: getOpencodeEnvironmentSkipAuth,
    checkRequirements: createOpencodeRequirementsChecker({
      requireAuth: false,
    }),
    apiKeys: [],
    completionDetector: startOpenCodeCompletionDetector,
  })
);

export { OPENCODE_FREE_MODEL_CONFIGS };

// Factory types for paid models
interface OpencodePaidModelSpec {
  nameSuffix: string;
  modelPath: string;
  environment: AgentConfig["environment"];
  apiKeys: AgentConfigApiKeys;
}

function createOpencodePaidConfig(spec: OpencodePaidModelSpec): AgentConfig {
  return {
    name: `opencode/${spec.nameSuffix}`,
    command: "opencode",
    args: [...OPENCODE_BASE_ARGS, "--model", spec.modelPath],
    environment: spec.environment,
    checkRequirements: checkOpencodeRequirements,
    apiKeys: spec.apiKeys,
    completionDetector: startOpenCodeCompletionDetector,
  };
}

// Paid model specs in desired output order:
// 1. xAI/Grok
// 2. Anthropic
// 3. OpenRouter (non-gpt-oss)
// 4. OpenAI
// 5. OpenRouter (gpt-oss) - at end so they appear after conditional gpt-5-nano
const OPENCODE_PAID_MODEL_SPECS: OpencodePaidModelSpec[] = [
  // xAI/Grok models
  {
    nameSuffix: "grok-4-1-fast",
    modelPath: "xai/grok-4-1-fast",
    environment: getOpencodeEnvironmentWithXai,
    apiKeys: [XAI_API_KEY],
  },
  {
    nameSuffix: "grok-4-1-fast-non-reasoning",
    modelPath: "xai/grok-4-1-fast-non-reasoning",
    environment: getOpencodeEnvironmentWithXai,
    apiKeys: [XAI_API_KEY],
  },
  // Anthropic models
  {
    nameSuffix: "sonnet-4",
    modelPath: "anthropic/claude-sonnet-4-20250514",
    environment: getOpencodeEnvironment,
    apiKeys: [ANTHROPIC_API_KEY],
  },
  {
    nameSuffix: "opus-4",
    modelPath: "anthropic/claude-opus-4-20250514",
    environment: getOpencodeEnvironment,
    apiKeys: [ANTHROPIC_API_KEY],
  },
  {
    nameSuffix: "opus-4.1-20250805",
    modelPath: "anthropic/claude-opus-4-1-20250805",
    environment: getOpencodeEnvironment,
    apiKeys: [ANTHROPIC_API_KEY],
  },
  // OpenRouter models (non-gpt-oss)
  {
    nameSuffix: "kimi-k2",
    modelPath: "openrouter/moonshotai/kimi-k2",
    environment: getOpencodeEnvironment,
    apiKeys: [OPENROUTER_API_KEY],
  },
  {
    nameSuffix: "qwen3-coder",
    modelPath: "openrouter/qwen/qwen3-coder",
    environment: getOpencodeEnvironment,
    apiKeys: [ANTHROPIC_API_KEY],
  },
  {
    nameSuffix: "glm-4.5",
    modelPath: "openrouter/z-ai/glm-4.5",
    environment: getOpencodeEnvironment,
    apiKeys: [OPENROUTER_API_KEY],
  },
  // OpenAI models
  {
    nameSuffix: "o3-pro",
    modelPath: "openai/o3-pro",
    environment: getOpencodeEnvironment,
    apiKeys: [OPENAI_API_KEY],
  },
  {
    nameSuffix: "gpt-5",
    modelPath: "openai/gpt-5",
    environment: getOpencodeEnvironment,
    apiKeys: [OPENAI_API_KEY],
  },
  {
    nameSuffix: "gpt-5-mini",
    modelPath: "openai/gpt-5-mini",
    environment: getOpencodeEnvironment,
    apiKeys: [OPENAI_API_KEY],
  },
  {
    nameSuffix: "gpt-5-nano",
    modelPath: "openai/gpt-5-nano",
    environment: getOpencodeEnvironment,
    apiKeys: [OPENAI_API_KEY],
  },
  // OpenRouter models (gpt-oss) - placed after gpt-5-nano
  {
    nameSuffix: "gpt-oss-120b",
    modelPath: "openrouter/openai/gpt-oss-120b",
    environment: getOpencodeEnvironment,
    apiKeys: [OPENROUTER_API_KEY],
  },
  {
    nameSuffix: "gpt-oss-20b",
    modelPath: "openrouter/openai/gpt-oss-20b",
    environment: getOpencodeEnvironment,
    apiKeys: [OPENROUTER_API_KEY],
  },
];

const OPENCODE_PAID_MODEL_CONFIGS: AgentConfig[] =
  OPENCODE_PAID_MODEL_SPECS.map(createOpencodePaidConfig);

// Helper set for conditional inclusion check
const OPENCODE_FREE_MODEL_NAME_SET = new Set(
  OPENCODE_FREE_MODEL_CONFIGS.map((config) => config.name)
);

// Final export: Free models + Paid models with conditional gpt-5-nano exclusion
// The specs array is pre-ordered so we can use simple slice operations:
// - Indices 0-10: grok, anthropic, openrouter (non-gpt-oss), o3-pro, gpt-5, gpt-5-mini
// - Index 11: gpt-5-nano (conditional)
// - Indices 12-13: gpt-oss-120b, gpt-oss-20b
const GPT5_NANO_INDEX = OPENCODE_PAID_MODEL_CONFIGS.findIndex(
  (c) => c.name === "opencode/gpt-5-nano"
);
const beforeNano = OPENCODE_PAID_MODEL_CONFIGS.slice(0, GPT5_NANO_INDEX);
const nanoConfig = OPENCODE_PAID_MODEL_CONFIGS[GPT5_NANO_INDEX];
const afterNano = OPENCODE_PAID_MODEL_CONFIGS.slice(GPT5_NANO_INDEX + 1);

export const OPENCODE_AGENT_CONFIGS: AgentConfig[] = [
  ...OPENCODE_FREE_MODEL_CONFIGS,
  ...beforeNano,
  // Conditional gpt-5-nano (only if not in free models)
  ...(OPENCODE_FREE_MODEL_NAME_SET.has("opencode/gpt-5-nano") || !nanoConfig
    ? []
    : [nanoConfig]),
  ...afterNano,
];
