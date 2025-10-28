import type {
  EnvironmentContext,
  EnvironmentResult,
} from "../common/environment-result";

/**
 * Get MiniMax-specific environment configuration
 * Sets up the environment variables needed for Claude Code to work with MiniMax API
 */
export async function getMiniMaxEnvironment(
  ctx: EnvironmentContext
): Promise<EnvironmentResult> {
  const env: Record<string, string> = {
    // Configure Claude Code to use MiniMax API endpoint
    ANTHROPIC_BASE_URL: "https://api.minimaxi.com/anthropic",

    // Extended timeout for MiniMax API (50 minutes)
    API_TIMEOUT_MS: "3000000",

    // Disable non-essential traffic for better performance
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",

    // Set all model types to use MiniMax-M2
    ANTHROPIC_MODEL: "MiniMax-M2",
    ANTHROPIC_SMALL_FAST_MODEL: "MiniMax-M2",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMax-M2",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMax-M2",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMax-M2",

    // Disable telemetry for privacy
    DO_NOT_TRACK: "1",
    TELEMETRY_DISABLED: "1",

    // Set terminal settings for better compatibility
    TERM: "xterm-256color",
    COLORTERM: "truecolor",

    // Workspace configuration
    WORKSPACE_ROOT: "/root/workspace",
  };

  // Map MiniMax API key to ANTHROPIC_AUTH_TOKEN if provided
  if (ctx.apiKeys?.MINIMAX_API_KEY) {
    env.ANTHROPIC_AUTH_TOKEN = ctx.apiKeys.MINIMAX_API_KEY;
  }

  return {
    env,
    files: [],
    startupCommands: [],
  };
}