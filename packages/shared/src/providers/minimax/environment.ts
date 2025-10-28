import type {
  EnvironmentContext,
  EnvironmentResult,
} from "../common/environment-result";

export const MINIMAX_KEY_ENV_VARS_TO_UNSET = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_API_KEY",
  "MINIMAX_API_KEY",
];

export async function getMinimaxEnvironment(
  ctx: EnvironmentContext,
): Promise<EnvironmentResult> {
  const { readFile } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  const { Buffer } = await import("node:buffer");

  const files: EnvironmentResult["files"] = [];
  const env: Record<string, string> = {};
  const startupCommands: string[] = [];
  const claudeLifecycleDir = "/root/lifecycle/claude";
  const claudeSecretsDir = `${claudeLifecycleDir}/secrets`;
  const minimaxApiKeyHelperPath = `${claudeSecretsDir}/minimax_key_helper.sh`;

  // Prepare .claude.json (Claude Code will use this even with MiniMax backend)
  try {
    let existingConfig = {};
    try {
      const content = await readFile(`${homedir()}/.claude.json`, "utf-8");
      existingConfig = JSON.parse(content);
    } catch {
      // File doesn't exist or is invalid, start fresh
    }

    const config = {
      ...existingConfig,
      projects: {
        "/root/workspace": {
          allowedTools: [],
          history: [],
          mcpContextUris: [],
          mcpServers: {},
          enabledMcpjsonServers: [],
          disabledMcpjsonServers: [],
          hasTrustDialogAccepted: true,
          projectOnboardingSeenCount: 0,
          hasClaudeMdExternalIncludesApproved: false,
          hasClaudeMdExternalIncludesWarningShown: false,
        },
      },
      isQualifiedForDataSharing: false,
      hasCompletedOnboarding: true,
      bypassPermissionsModeAccepted: true,
      hasAcknowledgedCostThreshold: true,
    };

    files.push({
      destinationPath: "$HOME/.claude.json",
      contentBase64: Buffer.from(JSON.stringify(config, null, 2)).toString(
        "base64",
      ),
      mode: "644",
    });
  } catch (error) {
    console.warn("Failed to prepare .claude.json:", error);
  }

  // Ensure directories exist
  startupCommands.unshift("mkdir -p ~/.claude");
  startupCommands.push(`mkdir -p ${claudeLifecycleDir}`);
  startupCommands.push(`mkdir -p ${claudeSecretsDir}`);

  // Clean up any previous completion markers
  startupCommands.push(
    "rm -f /root/lifecycle/claude-complete-* 2>/dev/null || true",
  );

  // Create the stop hook script for completion detection
  const stopHookScript = `#!/bin/bash
# MiniMax/Claude Code stop hook for cmux task completion detection
# This script is called when Claude Code finishes responding

# Log to multiple places for debugging
LOG_FILE="/root/lifecycle/claude-hook.log"

echo "[CMUX Stop Hook] Script started at $(date)" >> "$LOG_FILE"
echo "[CMUX Stop Hook] CMUX_TASK_RUN_ID=\${CMUX_TASK_RUN_ID}" >> "$LOG_FILE"
echo "[CMUX Stop Hook] PWD=$(pwd)" >> "$LOG_FILE"
echo "[CMUX Stop Hook] All env vars:" >> "$LOG_FILE"
env | grep -E "(CMUX|CLAUDE|TASK)" >> "$LOG_FILE" 2>&1

# Create a completion marker file that cmux can detect
COMPLETION_MARKER="/root/lifecycle/claude-complete-\${CMUX_TASK_RUN_ID:-unknown}"
echo "$(date +%s)" > "$COMPLETION_MARKER"

# Log success
echo "[CMUX Stop Hook] Created marker file: $COMPLETION_MARKER" >> "$LOG_FILE"
ls -la "$COMPLETION_MARKER" >> "$LOG_FILE" 2>&1

# Also log to stderr for visibility
echo "[CMUX Stop Hook] Task completed for task run ID: \${CMUX_TASK_RUN_ID:-unknown}" >&2
echo "[CMUX Stop Hook] Created marker file: $COMPLETION_MARKER" >&2

# Always allow Claude to stop (don't block)
exit 0`;

  files.push({
    destinationPath: `${claudeLifecycleDir}/stop-hook.sh`,
    contentBase64: Buffer.from(stopHookScript).toString("base64"),
    mode: "755",
  });

  // Create settings.json with MiniMax-specific configuration
  const settingsConfig: Record<string, unknown> = {
    // Use the MiniMax API key from cmux settings.json
    ...(ctx.apiKeys?.MINIMAX_API_KEY
      ? { anthropicApiKey: ctx.apiKeys.MINIMAX_API_KEY }
      : {}),
    // Configure helper to avoid env-var based prompting
    apiKeyHelper: minimaxApiKeyHelperPath,
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: `${claudeLifecycleDir}/stop-hook.sh`,
            },
          ],
        },
      ],
    },
    env: {
      CLAUDE_CODE_ENABLE_TELEMETRY: 0,
      // Point to MiniMax's Anthropic-compatible API endpoint
      ANTHROPIC_BASE_URL: "https://api.minimaxi.com/anthropic",
      // Proxy through cmux for monitoring
      // ANTHROPIC_CUSTOM_HEADERS: `x-cmux-token:${ctx.taskRunJwt}`,
      API_TIMEOUT_MS: "3000000",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    },
  };

  files.push({
    destinationPath: "$HOME/.claude/settings.json",
    contentBase64: Buffer.from(
      JSON.stringify(settingsConfig, null, 2),
    ).toString("base64"),
    mode: "644",
  });

  // Add apiKey helper script
  const helperScript = `#!/bin/sh
echo ${ctx.apiKeys?.MINIMAX_API_KEY || ""}`;
  files.push({
    destinationPath: minimaxApiKeyHelperPath,
    contentBase64: Buffer.from(helperScript).toString("base64"),
    mode: "700",
  });

  // Log the files for debugging
  startupCommands.push(
    `echo '[CMUX] Created MiniMax/Claude hook files in /root/lifecycle:' && ls -la ${claudeLifecycleDir}/`,
  );
  startupCommands.push(
    "echo '[CMUX] Settings directory in ~/.claude:' && ls -la /root/.claude/",
  );

  return {
    files,
    env,
    startupCommands,
    unsetEnv: [...MINIMAX_KEY_ENV_VARS_TO_UNSET],
  };
}
