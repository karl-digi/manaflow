import type { FSWatcher } from "node:fs";
import type { CompletionEvent } from "./completion-detector";

/**
 * Advanced completion detector that allows handling multiple event types.
 * This provides a more flexible API for monitoring various Gemini CLI telemetry events.
 *
 * Usage example:
 * ```typescript
 * const detector = createAdvancedGeminiCompletionDetector(taskRunId, {
 *   onNextSpeakerCheck: (event) => {
 *     console.log(`Turn complete, waiting for ${event.data.result}`);
 *   },
 *   onAgentFinish: (event) => {
 *     console.log(`Agent finished: ${event.data.terminateReason}`);
 *   },
 *   onConversationFinished: (event) => {
 *     console.log(`Conversation ended after ${event.data.turnCount} turns`);
 *   }
 * });
 *
 * // Start watching
 * await detector.start();
 *
 * // Stop watching
 * detector.stop();
 * ```
 */

export interface CompletionDetectorCallbacks {
  /** Called when gemini_cli.next_speaker_check event occurs with result="user" or "model" */
  onNextSpeakerCheck?: (event: CompletionEvent) => void;
  /** Called when complete_task tool call is detected */
  onAgentCompleteTask?: (event: CompletionEvent) => void;
  /** Called when gemini_cli.agent.finish event occurs */
  onAgentFinish?: (event: CompletionEvent) => void;
  /** Called when gemini_cli.conversation_finished event occurs */
  onConversationFinished?: (event: CompletionEvent) => void;
  /** Called for any unhandled telemetry event (useful for debugging) */
  onOtherEvent?: (event: unknown) => void;
}

export interface AdvancedCompletionDetector {
  /** Start watching the telemetry file */
  start(): Promise<void>;
  /** Stop watching and clean up resources */
  stop(): void;
  /** Check if detector is currently watching */
  isWatching(): boolean;
}

export function createAdvancedGeminiCompletionDetector(
  taskRunId: string,
  callbacks: CompletionDetectorCallbacks
): AdvancedCompletionDetector {
  const telemetryPath = `/tmp/gemini-telemetry-${taskRunId}.log`;
  let fileWatcher: FSWatcher | null = null;
  let dirWatcher: FSWatcher | null = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
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
  };

  const start = async () => {
    const path = await import("node:path");
    const fs = await import("node:fs");
    const { watch, createReadStream, promises: fsp } = fs;

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
     * Detect and dispatch telemetry events to appropriate callbacks
     */
    const handleEvent = (event: unknown) => {
      if (!event || typeof event !== "object") {
        callbacks.onOtherEvent?.(event);
        return;
      }

      const anyEvent = event as Record<string, unknown>;
      const attrs =
        (anyEvent.attributes as Record<string, unknown>) ||
        (anyEvent.resource &&
          (anyEvent.resource as Record<string, unknown>).attributes) ||
        (anyEvent.body &&
          (anyEvent.body as Record<string, unknown>).attributes);

      if (!attrs || typeof attrs !== "object") {
        callbacks.onOtherEvent?.(event);
        return;
      }

      const eventName =
        (attrs as Record<string, unknown>)["event.name"] ||
        (attrs as Record<string, unknown>)["event_name"];

      // Handle next_speaker_check events
      if (
        eventName === "gemini_cli.next_speaker_check" &&
        callbacks.onNextSpeakerCheck
      ) {
        const result = (attrs as Record<string, unknown>).result as
          | string
          | undefined;
        const finishReason = (attrs as Record<string, unknown>)
          .finish_reason as string | undefined;

        // Report both "user" and "model" results
        // result="user" means Gemini is done and waiting for user
        // result="model" means CLI will auto-send another "continue" prompt
        if (result === "user" || result === "model") {
          callbacks.onNextSpeakerCheck({
            type: "next_speaker_check",
            data: {
              eventName: eventName as string,
              result,
              finishReason,
            },
          });
          return;
        }
      }

      // Handle complete_task tool calls
      if (
        eventName === "gemini_cli.tool_call" &&
        callbacks.onAgentCompleteTask
      ) {
        const functionName = (attrs as Record<string, unknown>)
          .function_name as string | undefined;
        if (functionName === "complete_task") {
          callbacks.onAgentCompleteTask({
            type: "agent_complete_task",
            data: {
              eventName: eventName as string,
              functionName,
            },
          });
          return;
        }
      }

      // Handle agent.finish events
      if (
        eventName === "gemini_cli.agent.finish" &&
        callbacks.onAgentFinish
      ) {
        const terminateReason = (attrs as Record<string, unknown>)
          .terminate_reason as string | undefined;
        const turnCount = (attrs as Record<string, unknown>).turn_count as
          | number
          | undefined;
        const durationMs = (attrs as Record<string, unknown>).duration_ms as
          | number
          | undefined;

        callbacks.onAgentFinish({
          type: "agent_finish",
          data: {
            eventName: eventName as string,
            terminateReason,
            turnCount,
            durationMs,
          },
        });
        return;
      }

      // Handle conversation_finished events
      if (
        eventName === "gemini_cli.conversation_finished" &&
        callbacks.onConversationFinished
      ) {
        const turnCount = (attrs as Record<string, unknown>).turn_count as
          | number
          | undefined;

        callbacks.onConversationFinished({
          type: "conversation_finished",
          data: {
            eventName: eventName as string,
            turnCount,
          },
        });
        return;
      }

      // If we reach here, it's an event we don't specifically handle
      callbacks.onOtherEvent?.(event);
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
            if (stopped) return;
            const text =
              typeof chunk === "string" ? chunk : chunk.toString("utf-8");
            feed(text, (obj) => {
              try {
                if (!stopped) {
                  handleEvent(obj);
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
  };

  return {
    start,
    stop,
    isWatching: () => !stopped,
  };
}

/**
 * Helper function to create a completion detector that resolves when a specific event occurs.
 * This is useful for simple use cases where you just want to wait for one type of event.
 */
export function waitForGeminiEvent(
  taskRunId: string,
  eventType: "next_speaker_check" | "agent_finish" | "conversation_finished",
  predicate?: (event: CompletionEvent) => boolean
): Promise<CompletionEvent> {
  return new Promise((resolve) => {
    const callbacks: CompletionDetectorCallbacks = {};

    const checkAndResolve = (event: CompletionEvent) => {
      if (!predicate || predicate(event)) {
        detector.stop();
        resolve(event);
      }
    };

    switch (eventType) {
      case "next_speaker_check":
        callbacks.onNextSpeakerCheck = checkAndResolve;
        break;
      case "agent_finish":
        callbacks.onAgentFinish = checkAndResolve;
        break;
      case "conversation_finished":
        callbacks.onConversationFinished = checkAndResolve;
        break;
    }

    const detector = createAdvancedGeminiCompletionDetector(
      taskRunId,
      callbacks
    );
    void detector.start();
  });
}

/**
 * Wait for Gemini to hand control back to the user.
 * This is the most common use case - wait until result="user" in next_speaker_check.
 */
export function waitForUserTurn(taskRunId: string): Promise<CompletionEvent> {
  return waitForGeminiEvent(
    taskRunId,
    "next_speaker_check",
    (event) => event.data.result === "user"
  );
}

/**
 * Wait for agent to finish with a specific terminate reason.
 */
export function waitForAgentFinish(
  taskRunId: string,
  terminateReason: "GOAL" | "TIMEOUT" | "ERROR" | string = "GOAL"
): Promise<CompletionEvent> {
  return waitForGeminiEvent(
    taskRunId,
    "agent_finish",
    (event) => event.data.terminateReason === terminateReason
  );
}
