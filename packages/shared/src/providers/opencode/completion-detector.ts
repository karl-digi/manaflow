import { createFileMarkerDetector } from "../common/file-marker-detector";

export function startOpenCodeCompletionDetector(
  taskRunId: string
): Promise<void> {
  const markerFilename = `opencode-complete-${taskRunId}`;
  return createFileMarkerDetector({
    markerPath: `/root/lifecycle/${markerFilename}`,
    watchDir: "/root/lifecycle",
    markerFilename,
  });
}
