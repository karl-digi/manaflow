import type { AgentConfig } from "../../agentConfig";

/**
 * Environment variables that should be unset to prevent conflicts
 * with MiniMax configuration
 */
export const MINIMAX_KEY_ENV_VARS_TO_UNSET = [
  "MINIMAX_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_API_KEY",
];

/**
 * Apply MiniMax API keys to the environment
 * This function maps the MINIMAX_API_KEY to ANTHROPIC_AUTH_TOKEN
 * since MiniMax uses an Anthropic-compatible API interface
 * @param keys - Record of API keys from configuration
 * @returns Partial environment result with keys to unset
 */
export const applyMiniMaxApiKeys: NonNullable<AgentConfig["applyApiKeys"]> = async (
  keys: Record<string, string>
) => {
  const environment: Record<string, string> = {};

  // Map MiniMax API key to ANTHROPIC_AUTH_TOKEN for Claude Code compatibility
  if (keys.MINIMAX_API_KEY) {
    environment.ANTHROPIC_AUTH_TOKEN = keys.MINIMAX_API_KEY;
  }

  return {
    environment,
    unsetEnv: [...MINIMAX_KEY_ENV_VARS_TO_UNSET],
  };
};