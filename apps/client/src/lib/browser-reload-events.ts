const EVENT_NAME = "cmux:browser-reload";

type ReloadDetail = {
  taskRunId: string;
};

/**
 * Emit a browser reload request for the given task run.
 * Consumers (browser panel) will reconnect the VNC viewer when they receive it.
 */
export function emitBrowserReload(taskRunId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ReloadDetail>(EVENT_NAME, { detail: { taskRunId } }));
}

/**
 * Subscribe to browser reload requests. Returns an unsubscribe function.
 */
export function addBrowserReloadListener(
  listener: (taskRunId: string) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ReloadDetail>).detail;
    if (detail?.taskRunId) {
      listener(detail.taskRunId);
    }
  };

  window.addEventListener(EVENT_NAME, handler as EventListener);
  return () => window.removeEventListener(EVENT_NAME, handler as EventListener);
}
