import { createTelemetryFileDetector } from "../common/telemetry-file-detector";
import { extractAttributes, chooseAttr } from "../common/telemetry-attributes";
import { getGeminiTelemetryPath } from "./telemetry";

type CompletionSignal =
  | "next_speaker_ready"
  | "agent_goal"
  | "complete_task"
  | "conversation_finished";

function classifyTelemetryEvent(event: unknown): CompletionSignal | null {
  const attrs = extractAttributes(event);
  if (!attrs) return null;

  const eventName = chooseAttr(attrs, ["event.name", "event_name"]);
  if (!eventName) return null;

  if (eventName === "gemini_cli.next_speaker_check") {
    const result = chooseAttr(attrs, ["result"]);
    if (result === "user") {
      return "next_speaker_ready";
    }
    return null;
  }

  if (eventName === "gemini_cli.tool_call") {
    const fnName = chooseAttr(attrs, [
      "function_name",
      "functionName",
      "function",
    ]);
    if (fnName === "complete_task") {
      return "complete_task";
    }
    return null;
  }

  if (eventName === "gemini_cli.agent.finish") {
    const terminateReason = chooseAttr(attrs, [
      "terminate_reason",
      "terminateReason",
    ]);
    if (terminateReason === "GOAL") {
      return "agent_goal";
    }
    return null;
  }

  if (eventName === "gemini_cli.conversation_finished") {
    return "conversation_finished";
  }

  return null;
}

export function startGeminiCompletionDetector(
  taskRunId: string
): Promise<void> {
  return createTelemetryFileDetector({
    telemetryPath: getGeminiTelemetryPath(taskRunId),
    isCompletionEvent: (event) => classifyTelemetryEvent(event) !== null,
  });
}
