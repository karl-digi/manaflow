import { createHash } from "node:crypto";
import type { Session, WebContents } from "electron";
import type { Logger } from "./chrome-camouflage";
import {
  loadNativeCoreModule,
  type NativeCoreModule,
  type PreviewProxyCredentials,
  type PreviewProxyRegisterOptions,
} from "../../../server/src/native/core";

const TASK_RUN_PREVIEW_PREFIX = "task-run-preview:";

interface PreviewProxyContext {
  session: Session;
  credentials: PreviewProxyCredentials;
  persistKey?: string | null;
}

let previewProxyPort: number | null = null;
let nativeCore: NativeCoreModule | null = null;

const contextsByWebContentsId = new Map<number, PreviewProxyContext>();

function getNative(): NativeCoreModule {
  if (!nativeCore) {
    nativeCore = loadNativeCoreModule();
  }
  if (!nativeCore) {
    throw new Error("@cmux/native-core not built or failed to load");
  }
  return nativeCore;
}

export function setPreviewProxyLoggingEnabled(enabled: boolean): void {
  const native = getNative();
  native.previewProxySetLoggingEnabled?.(enabled);
}

export function isTaskRunPreviewPersistKey(
  key: string | undefined,
): key is string {
  return typeof key === "string" && key.startsWith(TASK_RUN_PREVIEW_PREFIX);
}

export function getPreviewPartitionForPersistKey(
  key: string | undefined,
): string | null {
  if (!isTaskRunPreviewPersistKey(key)) {
    return null;
  }
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 24);
  return `persist:cmux-preview-${hash}`;
}

export function getProxyCredentialsForWebContents(
  id: number,
): { username: string; password: string } | null {
  const context = contextsByWebContentsId.get(id);
  if (!context) {
    return null;
  }
  return {
    username: context.credentials.username,
    password: context.credentials.password,
  };
}

export function releasePreviewProxy(webContentsId: number): void {
  const context = contextsByWebContentsId.get(webContentsId);
  if (!context) {
    return;
  }
  contextsByWebContentsId.delete(webContentsId);
  try {
    getNative().previewProxyReleaseContext?.(webContentsId);
  } catch (error) {
    console.warn("Failed to release native preview proxy context", error);
  }
  void context.session.setProxy({ mode: "direct" }).catch((error) => {
    console.error("Failed to reset preview proxy session", error);
  });
}

export async function configurePreviewProxyForView(options: {
  webContents: WebContents;
  initialUrl: string;
  persistKey?: string;
  logger: Logger;
}): Promise<() => void> {
  const native = getNative();
  if (!native.previewProxyRegisterContext) {
    throw new Error("Native previewProxyRegisterContext not available");
  }
  if (previewProxyPort === null) {
    throw new Error("Preview proxy has not been started");
  }

  const registerOptions: PreviewProxyRegisterOptions = {
    webContentsId: options.webContents.id,
    initialUrl: options.initialUrl,
    persistKey: options.persistKey ?? null,
  };
  const credentials = native.previewProxyRegisterContext(registerOptions);
  if (!credentials) {
    options.logger.warn("Preview proxy skipped; unable to derive route", {
      persistKey: options.persistKey,
      url: options.initialUrl,
    });
    return () => {};
  }

  contextsByWebContentsId.set(options.webContents.id, {
    session: options.webContents.session,
    credentials,
    persistKey: options.persistKey,
  });

  try {
    await options.webContents.session.setProxy({
      proxyRules: `http=127.0.0.1:${previewProxyPort};https=127.0.0.1:${previewProxyPort}`,
      proxyBypassRules: "<-loopback>",
    });
  } catch (error) {
    contextsByWebContentsId.delete(options.webContents.id);
    native.previewProxyReleaseContext?.(options.webContents.id);
    options.logger.warn("Failed to configure preview proxy", { error });
    throw error;
  }

  let cleanedUp = false;
  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    releasePreviewProxy(options.webContents.id);
  };
}

export async function startPreviewProxy(logger: Logger): Promise<number> {
  const native = getNative();
  if (!native.previewProxyStart) {
    throw new Error("Native previewProxyStart not available");
  }
  const port = await native.previewProxyStart({
    startPort: 39_385,
    maxAttempts: 50,
  });
  previewProxyPort = port;
  logger.log("Preview proxy listening", { port });
  return port;
}
