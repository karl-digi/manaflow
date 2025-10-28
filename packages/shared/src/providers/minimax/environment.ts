import type {
  EnvironmentContext,
  EnvironmentResult,
} from "../common/environment-result";

const MINIMAX_KEY_ENV_VARS_TO_UNSET = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_CUSTOM_HEADERS",
  "CLAUDE_API_KEY",
];

const CLAUDE_LIFECYCLE_DIR = "/root/lifecycle/claude";
const CLAUDE_SECRETS_DIR = `${CLAUDE_LIFECYCLE_DIR}/secrets`;
const STOP_HOOK_PATH = `${CLAUDE_LIFECYCLE_DIR}/stop-hook.sh`;

const MINIMAX_DEFAULT_ENV: Record<string, string> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  API_TIMEOUT_MS: "3000000",
  ANTHROPIC_BASE_URL: "https://api.minimaxi.com/anthropic",
  ANTHROPIC_MODEL: "MiniMax-M2",
  ANTHROPIC_SMALL_FAST_MODEL: "MiniMax-M2",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMax-M2",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMax-M2",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMax-M2",
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

export async function getMiniMaxEnvironment(
  ctx: EnvironmentContext,
): Promise<EnvironmentResult> {
  const { readFile } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  const { Buffer } = await import("node:buffer");

  const files: EnvironmentResult["files"] = [];
  const env: Record<string, string> = { ...MINIMAX_DEFAULT_ENV };
  const startupCommands: string[] = [];

  startupCommands.push("mkdir -p ~/.claude");
  startupCommands.push(`mkdir -p ${CLAUDE_LIFECYCLE_DIR}`);
  startupCommands.push(`mkdir -p ${CLAUDE_SECRETS_DIR}`);
  startupCommands.push(
    "rm -f /root/lifecycle/claude-complete-* 2>/dev/null || true",
  );

  if (ctx.apiKeys?.MINIMAX_API_KEY) {
    env.ANTHROPIC_AUTH_TOKEN = ctx.apiKeys.MINIMAX_API_KEY;
  }

  try {
    let claudeConfig: JsonRecord = {};
    try {
      const content = await readFile(`${homedir()}/.claude.json`, "utf-8");
      claudeConfig = JSON.parse(content) as JsonRecord;
    } catch {
      // Ignore missing/invalid files - create a fresh config instead
    }

    const mergedConfig: JsonRecord = {
      ...claudeConfig,
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
      contentBase64: Buffer.from(
        JSON.stringify(mergedConfig, null, 2),
      ).toString("base64"),
      mode: "644",
    });
  } catch (error) {
    console.warn("Failed to prepare .claude.json:", error);
  }

  let existingSettings: JsonRecord = {};
  try {
    const currentSettings = await readFile(
      `${homedir()}/.claude/settings.json`,
      "utf-8",
    );
    existingSettings = JSON.parse(currentSettings) as JsonRecord;
  } catch {
    // Missing settings.json is fine; we'll create one.
  }

  const existingEnv = isRecord(existingSettings.env)
    ? (existingSettings.env as Record<string, unknown>)
    : {};
  const mergedEnv: Record<string, unknown> = {
    ...existingEnv,
    ...MINIMAX_DEFAULT_ENV,
  };
  if (ctx.apiKeys?.MINIMAX_API_KEY) {
    mergedEnv.ANTHROPIC_AUTH_TOKEN = ctx.apiKeys.MINIMAX_API_KEY;
  }

  const existingHooks = isRecord(existingSettings.hooks)
    ? (existingSettings.hooks as JsonRecord)
    : {};
  const stopHooks: unknown = existingHooks.Stop;
  const stopHookEntries = Array.isArray(stopHooks)
    ? [...stopHooks]
    : [];

  const minimaxStopHook = {
    hooks: [
      {
        type: "command",
        command: STOP_HOOK_PATH,
      },
    ],
  };

  const alreadyHasStopHook = stopHookEntries.some(
    (entry) =>
      isRecord(entry) &&
      Array.isArray(entry.hooks) &&
      entry.hooks.some(
        (hook) =>
          isRecord(hook) &&
          hook.type === "command" &&
          hook.command === STOP_HOOK_PATH,
      ),
  );

  if (!alreadyHasStopHook) {
    stopHookEntries.push(minimaxStopHook);
  }

  const mergedSettings: JsonRecord = {
    ...existingSettings,
    env: mergedEnv,
    hooks: {
      ...existingHooks,
      Stop: stopHookEntries,
    },
  };

  files.push({
    destinationPath: "$HOME/.claude/settings.json",
    contentBase64: Buffer.from(
      JSON.stringify(mergedSettings, null, 2),
    ).toString("base64"),
    mode: "644",
  });

  const stopHookScript = `#!/bin/bash
# Claude Code stop hook for MiniMax Claude support
LOG_FILE="/root/lifecycle/claude-hook.log"

echo "[CMUX Stop Hook] Script started at $(date)" >> "$LOG_FILE"
echo "[CMUX Stop Hook] CMUX_TASK_RUN_ID=\${CMUX_TASK_RUN_ID}" >> "$LOG_FILE"
echo "[CMUX Stop Hook] PWD=$(pwd)" >> "$LOG_FILE"
echo "[CMUX Stop Hook] All env vars:" >> "$LOG_FILE"
env | grep -E "(CMUX|CLAUDE|TASK)" >> "$LOG_FILE" 2>&1

COMPLETION_MARKER="/root/lifecycle/claude-complete-\${CMUX_TASK_RUN_ID:-unknown}"
echo "$(date +%s)" > "$COMPLETION_MARKER"

echo "[CMUX Stop Hook] Created marker file: $COMPLETION_MARKER" >> "$LOG_FILE"
ls -la "$COMPLETION_MARKER" >> "$LOG_FILE" 2>&1

echo "[CMUX Stop Hook] Task completed for task run ID: \${CMUX_TASK_RUN_ID:-unknown}" >&2
echo "[CMUX Stop Hook] Created marker file: $COMPLETION_MARKER" >&2

exit 0`;

  files.push({
    destinationPath: STOP_HOOK_PATH,
    contentBase64: Buffer.from(stopHookScript).toString("base64"),
    mode: "755",
  });

  startupCommands.push(
    `echo '[CMUX] MiniMax Claude support enabled. Lifecycle files in ${CLAUDE_LIFECYCLE_DIR}:' && ls -la ${CLAUDE_LIFECYCLE_DIR}/`,
  );

  return {
    files,
    env,
    startupCommands,
    unsetEnv: [...MINIMAX_KEY_ENV_VARS_TO_UNSET],
  };
}
