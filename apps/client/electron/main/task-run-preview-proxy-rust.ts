import { randomBytes } from "node:crypto";
import type { Session, WebContents } from "electron";
import {
  start_preview_proxy,
  stop_preview_proxy,
  configure_preview_proxy_context,
  release_preview_proxy_context,
  get_proxy_credentials_for_web_contents,
  set_preview_proxy_logging_enabled,
} from "@cmux/native-core";
import type { Logger } from "./chrome-camouflage";

const TASK_RUN_PREVIEW_PREFIX = "task-run-preview:";
const DEFAULT_PROXY_LOGGING_ENABLED = false;

let proxyPort: number | null = null;
let startingProxy: Promise<number> | null = null;
let proxyLogger: Logger | null = null;

export function setPreviewProxyLoggingEnabled(enabled: boolean): void {
  void set_preview_proxy_logging_enabled(Boolean(enabled));
}

export function isTaskRunPreviewPersistKey(
  key: string | undefined
): key is string {
  return typeof key === "string" && key.startsWith(TASK_RUN_PREVIEW_PREFIX);
}

export function getPreviewPartitionForPersistKey(
  key: string | undefined
): string | null {
  if (!isTaskRunPreviewPersistKey(key)) {
    return null;
  }
  const crypto = require("node:crypto");
  const hash = crypto
    .createHash("sha256")
    .update(key)
    .digest("hex")
    .slice(0, 24);
  return `persist:cmux-preview-${hash}`;
}

export async function getProxyCredentialsForWebContents(
  id: number
): Promise<{ username: string; password: string } | null> {
  try {
    const creds = await get_proxy_credentials_for_web_contents(id);
    return creds ?? null;
  } catch (error) {
    console.error("Failed to get proxy credentials", error);
    return null;
  }
}

export async function releasePreviewProxy(webContentsId: number): Promise<void> {
  try {
    await release_preview_proxy_context(webContentsId);
  } catch (error) {
    console.error("Failed to release preview proxy context", error);
  }
}

interface ConfigureOptions {
  webContents: WebContents;
  initialUrl: string;
  persistKey?: string;
  logger: Logger;
}

export async function configurePreviewProxyForView(
  options: ConfigureOptions
): Promise<() => void> {
  const { webContents, initialUrl, persistKey, logger } = options;

  const port = await ensureProxyServer(logger);
  const username = `wc-${webContents.id}-${randomBytes(4).toString("hex")}`;
  const password = randomBytes(12).toString("hex");

  try {
    await configure_preview_proxy_context({
      username,
      password,
      initial_url: initialUrl,
      web_contents_id: webContents.id,
      persist_key: persistKey,
    });
  } catch (error) {
    logger.warn("Failed to configure preview proxy context", { error });
    throw error;
  }

  try {
    await webContents.session.setProxy({
      proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`,
      proxyBypassRules: "<-loopback>",
    });
  } catch (error) {
    await release_preview_proxy_context(webContents.id);
    logger.warn("Failed to configure preview proxy in session", { error });
    throw error;
  }

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    void releasePreviewProxy(webContents.id);
  };

  webContents.once("destroyed", cleanup);
  logger.log("Configured preview proxy (Rust)", {
    webContentsId: webContents.id,
    persistKey,
    port,
  });
  return cleanup;
}

export async function startPreviewProxy(logger: Logger): Promise<number> {
  return ensureProxyServer(logger);
}

async function ensureProxyServer(logger: Logger): Promise<number> {
  if (proxyPort !== null) {
    return proxyPort;
  }
  if (startingProxy) {
    return startingProxy;
  }
  startingProxy = startProxyServer(logger);
  try {
    const port = await startingProxy;
    proxyPort = port;
    return port;
  } finally {
    startingProxy = null;
  }
}

async function startProxyServer(logger: Logger): Promise<number> {
  proxyLogger = logger;

  try {
    const port = await start_preview_proxy();
    console.log(`[cmux-preview-proxy-rust] listening on port ${port}`);
    logger.log("Preview proxy (Rust) listening", { port });

    // Set default logging state
    await set_preview_proxy_logging_enabled(DEFAULT_PROXY_LOGGING_ENABLED);

    return port;
  } catch (error) {
    logger.error("Failed to start preview proxy (Rust)", { error });
    throw error;
  }
}

export async function stopPreviewProxy(): Promise<void> {
  try {
    await stop_preview_proxy();
    proxyPort = null;
    proxyLogger = null;
    console.log("[cmux-preview-proxy-rust] stopped");
  } catch (error) {
    console.error("Failed to stop preview proxy", error);
  }
}
