const TASK_RUN_PREFIX = "task-run:";
const TASK_RUN_PREVIEW_PREFIX = "task-run-preview:";
const TASK_RUN_PULL_REQUEST_PREFIX = "task-run-pr:";
const TASK_RUN_BROWSER_PREFIX = "task-run-browser:";
const TASK_RUN_BROWSER_WEBCONTENTS_PREFIX =
  "task-run-browser-webcontents:";

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

export function getTaskRunBrowserWebContentsPersistKey(
  taskRunId: string
): string {
  return `${TASK_RUN_BROWSER_WEBCONTENTS_PREFIX}${taskRunId}`;
}
