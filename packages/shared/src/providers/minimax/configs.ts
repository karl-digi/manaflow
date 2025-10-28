import type { AgentConfig } from "../../agentConfig";
import { MINIMAX_API_KEY } from "../../apiKeys";
import { startClaudeCompletionDetector } from "../anthropic/completion-detector";
import { getMiniMaxEnvironment } from "./environment";

export const CLAUDE_MINIMAX_M2_CONFIG: AgentConfig = {
  name: "claude/minimax-m2",
  command: "bunx",
  args: [
    "@anthropic-ai/claude-code@latest",
    "--model",
    "MiniMax-M2",
    "--dangerously-skip-permissions",
    "--ide",
    "$PROMPT",
  ],
  environment: getMiniMaxEnvironment,
  apiKeys: [
    {
      ...MINIMAX_API_KEY,
      mapToEnvVar: "ANTHROPIC_AUTH_TOKEN",
    },
  ],
  completionDetector: startClaudeCompletionDetector,
};
