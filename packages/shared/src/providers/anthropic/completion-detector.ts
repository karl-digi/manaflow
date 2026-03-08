import { createFileMarkerDetector } from "../common/file-marker-detector";

export function startClaudeCompletionDetector(
  taskRunId: string
): Promise<void> {
  const markerFilename = `claude-complete-${taskRunId}`;
  return createFileMarkerDetector({
    markerPath: `/root/lifecycle/${markerFilename}`,
    watchDir: "/root/lifecycle",
    markerFilename,
  });
}
