import type { FSWatcher } from "node:fs";

/**
 * Detection signals for Gemini CLI completion:
 * 1. gemini_cli.next_speaker_check with result="user" - Turn complete, waiting for user input
 * 2. gemini_cli.tool_call with function_name="complete_task" - Task completion tool call
 * 3. gemini_cli.agent.finish with terminate_reason="GOAL" - Agent finished successfully
 * 4. gemini_cli.conversation_finished - Session-wide teardown
 */

export type CompletionEventType =
  | "next_speaker_check"
  | "agent_complete_task"
  | "agent_finish"
  | "conversation_finished";

export interface CompletionEvent {
  type: CompletionEventType;
  data: {
    eventName?: string;
    result?: string;
    functionName?: string;
    terminateReason?: string;
    finishReason?: string;
    turnCount?: number;
    durationMs?: number;
  };
}

export function startGeminiCompletionDetector(
  taskRunId: string
): Promise<void> {
  const telemetryPath = `/tmp/gemini-telemetry-${taskRunId}.log`;
  let fileWatcher: FSWatcher | null = null;
  let dirWatcher: FSWatcher | null = null;

  return new Promise<void>((resolve) => {
    void (async () => {
      const path = await import("node:path");
      const fs = await import("node:fs");
      const { watch, createReadStream, promises: fsp } = fs;

      let stopped = false;
      let lastSize = 0;

      const dir = path.dirname(telemetryPath);
      const file = path.basename(telemetryPath);

      // Lightweight JSON object stream parser for concatenated objects
      let buf = "";
      let depth = 0;
      let inString = false;
      let escape = false;
      const feed = (chunk: string, onObject: (obj: unknown) => void) => {
        for (let i = 0; i < chunk.length; i++) {
          const ch = chunk[i];
          if (inString) {
            buf += ch;
            if (escape) {
              escape = false;
            } else if (ch === "\\") {
              escape = true;
            } else if (ch === '"') {
              inString = false;
            }
            continue;
          }
          if (ch === '"') {
            inString = true;
            if (depth > 0) buf += ch;
            continue;
          }
          if (ch === "{") {
            depth++;
            buf += ch;
            continue;
          }
          if (ch === "}") {
            depth--;
            buf += ch;
            if (depth === 0) {
              try {
                const obj = JSON.parse(buf);
                onObject(obj);
              } catch {
                // ignore
              }
              buf = "";
            }
            continue;
          }
          if (depth > 0) buf += ch;
        }
      };

      /**
       * Check if event represents a completion signal.
       * Returns the detected event or null if not a completion event.
       */
      const detectCompletionEvent = (
        event: unknown
      ): CompletionEvent | null => {
        if (!event || typeof event !== "object") return null;
        const anyEvent = event as Record<string, unknown>;
        const attrs =
          (anyEvent.attributes as Record<string, unknown>) ||
          (anyEvent.resource &&
            (anyEvent.resource as Record<string, unknown>).attributes) ||
          (anyEvent.body &&
            (anyEvent.body as Record<string, unknown>).attributes);
        if (!attrs || typeof attrs !== "object") return null;

        const eventName =
          (attrs as Record<string, unknown>)["event.name"] ||
          (attrs as Record<string, unknown>)["event_name"];

        // 1. Check for next_speaker_check with result="user"
        // This fires when Gemini is done and waiting for user input
        if (eventName === "gemini_cli.next_speaker_check") {
          const result = (attrs as Record<string, unknown>).result as
            | string
            | undefined;
          const finishReason = (attrs as Record<string, unknown>)
            .finish_reason as string | undefined;

          if (result === "user") {
            return {
              type: "next_speaker_check",
              data: {
                eventName: eventName as string,
                result,
                finishReason,
              },
            };
          }
        }

        // 2. Check for complete_task tool call
        // This is emitted when the agent calls the complete_task function
        if (eventName === "gemini_cli.tool_call") {
          const functionName = (attrs as Record<string, unknown>)
            .function_name as string | undefined;
          if (functionName === "complete_task") {
            return {
              type: "agent_complete_task",
              data: {
                eventName: eventName as string,
                functionName,
              },
            };
          }
        }

        // 3. Check for agent.finish event
        // This fires when an agent task completes with details about the outcome
        if (eventName === "gemini_cli.agent.finish") {
          const terminateReason = (attrs as Record<string, unknown>)
            .terminate_reason as string | undefined;
          const turnCount = (attrs as Record<string, unknown>).turn_count as
            | number
            | undefined;
          const durationMs = (attrs as Record<string, unknown>).duration_ms as
            | number
            | undefined;

          return {
            type: "agent_finish",
            data: {
              eventName: eventName as string,
              terminateReason,
              turnCount,
              durationMs,
            },
          };
        }

        // 4. Check for conversation_finished
        // This marks session-wide teardown
        if (eventName === "gemini_cli.conversation_finished") {
          const turnCount = (attrs as Record<string, unknown>).turn_count as
            | number
            | undefined;

          return {
            type: "conversation_finished",
            data: {
              eventName: eventName as string,
              turnCount,
            },
          };
        }

        return null;
      };

      const isCompletionEvent = (event: unknown): boolean => {
        const detected = detectCompletionEvent(event);
        // Only treat next_speaker_check as completion for now
        // to maintain backward compatibility
        return detected?.type === "next_speaker_check";
      };

      const readNew = async (initial = false) => {
        try {
          const st = await fsp.stat(telemetryPath);
          const start = initial ? 0 : lastSize;
          if (st.size <= start) {
            lastSize = st.size;
            return;
          }
          const end = st.size - 1;
          await new Promise<void>((r) => {
            const rs = createReadStream(telemetryPath, {
              start,
              end,
              encoding: "utf-8",
            });
            rs.on("data", (chunk: string | Buffer) => {
              const text =
                typeof chunk === "string" ? chunk : chunk.toString("utf-8");
              feed(text, (obj) => {
                try {
                  if (!stopped && isCompletionEvent(obj)) {
                    stopped = true;
                    try {
                      fileWatcher?.close();
                    } catch {
                      // ignore
                    }
                    try {
                      dirWatcher?.close();
                    } catch {
                      // ignore
                    }
                    resolve();
                  }
                } catch {
                  // ignore
                }
              });
            });
            rs.on("end", () => r());
            rs.on("error", () => r());
          });
          lastSize = st.size;
        } catch {
          // until file exists
        }
      };

      const attachFileWatcher = async () => {
        try {
          const st = await fsp.stat(telemetryPath);
          lastSize = st.size;
          await readNew(true);
          fileWatcher = watch(
            telemetryPath,
            { persistent: false, encoding: "utf8" },
            (eventType: string) => {
              if (!stopped && eventType === "change") {
                void readNew(false);
              }
            }
          );
        } catch {
          // not created yet
        }
      };

      dirWatcher = watch(
        dir,
        { persistent: false, encoding: "utf8" },
        (_eventType: string, filename: string | null) => {
          const name = filename;
          if (!stopped && name === file) {
            void attachFileWatcher();
          }
        }
      );

      void attachFileWatcher();
    })();
  });
}
