import type { AgentConfigApiKey } from "./agentConfig";

export const ANTHROPIC_API_KEY: AgentConfigApiKey = {
  envVar: "ANTHROPIC_API_KEY",
  displayName: "Anthropic API Key",
  description: "Anthropic API Key",
};

export const OPENAI_API_KEY: AgentConfigApiKey = {
  envVar: "OPENAI_API_KEY",
  displayName: "OpenAI API Key",
  description: "OpenAI API Key",
};

export const OPENROUTER_API_KEY: AgentConfigApiKey = {
  envVar: "OPENROUTER_API_KEY",
  displayName: "OpenRouter API Key",
  description: "OpenRouter API Key",
};

export const GEMINI_API_KEY: AgentConfigApiKey = {
  envVar: "GEMINI_API_KEY",
  displayName: "Gemini API Key",
  description: "API key for Google Gemini AI models",
};

export const AMP_API_KEY: AgentConfigApiKey = {
  envVar: "AMP_API_KEY",
  displayName: "AMP API Key",
  description: "API key for Sourcegraph AMP",
};

export const CURSOR_API_KEY: AgentConfigApiKey = {
  envVar: "CURSOR_API_KEY",
  displayName: "Cursor API Key",
  description: "API key for Cursor agent",
};

export const MODEL_STUDIO_API_KEY: AgentConfigApiKey = {
  envVar: "MODEL_STUDIO_API_KEY",
  displayName: "Alibaba Cloud ModelStudio API Key",
  description: "Alibaba Cloud ModelStudio (DashScope Intl) API key for Qwen",
};

export const XAI_API_KEY: AgentConfigApiKey = {
  envVar: "XAI_API_KEY",
  displayName: "xAI API Key",
  description: "API key for xAI Grok models",
};

export const CLAUDE_CODE_OAUTH_TOKEN: AgentConfigApiKey = {
  envVar: "CLAUDE_CODE_OAUTH_TOKEN",
  displayName: "Claude OAuth Token",
  description:
    "OAuth token from Claude Code CLI. Run `claude setup-token` and paste the output here. Preferred over Anthropic API key when set.",
};

export const CODEX_AUTH_JSON: AgentConfigApiKey = {
  envVar: "CODEX_AUTH_JSON",
  displayName: "Codex Auth JSON",
  description:
    "Contents of ~/.codex/auth.json. Copy and paste the full JSON contents here.",
};

export type ProviderBaseUrlKey = AgentConfigApiKey & {
  placeholder: string;
};

export const ANTHROPIC_BASE_URL_KEY: ProviderBaseUrlKey = {
  envVar: "ANTHROPIC_BASE_URL",
  displayName: "Anthropic Base URL",
  description:
    "Custom API endpoint for Anthropic/Claude models (e.g., self-hosted proxy).",
  placeholder: "https://api.anthropic.com (without /v1 suffix)",
};

export const OPENAI_BASE_URL_KEY: ProviderBaseUrlKey = {
  envVar: "OPENAI_BASE_URL",
  displayName: "OpenAI Base URL",
  description: "Custom API endpoint for OpenAI/Codex models.",
  placeholder: "https://api.openai.com/v1",
};

export const GEMINI_BASE_URL_KEY: ProviderBaseUrlKey = {
  envVar: "GEMINI_BASE_URL",
  displayName: "Gemini Base URL",
  description: "Custom API endpoint for Google Gemini models.",
  placeholder: "https://generativelanguage.googleapis.com/v1beta",
};

export const OPENROUTER_BASE_URL_KEY: ProviderBaseUrlKey = {
  envVar: "OPENROUTER_BASE_URL",
  displayName: "OpenRouter Base URL",
  description: "Custom API endpoint for OpenRouter.",
  placeholder: "https://openrouter.ai/api/v1",
};

export const XAI_BASE_URL_KEY: ProviderBaseUrlKey = {
  envVar: "XAI_BASE_URL",
  displayName: "xAI Base URL",
  description: "Custom API endpoint for xAI Grok models.",
  placeholder: "https://api.x.ai/v1",
};

export const MODEL_STUDIO_BASE_URL_KEY: ProviderBaseUrlKey = {
  envVar: "MODEL_STUDIO_BASE_URL",
  displayName: "ModelStudio Base URL",
  description: "Custom API endpoint for Alibaba ModelStudio.",
  placeholder: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
};

export const API_KEY_TO_BASE_URL: Record<string, ProviderBaseUrlKey> = {
  ANTHROPIC_API_KEY: ANTHROPIC_BASE_URL_KEY,
  OPENAI_API_KEY: OPENAI_BASE_URL_KEY,
  GEMINI_API_KEY: GEMINI_BASE_URL_KEY,
  OPENROUTER_API_KEY: OPENROUTER_BASE_URL_KEY,
  XAI_API_KEY: XAI_BASE_URL_KEY,
  MODEL_STUDIO_API_KEY: MODEL_STUDIO_BASE_URL_KEY,
};

export const ALL_BASE_URL_KEYS: ProviderBaseUrlKey[] = [
  ANTHROPIC_BASE_URL_KEY,
  OPENAI_BASE_URL_KEY,
  GEMINI_BASE_URL_KEY,
  OPENROUTER_BASE_URL_KEY,
  XAI_BASE_URL_KEY,
  MODEL_STUDIO_BASE_URL_KEY,
];

/**
 * All unique API keys used by agents (deduplicated by envVar).
 * Used by the settings page to render API key input fields.
 */
export const ALL_API_KEYS: AgentConfigApiKey[] = [
  CLAUDE_CODE_OAUTH_TOKEN,
  ANTHROPIC_API_KEY,
  OPENAI_API_KEY,
  CODEX_AUTH_JSON,
  OPENROUTER_API_KEY,
  GEMINI_API_KEY,
  MODEL_STUDIO_API_KEY,
  AMP_API_KEY,
  CURSOR_API_KEY,
  XAI_API_KEY,
];
