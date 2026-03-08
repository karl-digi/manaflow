import { createFileMarkerDetector } from "../common/file-marker-detector";

const DONE_FILE_PATH = "/root/lifecycle/codex-done.txt";
const MARKER_FILENAME = "codex-done.txt";

export async function createCodexDetector(options: {
  taskRunId: string;
  startTime: number;
  workingDir?: string;
}): Promise<void> {
  console.log(`[Codex Detector] Starting for task ${options.taskRunId}`);
  console.log(`[Codex Detector] Watching for ${DONE_FILE_PATH}`);

  await createFileMarkerDetector({
    markerPath: DONE_FILE_PATH,
    watchDir: "/root/lifecycle",
    markerFilename: MARKER_FILENAME,
    onComplete: () => {
      const elapsedMs = Date.now() - options.startTime;
      console.log(`[Codex Detector] Task completed after ${elapsedMs}ms`);
      console.log(`[Codex Detector] Stopped watching ${DONE_FILE_PATH}`);
    },
  });
}

export function startCodexCompletionDetector(taskRunId: string): Promise<void> {
  return createCodexDetector({
    taskRunId,
    startTime: Date.now(),
  });
}
