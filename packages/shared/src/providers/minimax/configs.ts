import type { AgentConfig } from "../../agentConfig";
import { MINIMAX_API_KEY } from "../../apiKeys";
import { checkMinimaxRequirements } from "./check-requirements";
import { startMinimaxCompletionDetector } from "./completion-detector";
import {
  MINIMAX_KEY_ENV_VARS_TO_UNSET,
  getMinimaxEnvironment,
} from "./environment";

const applyMinimaxApiKeys: NonNullable<AgentConfig["applyApiKeys"]> =
  async () => ({
    unsetEnv: [...MINIMAX_KEY_ENV_VARS_TO_UNSET],
  });

export const MINIMAX_M2_CONFIG: AgentConfig = {
  name: "minimax/m2",
  command: "bunx",
  args: [
    "@anthropic-ai/claude-code@latest",
    "--model",
    "MiniMax-M2",
    "--dangerously-skip-permissions",
    "--ide",
    "$PROMPT",
  ],
  environment: getMinimaxEnvironment,
  checkRequirements: checkMinimaxRequirements,
  apiKeys: [MINIMAX_API_KEY],
  applyApiKeys: applyMinimaxApiKeys,
  completionDetector: startMinimaxCompletionDetector,
};

export const MINIMAX_TEXT_01_CONFIG: AgentConfig = {
  name: "minimax/text-01",
  command: "bunx",
  args: [
    "@anthropic-ai/claude-code@latest",
    "--model",
    "MiniMax-Text-01",
    "--dangerously-skip-permissions",
    "--ide",
    "$PROMPT",
  ],
  environment: getMinimaxEnvironment,
  checkRequirements: checkMinimaxRequirements,
  apiKeys: [MINIMAX_API_KEY],
  applyApiKeys: applyMinimaxApiKeys,
  completionDetector: startMinimaxCompletionDetector,
};
