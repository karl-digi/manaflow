import type { AgentConfig } from "../../agentConfig";
import { MINIMAX_API_KEY } from "../../apiKeys";
import { checkMiniMaxRequirements } from "./check-requirements";
import { startMiniMaxCompletionDetector } from "./completion-detector";
import { getMiniMaxEnvironment } from "./environment";
import { applyMiniMaxApiKeys } from "./applyApiKeys";

/**
 * MiniMax M2 model configuration
 * Uses Claude Code CLI with MiniMax API endpoint through Anthropic-compatible interface
 */
export const MINIMAX_M2_CONFIG: AgentConfig = {
  name: "minimax/m2",
  command: "bunx",
  args: [
    "@anthropic-ai/claude-code@latest",
    "--model", "MiniMax-M2",
    "--dangerously-skip-permissions",
    "--ide", "$PROMPT",
  ],
  environment: getMiniMaxEnvironment,
  checkRequirements: checkMiniMaxRequirements,
  apiKeys: [MINIMAX_API_KEY],
  applyApiKeys: applyMiniMaxApiKeys,
  completionDetector: startMiniMaxCompletionDetector,
  waitForString: "Model: MiniMax-M2",
};

/**
 * Alternative configuration for MiniMax M2 with extended timeout
 * Useful for longer running tasks
 */
export const MINIMAX_M2_EXTENDED_CONFIG: AgentConfig = {
  name: "minimax/m2-extended",
  command: "bunx",
  args: [
    "@anthropic-ai/claude-code@latest",
    "--model", "MiniMax-M2",
    "--dangerously-skip-permissions",
    "--ide", "$PROMPT",
  ],
  environment: getMiniMaxEnvironment,
  checkRequirements: checkMiniMaxRequirements,
  apiKeys: [MINIMAX_API_KEY],
  applyApiKeys: applyMiniMaxApiKeys,
  completionDetector: startMiniMaxCompletionDetector,
  waitForString: "Model: MiniMax-M2",
};