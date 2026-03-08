import { createTelemetryFileDetector } from "../common/telemetry-file-detector";
import { extractAttributes, chooseAttr } from "../common/telemetry-attributes";

function isCompletionEvent(event: unknown): boolean {
  const attrs = extractAttributes(event);
  if (!attrs) return false;

  const eventName = chooseAttr(attrs, ["event.name", "event_name"]);
  const result = chooseAttr(attrs, ["result"]);

  // Accept both Gemini-style and Qwen-style event namespaces, and a generic suffix.
  const nameOk = Boolean(
    eventName === "gemini_cli.next_speaker_check" ||
      eventName === "qwen_cli.next_speaker_check" ||
      (typeof eventName === "string" &&
        eventName.endsWith(".next_speaker_check"))
  );
  return nameOk && result === "user";
}

// Watch Qwen CLI local telemetry for the "next speaker: user" signal.
// Mirrors the Gemini detector but targets a Qwen-specific outfile.
export function startQwenCompletionDetector(taskRunId: string): Promise<void> {
  return createTelemetryFileDetector({
    telemetryPath: `/tmp/qwen-telemetry-${taskRunId}.log`,
    isCompletionEvent,
  });
}
