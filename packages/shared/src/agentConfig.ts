import type {
  EnvironmentContext,
  EnvironmentResult,
} from "./providers/common/environment-result";
import { getPluginLoader } from "./providers/plugin-loader";

import { AMP_AGENT_CONFIGS } from "./providers/amp/configs";
import { CLAUDE_AGENT_CONFIGS } from "./providers/anthropic/configs";
import { CURSOR_AGENT_CONFIGS } from "./providers/cursor/configs";
import { GEMINI_AGENT_CONFIGS } from "./providers/gemini/configs";
import { GROK_AGENT_CONFIGS } from "./providers/grok/configs";
import { CODEX_AGENT_CONFIGS } from "./providers/openai/configs";
import { OPENCODE_AGENT_CONFIGS } from "./providers/opencode/configs";
import { QWEN_AGENT_CONFIGS } from "./providers/qwen/configs";

export { checkGitStatus } from "./providers/common/check-git";

export { type EnvironmentResult };

/**
 * Feature flag for enabling dynamic plugin loading.
 * When true, getAgentConfigs() uses the PluginLoader.
 * When false (default), uses the static AGENT_CONFIGS array.
 */
const USE_DYNAMIC_LOADING = process.env.CMUX_DYNAMIC_PLUGINS === "true";

export type AgentConfigApiKey = {
  envVar: string;
  displayName: string;
  description?: string;
  // Optionally inject this key value under a different environment variable
  // name when launching the agent process.
  mapToEnvVar?: string;
};
export type AgentConfigApiKeys = Array<AgentConfigApiKey>;

export type ProviderRequirementsContext = {
  apiKeys?: Record<string, string>;
  teamSlugOrId?: string;
};

export interface AgentConfig {
  name: string;
  command: string;
  args: string[];
  apiKeys?: AgentConfigApiKeys;
  environment?: (ctx: EnvironmentContext) => Promise<EnvironmentResult>;
  applyApiKeys?: (
    keys: Record<string, string>,
  ) => Promise<Partial<EnvironmentResult>> | Partial<EnvironmentResult>; // Optional hook to apply API keys into env/files/startup commands instead of default env var injection
  waitForString?: string;
  enterKeySequence?: string; // Custom enter key sequence, defaults to "\r"
  checkRequirements?: (
    context?: ProviderRequirementsContext,
  ) => Promise<string[]>; // Returns list of missing requirements
  completionDetector?: (taskRunId: string) => Promise<void>;
  disabled?: boolean; // When true, agent is shown in UI but not selectable
  disabledReason?: string; // Reason shown in tooltip when disabled
}

/**
 * Static array of all agent configurations.
 * @deprecated Use getAgentConfigs() for new code to support dynamic plugin loading.
 */
export const AGENT_CONFIGS: AgentConfig[] = [
  ...CLAUDE_AGENT_CONFIGS,
  ...CODEX_AGENT_CONFIGS,
  ...AMP_AGENT_CONFIGS,
  ...OPENCODE_AGENT_CONFIGS,
  ...GEMINI_AGENT_CONFIGS,
  ...QWEN_AGENT_CONFIGS,
  ...GROK_AGENT_CONFIGS,
  ...CURSOR_AGENT_CONFIGS,
];

/**
 * Get all agent configurations.
 *
 * Uses dynamic plugin loading when CMUX_DYNAMIC_PLUGINS=true,
 * otherwise falls back to the static AGENT_CONFIGS array.
 *
 * @returns Array of agent configurations
 */
export function getAgentConfigs(): AgentConfig[] {
  if (USE_DYNAMIC_LOADING) {
    const loader = getPluginLoader();
    if (loader.isLoaded()) {
      return loader.getAllConfigs();
    }
    // Fall back to static if plugins haven't been loaded yet
    console.warn(
      "[getAgentConfigs] Dynamic loading enabled but plugins not loaded, using static configs"
    );
  }
  return AGENT_CONFIGS;
}
