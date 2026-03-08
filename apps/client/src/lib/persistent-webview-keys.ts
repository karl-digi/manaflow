import { persistentIframeManager } from "./persistentIframeManager";

const TASK_RUN_PREFIX = "task-run:";
const TASK_RUN_PREVIEW_PREFIX = "task-run-preview:";
const TASK_RUN_PULL_REQUEST_PREFIX = "task-run-pr:";
const TASK_RUN_BROWSER_PREFIX = "task-run-browser:";

export function getTaskRunPersistKey(taskRunId: string): string {
  return `${TASK_RUN_PREFIX}${taskRunId}`;
}

export function getTaskRunPreviewPersistKey(
  taskRunId: string,
  port: string | number
): string {
  return `${TASK_RUN_PREVIEW_PREFIX}${taskRunId}:${String(port)}`;
}

export function getTaskRunPullRequestPersistKey(taskRunId: string): string {
  return `${TASK_RUN_PULL_REQUEST_PREFIX}${taskRunId}`;
}

export function getTaskRunBrowserPersistKey(taskRunId: string): string {
  return `${TASK_RUN_BROWSER_PREFIX}${taskRunId}`;
}

/**
 * Remove all cached iframes associated with a task run.
 * Call this when archiving a task to prevent Wake on HTTP from
 * being triggered by cached iframes making HTTP requests to the VM.
 */
export function cleanupTaskRunIframes(taskRunId: string): void {
  const loadedKeys = persistentIframeManager.getLoadedKeys();

  // Remove all iframes that belong to this task run
  for (const key of loadedKeys) {
    if (
      key === getTaskRunPersistKey(taskRunId) ||
      key === getTaskRunBrowserPersistKey(taskRunId) ||
      key === getTaskRunPullRequestPersistKey(taskRunId) ||
      key.startsWith(`${TASK_RUN_PREVIEW_PREFIX}${taskRunId}:`)
    ) {
      persistentIframeManager.removeIframe(key);
    }
  }
}
