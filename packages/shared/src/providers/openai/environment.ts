import type {
  EnvironmentContext,
  EnvironmentResult,
} from "../common/environment-result";
import {
  getMemoryStartupCommand,
  getMemorySeedFiles,
  getMemoryProtocolInstructions,
} from "../../agent-memory-protocol";

/**
 * Apply API keys for OpenAI Codex.
 *
 * Priority order:
 * 1. CODEX_AUTH_JSON - If provided, inject as ~/.codex/auth.json (OAuth tokens from `codex auth`)
 * 2. OPENAI_API_KEY - Fallback if no auth.json, injected as environment variable
 *
 * When CODEX_AUTH_JSON is provided, OPENAI_API_KEY is ignored since auth.json
 * contains OAuth tokens that Codex CLI prefers over API keys.
 */
export function applyCodexApiKeys(
  keys: Record<string, string>
): Partial<EnvironmentResult> {
  const files: EnvironmentResult["files"] = [];
  const env: Record<string, string> = {};

  const authJson = keys.CODEX_AUTH_JSON;
  if (authJson) {
    // Validate that it's valid JSON before injecting
    try {
      JSON.parse(authJson);
      files.push({
        destinationPath: "$HOME/.codex/auth.json",
        contentBase64: Buffer.from(authJson).toString("base64"),
        mode: "600",
      });
      // Don't inject OPENAI_API_KEY when auth.json is provided
      return { files, env };
    } catch {
      console.warn("CODEX_AUTH_JSON is not valid JSON, skipping injection");
    }
  }

  // Fallback: inject OPENAI_API_KEY as environment variable
  // Also set CODEX_API_KEY to the same value to skip the sign-in screen
  // (OPENAI_API_KEY only pre-fills the input, CODEX_API_KEY bypasses it entirely)
  const openaiKey = keys.OPENAI_API_KEY;
  if (openaiKey) {
    env.OPENAI_API_KEY = openaiKey;
    env.CODEX_API_KEY = openaiKey;
  }

  return { files, env };
}

// Keys to filter from user's config.toml (controlled by cmux CLI args)
const FILTERED_CONFIG_KEYS = ["model", "model_reasoning_effort"] as const;

