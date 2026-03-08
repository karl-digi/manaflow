import { createTelemetryFileDetector } from "../common/telemetry-file-detector";
import { extractAttributes, chooseAttr } from "../common/telemetry-attributes";

function isCompletionEvent(event: unknown): boolean {
  const attrs = extractAttributes(event);
  if (!attrs) return false;

  const eventName = chooseAttr(attrs, ["event.name", "event_name"]);
  const result = chooseAttr(attrs, ["result"]);

  const nameOk = Boolean(
    eventName === "grok_cli.next_speaker_check" ||
      eventName === "qwen_cli.next_speaker_check" ||
      eventName === "gemini_cli.next_speaker_check" ||
      (typeof eventName === "string" &&
        eventName.endsWith(".next_speaker_check"))
  );

  return nameOk && result === "user";
}

export function startGrokCompletionDetector(taskRunId: string): Promise<void> {
  return createTelemetryFileDetector({
    telemetryPath: `/tmp/grok-telemetry-${taskRunId}.log`,
    isCompletionEvent,
  });
}
