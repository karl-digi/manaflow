/**
 * Agent SDK Spawner - S0 Spike Integration
 *
 * This module provides an alternative agent spawning method using the Claude Agent SDK
 * for programmatic control of agents. Unlike the PTY-based approach in agentSpawner.ts,
 * this uses the SDK's streaming API with hooks for observability.
 *
 * Status: SPIKE - Not yet integrated into main spawn flow
 * Branch: spike/s0-agent-sdk
 *
 * Key differences from PTY-based spawning:
 * - Programmatic control via TypeScript API
 * - Built-in hooks (PreToolUse, PostToolUse) for observability
 * - Structured output extraction
 * - No tmux/PTY dependency
 *
 * Current limitations:
 * - Uses unstable_v2_* API (subject to change)
 * - Requires claude binary in PATH
 * - No VSCode integration (headless only)
 */

import type { Id } from "@cmux/convex/dataModel";
import type { AgentConfig } from "@cmux/shared/agentConfig";
import type {
  SDKMessage,
  HookCallback,
  PreToolUseHookInput,
  PostToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { unstable_v2_createSession } from "@anthropic-ai/claude-agent-sdk";
import { serverLogger } from "./utils/fileLogger";
import { env, getWwwBaseUrl } from "./utils/server-env";

/**
 * Tool usage record for observability
 */
interface ToolUsageRecord {
  toolName: string;
  toolUseId: string;
  input: unknown;
  output?: unknown;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  error?: string;
}

/**
 * Result from SDK-based agent spawn
 */
export interface SDKSpawnResult {
  success: boolean;
  result?: string;
  toolUsage: ToolUsageRecord[];
  totalCostUsd?: number;
  sessionId?: string;
  error?: string;
}

/**
 * Options for SDK-based agent spawning
 */
export interface SDKSpawnOptions {
  taskDescription: string;
  taskRunId: Id<"taskRuns">;
  taskRunJwt: string;
  agentName: string;
  /** Claude model to use (defaults to claude-sonnet-4-5-20250929) */
  model?: string;
  workingDirectory?: string;
  allowedTools?: string[];
  onMessage?: (msg: SDKMessage) => void | Promise<void>;
  onToolUse?: (record: ToolUsageRecord) => void | Promise<void>;
}

/**
 * Spawn an agent using the Claude Agent SDK.
 *
 * This is an alternative to PTY-based spawning that provides:
 * - Programmatic control via TypeScript
 * - Hooks for tool usage observability
 * - Structured output extraction
 *
 * @param agent - Agent configuration (name, model, etc.)
 * @param options - Spawn options including task description and callbacks
 * @returns Promise<SDKSpawnResult> with result and tool usage stats
 */
export async function spawnAgentWithSDK(
  agent: AgentConfig,
  options: SDKSpawnOptions
): Promise<SDKSpawnResult> {
  const toolUsageLog: ToolUsageRecord[] = [];
  const model = options.model ?? "claude-sonnet-4-5-20250929";

  serverLogger.info(`[AgentSpawnerSDK] Starting SDK-based spawn for ${agent.name}`, {
    taskRunId: options.taskRunId,
    model,
  });

  // Create PreToolUse hook for observability
  const preToolUseHook: HookCallback = async (input, toolUseID) => {
    const hookInput = input as PreToolUseHookInput;

    const record: ToolUsageRecord = {
      toolName: hookInput.tool_name,
      toolUseId: toolUseID ?? `unknown-${Date.now()}`,
      input: hookInput.tool_input,
      startTime: Date.now(),
    };

    toolUsageLog.push(record);

    serverLogger.debug(`[AgentSpawnerSDK] PreToolUse: ${hookInput.tool_name}`, {
      toolUseId: toolUseID,
      taskRunId: options.taskRunId,
    });

    // Notify caller if callback provided
    if (options.onToolUse) {
      await options.onToolUse(record);
    }

    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "allow" as const,
      },
    };
  };

  // Create PostToolUse hook for observability
  const postToolUseHook: HookCallback = async (input, toolUseID) => {
    const hookInput = input as PostToolUseHookInput;

    // Find and update the matching record
    const record = toolUsageLog.find(
      (r) => r.toolUseId === toolUseID && !r.endTime
    );

    if (record) {
      record.endTime = Date.now();
      record.durationMs = record.endTime - record.startTime;
      record.output = hookInput.tool_response;

      serverLogger.debug(
        `[AgentSpawnerSDK] PostToolUse: ${hookInput.tool_name} (${record.durationMs}ms)`,
        {
          toolUseId: toolUseID,
          taskRunId: options.taskRunId,
        }
      );

      // Notify caller if callback provided
      if (options.onToolUse) {
        await options.onToolUse(record);
      }
    }

    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse" as const,
      },
    };
  };

  const cmuxServerUrl =
    env.CMUX_SERVER_URL
    ?? process.env.BASE_APP_URL
    ?? "http://localhost:9776";

  // Create SDK session with hooks
  const session = unstable_v2_createSession({
    model,
    permissionMode: "acceptEdits",
    allowedTools: options.allowedTools ?? [
      "Read",
      "Write",
      "Edit",
      "Bash",
      "Glob",
      "Grep",
    ],
    env: {
      // Preserve existing environment
      ...(process.env as Record<string, string>),
      // cmux-specific env vars
      CMUX_TASK_RUN_ID: options.taskRunId,
      CMUX_AGENT_NAME: options.agentName,
      CMUX_TASK_RUN_JWT: options.taskRunJwt,
      CMUX_CALLBACK_URL: getWwwBaseUrl(),
      CMUX_SERVER_URL: cmuxServerUrl, // devsh CLI target (apps/server HTTP API)
    },
    hooks: {
      PreToolUse: [{ hooks: [preToolUseHook] }],
      PostToolUse: [{ hooks: [postToolUseHook] }],
    },
  });

  try {
    // Send the task description
    await session.send(options.taskDescription);

    let result: string | undefined;
    let sessionId: string | undefined;
    let totalCostUsd: number | undefined;

    // Stream messages
    for await (const msg of session.stream()) {
      sessionId = msg.session_id;

      // Notify caller if callback provided (caller can handle Convex logging)
      if (options.onMessage) {
        await options.onMessage(msg);
      }

      // Extract result from completion
      if (msg.type === "result") {
        if (msg.subtype === "success") {
          result = msg.result;
          totalCostUsd = msg.total_cost_usd;
        } else {
          serverLogger.error(`[AgentSpawnerSDK] Agent failed`, {
            taskRunId: options.taskRunId,
            error: msg.subtype,
          });
        }
        break;
      }
    }

    serverLogger.info(`[AgentSpawnerSDK] Spawn complete for ${agent.name}`, {
      taskRunId: options.taskRunId,
      toolCount: toolUsageLog.length,
      totalCostUsd,
      sessionId,
    });

    return {
      success: true,
      result,
      toolUsage: toolUsageLog,
      totalCostUsd,
      sessionId,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    serverLogger.error(`[AgentSpawnerSDK] Spawn failed`, {
      taskRunId: options.taskRunId,
      error: errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
      toolUsage: toolUsageLog,
    };
  } finally {
    session.close();
  }
}

/**
 * Format an SDK message for logging to Convex
 */
function formatMessageForLog(msg: SDKMessage): string {
  if (msg.type === "assistant") {
    // Only log the text content, not tool calls
    return msg.message?.content
      ?.filter((c) => c.type === "text")
      .map((c) => (c as { type: "text"; text: string }).text)
      .join("\n") ?? "";
  }
  return "";
}

/**
 * Extract structured JSON from agent output.
 *
 * @param output - Raw text output from agent
 * @returns Parsed JSON object or null if no JSON found
 */
export function extractStructuredOutput<T>(output: string): T | null {
  // Look for JSON object in the response
  const jsonMatch = output.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as T;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Generate a tool usage summary from tool records.
 */
export function summarizeToolUsage(
  toolUsage: ToolUsageRecord[]
): Record<string, { count: number; totalMs: number; avgMs: number }> {
  const summary: Record<string, { count: number; totalMs: number; avgMs: number }> = {};

  for (const record of toolUsage) {
    if (!summary[record.toolName]) {
      summary[record.toolName] = { count: 0, totalMs: 0, avgMs: 0 };
    }
    summary[record.toolName].count++;
    summary[record.toolName].totalMs += record.durationMs ?? 0;
  }

  for (const tool of Object.keys(summary)) {
    summary[tool].avgMs = Math.round(
      summary[tool].totalMs / summary[tool].count
    );
  }

  return summary;
}