// Strip top-level keys that are controlled by cmux CLI args
// Matches: key = "value" or key = 'value' or key = bareword (entire line)
export function stripFilteredConfigKeys(toml: string): string {
  let result = toml;
  for (const key of FILTERED_CONFIG_KEYS) {
    // Match key at start of line (not in a section), with any value format
    // Handles: model = "gpt-5.2", model_reasoning_effort = "high", etc.
    result = result.replace(new RegExp(`^${key}\\s*=\\s*.*$`, "gm"), "");
  }
  // Clean up multiple blank lines
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

// Target model for migrations - change this when a new latest model is released
const MIGRATION_TARGET_MODEL = "gpt-5.2-codex";

// Models to migrate (legacy models and models without model_reasoning_effort support)
const MODELS_TO_MIGRATE = [
  "gpt-5.1-codex-max",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5",
  "o3",
  "o4-mini",
  "gpt-4.1",
  "gpt-5-codex",
  "gpt-5-codex-mini",
];

// Generate model_migrations TOML section
function generateModelMigrations(): string {
  const migrations = MODELS_TO_MIGRATE.map(
    (model) => `"${model}" = "${MIGRATION_TARGET_MODEL}"`
  ).join("\n");
  return `\n[notice.model_migrations]\n${migrations}\n`;
}

// Strip existing [notice.model_migrations] section from TOML
// Regex matches from [notice.model_migrations] to next section header or EOF
function stripModelMigrations(toml: string): string {
  return toml.replace(/\[notice\.model_migrations\][\s\S]*?(?=\n\[|$)/g, "");
}

export async function getOpenAIEnvironment(
  ctx: EnvironmentContext
): Promise<EnvironmentResult> {
  // These must be lazy since configs are imported into the browser
  const { readFile } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  const { Buffer } = await import("node:buffer");

  const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();

  const files: EnvironmentResult["files"] = [];
  const env: Record<string, string> = {};
  const startupCommands: string[] = [];

  // Ensure .codex directory exists
  startupCommands.push("mkdir -p ~/.codex");
  // Ensure notify sink starts clean for this run; write JSONL under /root/lifecycle
  startupCommands.push("mkdir -p /root/lifecycle");
  startupCommands.push(
    "rm -f /root/workspace/.cmux/tmp/codex-turns.jsonl /root/workspace/codex-turns.jsonl /root/workspace/logs/codex-turns.jsonl /tmp/codex-turns.jsonl /tmp/cmux/codex-turns.jsonl /root/lifecycle/codex-turns.jsonl || true"
  );

  // Add a small notify handler script that appends the payload to JSONL and marks completion
  // Note: crown/complete is called by the worker after the completion detector resolves,
  // NOT here. The notify hook fires on every turn, not just task completion.
  // Memory sync runs on every turn (idempotent upsert captures intermediate progress).
  const notifyScript = `#!/usr/bin/env sh
set -eu
echo "$1" >> /root/lifecycle/codex-turns.jsonl
# Sync memory files to Convex (best-effort, idempotent upsert)
/root/lifecycle/memory/sync.sh >> /root/lifecycle/memory-sync.log 2>&1 || true
touch /root/lifecycle/codex-done.txt /root/lifecycle/done.txt
`;
  files.push({
    destinationPath: "/root/lifecycle/codex-notify.sh",
    contentBase64: Buffer.from(notifyScript).toString("base64"),
    mode: "755",
  });

  // Copy auth.json from .codex directory
  try {
    const authContent = await readFile(`${homeDir}/.codex/auth.json`, "utf-8");
    files.push({
      destinationPath: "$HOME/.codex/auth.json",
      contentBase64: Buffer.from(authContent).toString("base64"),
      mode: "600",
    });
  } catch (error) {
    console.warn("Failed to read .codex/auth.json:", error);
  }

  // Copy instructions.md and append memory protocol instructions
  let instructionsContent = "";
  try {
    instructionsContent = await readFile(
      `${homeDir}/.codex/instructions.md`,
      "utf-8"
    );
  } catch (error) {
    // File doesn't exist, start with empty content
    console.warn("Failed to read .codex/instructions.md:", error);
  }

  // Append memory protocol instructions
  const fullInstructions =
    instructionsContent +
    (instructionsContent ? "\n\n" : "") +
    getMemoryProtocolInstructions();
  files.push({
    destinationPath: "$HOME/.codex/instructions.md",
    contentBase64: Buffer.from(fullInstructions).toString("base64"),
    mode: "644",
  });

  // Ensure config.toml exists and contains notify hook + model migrations
  try {
    const rawToml = await readFile(`${homeDir}/.codex/config.toml`, "utf-8");
    // Filter out keys controlled by cmux CLI args (model, model_reasoning_effort)
    const filteredToml = stripFilteredConfigKeys(rawToml);
    const hasNotify = /(^|\n)\s*notify\s*=/.test(filteredToml);
    let tomlOut = hasNotify
      ? filteredToml
      : `notify = ["/root/lifecycle/codex-notify.sh"]\n` + filteredToml;
    // Strip existing model_migrations and append managed ones
    tomlOut = stripModelMigrations(tomlOut) + generateModelMigrations();
    files.push({
      destinationPath: `$HOME/.codex/config.toml`,
      contentBase64: Buffer.from(tomlOut).toString("base64"),
      mode: "644",
    });
  } catch (_error) {
    // No host config.toml; create minimal one with notify + model migrations
    const toml =
      `notify = ["/root/lifecycle/codex-notify.sh"]\n` + generateModelMigrations();
    files.push({
      destinationPath: `$HOME/.codex/config.toml`,
      contentBase64: Buffer.from(toml).toString("base64"),
      mode: "644",
    });
  }

  // Add agent memory protocol support
  startupCommands.push(getMemoryStartupCommand());
  files.push(...getMemorySeedFiles(ctx.taskRunId, ctx.previousKnowledge));

  return { files, env, startupCommands };
}
