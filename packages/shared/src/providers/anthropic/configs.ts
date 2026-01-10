import type { AgentConfig } from "../../agentConfig";
import { ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN } from "../../apiKeys";
import { checkClaudeRequirements } from "./check-requirements";
import { startClaudeCompletionDetector } from "./completion-detector";
import {
  CLAUDE_KEY_ENV_VARS_TO_UNSET,
  createClaudeEnvironment,
} from "./environment";

/**
 * Apply API keys for Claude agents.
 *
 * Priority:
 * 1. If CLAUDE_CODE_OAUTH_TOKEN is set, use it and unset ANTHROPIC_API_KEY
 * 2. If user's ANTHROPIC_API_KEY is set, use it directly (not through cmux proxy)
 * 3. Otherwise, fall back to AWS Bedrock (handled in environment.ts)
 *
 * The OAuth token is preferred because it uses the user's own Claude subscription.
 * IMPORTANT: We NEVER use cmux's platform-provided ANTHROPIC_API_KEY for tasks.
 */
const applyClaudeApiKeys: NonNullable<AgentConfig["applyApiKeys"]> = async (
  keys,
) => {
  const oauthToken = keys.CLAUDE_CODE_OAUTH_TOKEN;
  const anthropicKey = keys.ANTHROPIC_API_KEY;

  // Always unset these to prevent conflicts
  const unsetEnv = [...CLAUDE_KEY_ENV_VARS_TO_UNSET];

  // If OAuth token is set, ensure ANTHROPIC_API_KEY is also unset
  if (oauthToken && oauthToken.trim().length > 0) {
    // Ensure ANTHROPIC_API_KEY is in the unset list (it already should be from CLAUDE_KEY_ENV_VARS_TO_UNSET)
    if (!unsetEnv.includes("ANTHROPIC_API_KEY")) {
      unsetEnv.push("ANTHROPIC_API_KEY");
    }
    return {
      env: {
        CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
      },
      unsetEnv,
    };
  }

  // Fall back to user's ANTHROPIC_API_KEY if no OAuth token
  // Note: The API key is passed via settings.json (anthropicApiKey), not env var
  if (anthropicKey && anthropicKey.trim().length > 0) {
    return {
      unsetEnv,
    };
  }

  // No user-provided credentials - will use AWS Bedrock (configured in environment.ts)
  return {
    unsetEnv,
  };
};

// Only export 4.5 models - older models are no longer supported
// When no OAuth token or user API key is provided, these fall back to AWS Bedrock

export const CLAUDE_OPUS_4_5_CONFIG: AgentConfig = {
  name: "claude/opus-4.5",
  command: "bunx",
  args: [
    "@anthropic-ai/claude-code@latest",
    "--model",
    "claude-opus-4-5",
    "--allow-dangerously-skip-permissions",
    "--dangerously-skip-permissions",
    "--ide",
    "$PROMPT",
  ],
  environment: createClaudeEnvironment("claude-opus-4-5"),
  checkRequirements: checkClaudeRequirements,
  apiKeys: [CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY],
  applyApiKeys: applyClaudeApiKeys,
  completionDetector: startClaudeCompletionDetector,
};

export const CLAUDE_SONNET_4_5_CONFIG: AgentConfig = {
  name: "claude/sonnet-4.5",
  command: "bunx",
  args: [
    "@anthropic-ai/claude-code@latest",
    "--model",
    "claude-sonnet-4-5-20250929",
    "--allow-dangerously-skip-permissions",
    "--dangerously-skip-permissions",
    "--ide",
    "$PROMPT",
  ],
  environment: createClaudeEnvironment("claude-sonnet-4-5-20250929"),
  checkRequirements: checkClaudeRequirements,
  apiKeys: [CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY],
  applyApiKeys: applyClaudeApiKeys,
  completionDetector: startClaudeCompletionDetector,
};

export const CLAUDE_HAIKU_4_5_CONFIG: AgentConfig = {
  name: "claude/haiku-4.5",
  command: "bunx",
  args: [
    "@anthropic-ai/claude-code@latest",
    "--model",
    "claude-haiku-4-5-20251001",
    "--allow-dangerously-skip-permissions",
    "--dangerously-skip-permissions",
    "--ide",
    "$PROMPT",
  ],
  environment: createClaudeEnvironment("claude-haiku-4-5-20251001"),
  checkRequirements: checkClaudeRequirements,
  apiKeys: [CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY],
  applyApiKeys: applyClaudeApiKeys,
  completionDetector: startClaudeCompletionDetector,
};
