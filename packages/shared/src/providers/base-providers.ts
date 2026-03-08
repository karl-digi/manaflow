/**
 * Base provider specifications for the Provider Registry.
 * These define the default configurations for built-in providers.
 */

import type { AgentConfigApiKey } from "../agentConfig";
import {
  ANTHROPIC_API_KEY,
  ANTHROPIC_BASE_URL_KEY,
  CLAUDE_CODE_OAUTH_TOKEN,
  CODEX_AUTH_JSON,
  GEMINI_API_KEY,
  GEMINI_BASE_URL_KEY,
  MODEL_STUDIO_API_KEY,
  MODEL_STUDIO_BASE_URL_KEY,
  OPENAI_API_KEY,
  OPENAI_BASE_URL_KEY,
  OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL_KEY,
  XAI_API_KEY,
  XAI_BASE_URL_KEY,
  AMP_API_KEY,
  CURSOR_API_KEY,
} from "../apiKeys";

/**
 * API format types supported by the provider registry.
 * - anthropic: Anthropic's native API format
 * - openai: OpenAI-compatible API format (also used by many proxies)
 * - bedrock: AWS Bedrock format
 * - vertex: Google Vertex AI format
 * - passthrough: Raw passthrough without transformation
 */
export type ApiFormat =
  | "anthropic"
  | "openai"
  | "bedrock"
  | "vertex"
  | "passthrough";

/**
 * Specification for a model within a provider.
 */
export interface ModelSpec {
  name: string;
  displayName: string;
  apiModelId: string;
}

/**
 * Static specification for a provider.
 * Defines the default configuration that can be overridden per-team.
 */
export interface ProviderSpec {
  id: string;
  name: string;
  defaultBaseUrl: string;
  apiFormat: ApiFormat;
  authEnvVars: string[];
  apiKeys: AgentConfigApiKey[];
  baseUrlKey?: AgentConfigApiKey;
}

/**
 * Built-in provider specifications.
 * These are the default providers available to all teams.
 */
export const BASE_PROVIDERS: ProviderSpec[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    apiFormat: "anthropic",
    authEnvVars: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
    apiKeys: [CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY],
    baseUrlKey: ANTHROPIC_BASE_URL_KEY,
  },
  {
    id: "openai",
    name: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    apiFormat: "openai",
    authEnvVars: ["OPENAI_API_KEY"],
    apiKeys: [OPENAI_API_KEY, CODEX_AUTH_JSON],
    baseUrlKey: OPENAI_BASE_URL_KEY,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiFormat: "openai",
    authEnvVars: ["GEMINI_API_KEY"],
    apiKeys: [GEMINI_API_KEY],
    baseUrlKey: GEMINI_BASE_URL_KEY,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    apiFormat: "openai",
    authEnvVars: ["OPENROUTER_API_KEY"],
    apiKeys: [OPENROUTER_API_KEY],
    baseUrlKey: OPENROUTER_BASE_URL_KEY,
  },
  {
    id: "xai",
    name: "xAI",
    defaultBaseUrl: "https://api.x.ai/v1",
    apiFormat: "openai",
    authEnvVars: ["XAI_API_KEY"],
    apiKeys: [XAI_API_KEY],
    baseUrlKey: XAI_BASE_URL_KEY,
  },
  {
    id: "modelstudio",
    name: "Alibaba ModelStudio",
    defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    apiFormat: "openai",
    authEnvVars: ["MODEL_STUDIO_API_KEY"],
    apiKeys: [MODEL_STUDIO_API_KEY],
    baseUrlKey: MODEL_STUDIO_BASE_URL_KEY,
  },
  {
    id: "amp",
    name: "Sourcegraph AMP",
    defaultBaseUrl: "https://sourcegraph.com",
    apiFormat: "passthrough",
    authEnvVars: ["AMP_API_KEY"],
    apiKeys: [AMP_API_KEY],
  },
  {
    id: "cursor",
    name: "Cursor",
    defaultBaseUrl: "https://api.cursor.sh",
    apiFormat: "passthrough",
    authEnvVars: ["CURSOR_API_KEY"],
    apiKeys: [CURSOR_API_KEY],
  },
];

/**
 * Map of provider ID to provider spec for quick lookup.
 */
export const BASE_PROVIDER_MAP: Record<string, ProviderSpec> = Object.fromEntries(
  BASE_PROVIDERS.map((p) => [p.id, p])
);

/**
 * Get a base provider by ID.
 */
export function getBaseProvider(providerId: string): ProviderSpec | undefined {
  return BASE_PROVIDER_MAP[providerId];
}

/**
 * Get the primary vendor/provider ID from an agent name.
 * e.g., "claude/opus-4.6" -> "anthropic"
 *       "codex/gpt-5.1" -> "openai"
 *       "gemini/2.5-pro" -> "gemini"
 */
export function getProviderIdFromAgentName(agentName: string): string | undefined {
  const prefix = agentName.split("/")[0];
  if (!prefix) {
    return undefined;
  }
  const prefixToProvider: Record<string, string> = {
    claude: "anthropic",
    codex: "openai",
    gemini: "gemini",
    grok: "xai",
    opencode: "openrouter", // OpenCode uses OpenRouter by default
    amp: "amp",
    cursor: "cursor",
    qwen: "modelstudio",
  };
  return prefixToProvider[prefix];
}
