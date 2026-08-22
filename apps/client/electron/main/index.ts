import path, { join } from "node:path";
import { mkdtemp, writeFile, chmod, stat, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import { is } from "@electron-toolkit/utils";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  MenuItem,
  nativeImage,
  net,
  session,
  shell,
  type BrowserWindowConstructorOptions,
  type MenuItemConstructorOptions,
} from "electron";
import { startEmbeddedServer } from "./embedded-server";
import { registerWebContentsViewHandlers } from "./web-contents-view";
import { registerGlobalContextMenu } from "./context-menu";
import electronUpdater, {
  type UpdateCheckResult,
  type UpdateInfo,
} from "electron-updater";
import semver from "semver";
import {
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { collectAllLogs } from "./log-management/collect-logs";
import { ensureLogDirectory } from "./log-management/log-paths";
import {
  appendLogWithRotation,
  type LogRotationOptions,
} from "./log-management/log-rotation";
const { autoUpdater } = electronUpdater;

import util from "node:util";
import { initCmdK, keyDebug } from "./cmdk";
import { env } from "./electron-main-env";
import {
  getProxyCredentialsForWebContents,
  startPreviewProxy,
} from "./task-run-preview-proxy";
import {
  buildTrustedProxyDomainSet,
  isTrustedProxyHostname,
  normalizeBrowserUrl,
} from "@cmux/shared";
import {
  ELECTRON_WINDOW_FOCUS_EVENT,
  type ElectronRendererEventMap,
} from "../../src/types/electron-events";
import { CertificateManager } from "./preview-proxy-certs";
import {
  buildStackAuthCookieSpecs,
  isStackAuthCookieName,
} from "./stack-auth-cookies";
import { computeSetAsDefaultProtocolClientCall } from "./protocol-registration";
import {
  buildSpaOrigins,
  classifyAuthWindowNavigation,
  classifyMainWindowNavigation,
  isSpaAuthCallback,
  isSpaOrigin,
  type AuthNavDecision,
} from "./electron-auth-navigation";
import {
  MCP_HOST_CONFIG_IPC_CHANNELS,
  readClaudeJsonConfig,
  readCodexTomlConfig,
  readOpencodeJsonConfig,
  type HostMcpFileResult,
} from "./mcp-host-config";
import { getMobileMachineInfo } from "./mobile-machine-info";
import {
  buildLocalClaudePluginDevCommand,
  type LocalClaudePluginDevLaunchRequest,
  type LocalTerminalTarget,
} from "../../src/lib/local-claude-plugin-dev";
import {
  LEGACY_ELECTRON_PARTITION,
  resolveElectronPartition,
} from "./electron-partition";

// Use a cookieable HTTPS origin intercepted locally instead of a custom scheme.
const PARTITION = resolveElectronPartition({
  isPackaged: app.isPackaged,
  override: process.env.CMUX_ELECTRON_PARTITION,
});
const APP_HOST = "cmux.local";
const FRAME_BLOCKING_RESPONSE_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
]);

function resolveMaxSuspendedWebContents(): number | undefined {
  const raw =
    process.env.CMUX_ELECTRON_MAX_SUSPENDED_WEBVIEWS ??
    process.env.CMUX_ELECTRON_MAX_SUSPENDED_WEB_CONTENTS;
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

type AutoUpdateToastPayload = {
  version: string | null;
};

let queuedAutoUpdateToast: AutoUpdateToastPayload | null = null;

// Persistent log files
let logsDir: string | null = null;
let mainLogPath: string | null = null;
let rendererLogPath: string | null = null;

const LOG_ROTATION: LogRotationOptions = {
  maxBytes: 5 * 1024 * 1024,
  maxBackups: 3,
};


let rendererLoaded = false;
let pendingProtocolUrl: string | null = null;
let mainWindow: BrowserWindow | null = null;
/** Dedicated OAuth window (shared partition so Stack cookies land for SPA). */
let authWindow: BrowserWindow | null = null;
let previewReloadMenuItem: MenuItem | null = null;
let previewBackMenuItem: MenuItem | null = null;
let previewForwardMenuItem: MenuItem | null = null;
let previewFocusAddressMenuItem: MenuItem | null = null;
let previewReloadMenuVisible = false;
let historyBackMenuItem: MenuItem | null = null;
let historyForwardMenuItem: MenuItem | null = null;
const previewWebContentsIds = new Set<number>();
const altGrActivePreviewContents = new Set<number>();
let embeddedServerCleanup: (() => Promise<void>) | null = null;
let autoUpdateIntervalId: ReturnType<typeof setInterval> | null = null;

function getCookieMigrationUrl(cookie: Electron.Cookie): string | null {
  const domain = cookie.domain?.startsWith(".")
    ? cookie.domain.slice(1)
    : cookie.domain;
  if (!domain) {
    return null;
  }

  const scheme = cookie.secure ? "https" : "http";
  return `${scheme}://${domain}${cookie.path || "/"}`;
}

async function migrateLegacyDevAuthCookies(
  targetSession: Electron.Session,
): Promise<void> {
  if (app.isPackaged || PARTITION === LEGACY_ELECTRON_PARTITION) {
    return;
  }

  try {
    const targetCookies = await targetSession.cookies.get({});
    if (
      targetCookies.some((cookie) =>
        isStackAuthCookieName(cookie.name, env.NEXT_PUBLIC_STACK_PROJECT_ID),
      )
    ) {
      return;
    }

    const legacySession = session.fromPartition(LEGACY_ELECTRON_PARTITION);
    const legacyAuthCookies = (await legacySession.cookies.get({})).filter(
      (cookie) =>
        isStackAuthCookieName(cookie.name, env.NEXT_PUBLIC_STACK_PROJECT_ID),
    );

    let copiedCount = 0;
    for (const cookie of legacyAuthCookies) {
      const url = getCookieMigrationUrl(cookie);
      if (!url) {
        continue;
      }

      await targetSession.cookies.set({
        url,
        name: cookie.name,
        value: cookie.value,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
        ...(typeof cookie.expirationDate === "number"
          ? { expirationDate: cookie.expirationDate }
          : {}),
      });
      copiedCount += 1;
    }

    if (copiedCount > 0) {
      mainLog("Migrated Stack Auth cookies into isolated development partition", {
        sourcePartition: LEGACY_ELECTRON_PARTITION,
        targetPartition: PARTITION,
        count: copiedCount,
        names: legacyAuthCookies.map((cookie) => cookie.name),
      });
    }
  } catch (error) {
    mainWarn("Failed to migrate legacy development auth cookies", error);
  }
}

function getTimestamp(): string {
  return new Date().toISOString();
}

function ensureLogFiles(): void {
  if (logsDir && mainLogPath && rendererLogPath) return;
  const dir = ensureLogDirectory();
  logsDir = dir;
  mainLogPath = join(dir, "main.log");
  rendererLogPath = join(dir, "renderer.log");
}

function writeMainLogLine(level: "LOG" | "WARN" | "ERROR", line: string): void {
  if (!mainLogPath) ensureLogFiles();
  if (!mainLogPath) return;
  appendLogWithRotation(
    mainLogPath,
    `[${getTimestamp()}] [MAIN] [${level}] ${line}\n`,
    LOG_ROTATION
  );
}

function writeRendererLogLine(
  level: "info" | "warning" | "error" | "debug",
  line: string
): void {
  if (!rendererLogPath) ensureLogFiles();
  if (!rendererLogPath) return;
  appendLogWithRotation(
    rendererLogPath,
    `[${getTimestamp()}] [RENDERER] [${level.toUpperCase()}] ${line}\n`,
    LOG_ROTATION
  );
}

function getActiveBrowserWindow(): BrowserWindow | null {
  const target =
    BrowserWindow.getFocusedWindow() ??
    mainWindow ??
    BrowserWindow.getAllWindows()[0] ??
    null;
  if (!target || target.isDestroyed()) {
    return null;
  }
  return target;
}

function updateHistoryMenuState(target?: BrowserWindow | null): void {
  if (!historyBackMenuItem && !historyForwardMenuItem) return;
  const focusableTarget =
    target && !target.isDestroyed() && target.isFocused() ? target : null;
  const window = focusableTarget ?? getActiveBrowserWindow();
  const contents = window && !window.isDestroyed() ? window.webContents : null;
  const navigationHistory = contents?.navigationHistory;
  const canGoBack = Boolean(navigationHistory?.canGoBack());
  const canGoForward = Boolean(navigationHistory?.canGoForward());
  if (historyBackMenuItem) {
    historyBackMenuItem.enabled = canGoBack;
  }
  if (historyForwardMenuItem) {
    historyForwardMenuItem.enabled = canGoForward;
  }
}

function navigateHistory(direction: "back" | "forward"): void {
  const target = getActiveBrowserWindow();
  if (!target) return;
  const contents = target.webContents;
  const navigationHistory = contents.navigationHistory;
  if (direction === "back") {
    if (navigationHistory.canGoBack()) {
      contents.goBack();
    }
  } else if (direction === "forward" && navigationHistory.canGoForward()) {
    contents.goForward();
  }
  updateHistoryMenuState(target);
}

function getPreviewNavigationAccelerator(key: string): string {
  if (process.platform === "darwin") {
    return `Command+Control+${key}`;
  }
  return `Control+Alt+${key}`;
}

function setupConsoleFileMirrors(): void {
  const orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  } as const;

  console.log = (...args: unknown[]) => {
    try {
      orig.log(...args);
    } finally {
      try {
        writeMainLogLine("LOG", formatArgs(args));
      } catch {
        // ignore
      }
    }
  };
  console.warn = (...args: unknown[]) => {
    try {
      orig.warn(...args);
    } finally {
      try {
        writeMainLogLine("WARN", formatArgs(args));
      } catch {
        // ignore
      }
    }
  };
  console.error = (...args: unknown[]) => {
    try {
      orig.error(...args);
    } finally {
      try {
        writeMainLogLine("ERROR", formatArgs(args));
      } catch {
        // ignore
      }
    }
  };
}

function setupPreviewProxyCertificateTrust(): void {
  // Also whitelist the SPKI for caching purposes (Chromium disables cache on cert errors)
  // Note: This switch must be appended before the app is ready, but we are calling this function
  // inside app.whenReady(). However, for the *next* launch or if we move it, it would be better.
  // Actually, let's just do it here and hope it works for new requests, or move it out.
  // Documentation says "This switch must be set before the app is ready".
  // So we should call a separate function for it.
  
  app.on(
    "certificate-error",
    (event, _webContents, url, error, certificate, callback) => {
      // Trust the self-signed certificate for the preview proxy
      if (
        error === "net::ERR_CERT_AUTHORITY_INVALID" &&
        certificate.issuerName === "Cmux Preview Proxy CA"
      ) {
        event.preventDefault();
        callback(true);
        mainLog("Trusted preview proxy certificate", { url });
      } else {
        callback(false);
      }
    }
  );
}

function setupSpkiWhitelist() {
  try {
    const certManager = new CertificateManager();
    const fingerprint = certManager.getCaSpkiFingerprint();
    app.commandLine.appendSwitch("ignore-certificate-errors-spki-list", fingerprint);
    console.log("[MAIN] Added SPKI whitelist for proxy CA:", fingerprint);
  } catch (error) {
    console.error("[MAIN] Failed to setup SPKI whitelist", error);
  }
}

// Call immediately to ensure it's set before ready
setupSpkiWhitelist();

function resolveResourcePath(rel: string) {
  // Prod: packaged resources directory; Dev: look under client/assets
  if (app.isPackaged) return path.join(process.resourcesPath, rel);
  return path.join(app.getAppPath(), "assets", rel);
}

// Lightweight logger that prints to the main process stdout and mirrors
// into the renderer console (via preload listener) when available.
type LogLevel = "log" | "warn" | "error";
function emitToRenderer(level: LogLevel, message: string) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("main-log", { level, message });
    }
  } catch (error) {
    console.error("Failed to emit to renderer", error);
  }
}

function formatArgs(args: unknown[]): string {
  const ts = new Date().toISOString();
  const body = args
    .map((a) =>
      typeof a === "string" ? a : util.inspect(a, { depth: 3, colors: false })
    )
    .join(" ");
  return `[${ts}] ${body}`;
}

export function mainLog(...args: unknown[]) {
  const line = formatArgs(args);

  console.log("[MAIN]", line);
  emitToRenderer("log", `[MAIN] ${line}`);
}

export function mainWarn(...args: unknown[]) {
  const line = formatArgs(args);

  console.warn("[MAIN]", line);
  emitToRenderer("warn", `[MAIN] ${line}`);
}

export function mainError(...args: unknown[]) {
  const line = formatArgs(args);

  console.error("[MAIN]", line);
  emitToRenderer("error", `[MAIN] ${line}`);
}

function sendShortcutToFocusedWindow(
  eventName: string,
  payload?: unknown
): boolean {
  try {
    const target = getActiveBrowserWindow();
    if (!target) {
      return false;
    }
    target.webContents.send(`cmux:event:shortcut:${eventName}`, payload);
    return true;
  } catch (error) {
    mainWarn("Failed to dispatch shortcut event", { eventName, error });
    return false;
  }
}

function shellEscapeSingleQuotes(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function emitCmuxEventToAllWindows(event: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    try {
      window.webContents.send(`cmux:event:${event}`, payload);
    } catch (error) {
      mainWarn("Failed to emit cmux event to renderer", { event, error });
    }
  }
}

type LocalClaudeRunMetadata = {
  orchestrationId?: string;
  runDir?: string;
  sessionInfoPath?: string;
  sessionId?: string;
  injectionMode?: string;
  lastInjectionAt?: string;
  injectionCount?: number;
};

async function monitorLocalCommandOutcome(
  launchId: string,
  outcomePath: string,
): Promise<void> {
  const fs = await import("node:fs/promises");
  const startedAt = Date.now();
  const timeoutMs = 6 * 60 * 60 * 1000; // 6h

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const raw = await fs.readFile(outcomePath, "utf8");
      const payload = JSON.parse(raw) as {
        launchId: string;
        status: "completed" | "completed_failed";
        exitCode?: number;
        error?: string;
      };
      emitCmuxEventToAllWindows("local-command-finished", payload);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  emitCmuxEventToAllWindows("local-command-finished", {
    launchId,
    status: "completed_failed",
    error: "Timed out waiting for local command outcome",
  });
}

function getDefaultLocalRunArtifactsBaseDir(): string {
  return join(app.getPath("home"), ".devsh", "orchestrations");
}

function buildElectronManagedLocalOrchestrationId(): string {
  return `local_cmux_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

async function readLocalClaudeRunMetadata(
  orchestrationId: string,
): Promise<LocalClaudeRunMetadata | null> {
  const runDir = join(getDefaultLocalRunArtifactsBaseDir(), orchestrationId);

  try {
    const runDirStats = await stat(runDir);
    if (!runDirStats.isDirectory()) {
      return null;
    }
  } catch {
    return null;
  }

  const metadata: LocalClaudeRunMetadata = {
    orchestrationId,
    runDir,
  };

  const sessionInfoPath = join(runDir, "session.json");
  try {
    const sessionInfoStats = await stat(sessionInfoPath);
    if (sessionInfoStats.isFile()) {
      metadata.sessionInfoPath = sessionInfoPath;
      const raw = await readFile(sessionInfoPath, "utf8");
      const parsed = JSON.parse(raw) as {
        sessionId?: string;
        injectionMode?: string;
        lastInjectionAt?: string;
        injectionCount?: number;
      };
      if (typeof parsed.sessionId === "string" && parsed.sessionId.trim()) {
        metadata.sessionId = parsed.sessionId.trim();
      }
      if (typeof parsed.injectionMode === "string" && parsed.injectionMode.trim()) {
        metadata.injectionMode = parsed.injectionMode.trim();
      }
      if (
        typeof parsed.lastInjectionAt === "string" &&
        parsed.lastInjectionAt.trim()
      ) {
        metadata.lastInjectionAt = parsed.lastInjectionAt.trim();
      }
      if (typeof parsed.injectionCount === "number") {
        metadata.injectionCount = parsed.injectionCount;
      }
    }
  } catch {
    // Session info is created asynchronously; tolerate it being absent briefly.
  }

  return metadata;
}

async function waitForLocalClaudeRunMetadata(
  orchestrationId: string,
  timeoutMs: number,
): Promise<LocalClaudeRunMetadata | null> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const metadata = await readLocalClaudeRunMetadata(orchestrationId);
    if (metadata) {
      return metadata;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return null;
}

async function waitForLocalClaudeSessionMetadata(
  launchId: string,
  orchestrationId: string,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const metadata = await readLocalClaudeRunMetadata(orchestrationId);
    if (metadata?.sessionId) {
      emitCmuxEventToAllWindows("local-command-metadata", {
        launchId,
        ...metadata,
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function launchCommandInTerminal(options: {
  command?: string;
  cwd?: string;
  title?: string;
  terminal?: LocalTerminalTarget;
}): Promise<
  | { ok: true; scriptPath?: string; launchId: string }
  | { ok: false; error: string }
> {
  const command =
    typeof options.command === "string" ? options.command.trim() : "";
  const cwd = typeof options.cwd === "string" ? options.cwd.trim() : "";
  const title =
    typeof options.title === "string" ? options.title.trim() : "cmux local run";
  const terminal = options.terminal ?? "terminal";

  if (!command) {
    return { ok: false as const, error: "Command is required" };
  }

  if (process.platform !== "darwin" && terminal !== "alacritty") {
    return {
      ok: false as const,
      error:
        "Local terminal execution currently supports macOS native terminals or Alacritty",
    };
  }

  if (cwd) {
    try {
      const cwdStats = await stat(cwd);
      if (!cwdStats.isDirectory()) {
        return { ok: false as const, error: `Workspace path is not a directory: ${cwd}` };
      }
    } catch {
      return { ok: false as const, error: `Workspace path does not exist: ${cwd}` };
    }
  }

  try {
    const tempDir = await mkdtemp(join(app.getPath("temp"), "cmux-local-run-"));
    const scriptPath = join(tempDir, "run-local-command.command");
    const outcomePath = join(tempDir, "run-local-command.outcome.json");
    const launchId = randomUUID();
    const lines = ["#!/usr/bin/env bash", "set +e"];
    if (cwd) {
      lines.push(`cd ${shellEscapeSingleQuotes(cwd)} || exit 1`);
    }
    lines.push(`printf '\\033]0;%s\\007' ${shellEscapeSingleQuotes(title)}`);
    lines.push(command);
    lines.push("status=$?");
    lines.push("echo");
    lines.push('echo "[cmux] Command exited with status ${status}"');
    lines.push(`cat > ${shellEscapeSingleQuotes(outcomePath)} <<'CMUX_OUTCOME_EOF'`);
    lines.push(
      JSON.stringify({
        launchId,
        status: "completed",
      }),
    );
    lines.push("CMUX_OUTCOME_EOF");
    lines.push(
      `node -e "const fs=require('fs'); const p=${JSON.stringify(
        outcomePath,
      )}; const data=JSON.parse(fs.readFileSync(p,'utf8')); data.status=process.argv[1]==='0'?'completed':'completed_failed'; data.exitCode=Number(process.argv[1]); if(data.exitCode!==0){data.error='Command exited with non-zero status';} fs.writeFileSync(p, JSON.stringify(data));" "$status"`,
    );
    lines.push('exec "${SHELL:-/bin/zsh}" -l');

    await writeFile(scriptPath, `${lines.join("\n")}\n`, "utf8");
    await chmod(scriptPath, 0o755);

    let launchCommand: string;
    let launchArgs: string[];
    switch (terminal) {
      case "iterm":
        launchCommand = "open";
        launchArgs = ["-a", "iTerm", scriptPath];
        break;
      case "ghostty":
        launchCommand = "open";
        launchArgs = ["-a", "Ghostty", scriptPath];
        break;
      case "alacritty":
        launchCommand = "alacritty";
        launchArgs = [
          ...(cwd ? ["--working-directory", cwd] : []),
          "-e",
          "/bin/bash",
          scriptPath,
        ];
        break;
      case "terminal":
      default:
        launchCommand = "open";
        launchArgs = ["-a", "Terminal", scriptPath];
        break;
    }

    const child = spawn(launchCommand, launchArgs, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    void monitorLocalCommandOutcome(launchId, outcomePath);

    return { ok: true as const, scriptPath, launchId };
  } catch (error) {
    mainWarn("Failed to launch local command in Terminal", error);
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function setPreviewReloadMenuVisibility(visible: boolean): void {
  previewReloadMenuVisible = visible;
  const applyVisibility = (item: MenuItem | null) => {
    if (item) {
      item.visible = visible;
    }
  };
  applyVisibility(previewReloadMenuItem);
  applyVisibility(previewBackMenuItem);
  applyVisibility(previewForwardMenuItem);
  applyVisibility(previewFocusAddressMenuItem);
}

ipcMain.on("cmux:get-current-webcontents-id", (event) => {
  event.returnValue = event.sender.id;
});

ipcMain.handle(
  "cmux:ui:set-preview-reload-visible",
  async (_event, visible: unknown) => {
    setPreviewReloadMenuVisibility(Boolean(visible));
    return { ok: true };
  }
);

ipcMain.handle(
  "cmux:local:run-command-in-terminal",
  async (
    _event,
    options: {
      command?: string;
      cwd?: string;
      title?: string;
      terminal?: "terminal" | "iterm" | "ghostty" | "alacritty";
    }
  ) =>
    launchCommandInTerminal(options),
);

ipcMain.handle(
  "cmux:local:launch-claude-plugin-dev",
  async (_event, request: LocalClaudePluginDevLaunchRequest) => {
    const workspacePath =
      typeof request?.workspacePath === "string" ? request.workspacePath.trim() : "";
    const taskDescription =
      typeof request?.taskDescription === "string"
        ? request.taskDescription.trim()
        : "";

    if (!request?.agentName?.trim()) {
      return { ok: false as const, error: "Claude agent is required" };
    }

    if (!workspacePath) {
      return { ok: false as const, error: "Workspace path is required" };
    }

    if (!taskDescription) {
      return { ok: false as const, error: "Task description is required" };
    }

    const normalizedRequest: LocalClaudePluginDevLaunchRequest = {
      ...request,
      workspacePath,
      taskDescription,
    };
    const orchestrationId = buildElectronManagedLocalOrchestrationId();
    const command = buildLocalClaudePluginDevCommand(normalizedRequest);
    const launchedCommand = buildLocalClaudePluginDevCommand(normalizedRequest, {
      orchestrationId,
    });
    const result = await launchCommandInTerminal({
      command: launchedCommand,
      cwd: workspacePath,
      title: "cmux local Claude plugin-dev",
      terminal: normalizedRequest.terminal,
    });
    if (!result.ok) {
      return result;
    }
    const initialMetadata =
      (await waitForLocalClaudeRunMetadata(orchestrationId, 4000)) ?? {
        orchestrationId,
        runDir: join(getDefaultLocalRunArtifactsBaseDir(), orchestrationId),
        sessionInfoPath: join(
          getDefaultLocalRunArtifactsBaseDir(),
          orchestrationId,
          "session.json",
        ),
      };
    if (!initialMetadata.sessionId) {
      void waitForLocalClaudeSessionMetadata(result.launchId, orchestrationId, 120000);
    }
    return {
      ...result,
      command,
      ...initialMetadata,
    };
  },
);

function emitAutoUpdateToastIfPossible(): void {
  if (!queuedAutoUpdateToast) return;
  if (!mainWindow || mainWindow.isDestroyed() || !rendererLoaded) return;
  try {
    mainWindow.webContents.send(
      "cmux:event:auto-update:ready",
      queuedAutoUpdateToast
    );
    queuedAutoUpdateToast = null;
  } catch (error) {
    mainWarn("Failed to send auto-update toast to renderer", error);
  }
}

function queueAutoUpdateToast(payload: AutoUpdateToastPayload): void {
  queuedAutoUpdateToast = payload;
  emitAutoUpdateToastIfPossible();
}

function resolveSemverVersion(value: string | null | undefined): string | null {
  if (!value) return null;
  const valid = semver.valid(value);
  if (valid) return valid;
  const coerced = semver.coerce(value);
  return coerced ? coerced.version : null;
}

function isUpdateNewerThanCurrent(
  info: UpdateInfo | null | undefined
): boolean {
  if (!info) return false;

  const updateVersion = resolveSemverVersion(info.version);
  if (!updateVersion) return false;

  const currentVersion = resolveSemverVersion(app.getVersion());
  if (!currentVersion) {
    return info.version !== app.getVersion();
  }

  const updateParsed = semver.parse(updateVersion);
  const currentParsed = semver.parse(currentVersion);

  if (!updateParsed || !currentParsed) {
    return semver.gt(updateVersion, currentVersion);
  }

  const isNewer = semver.gt(updateParsed, currentParsed);
  if (!isNewer) return false;

  const currentHasPrerelease = currentParsed.prerelease.length > 0;
  const updateHasPrerelease = updateParsed.prerelease.length > 0;
  const sameCoreVersion =
    updateParsed.major === currentParsed.major &&
    updateParsed.minor === currentParsed.minor &&
    updateParsed.patch === currentParsed.patch;

  if (currentHasPrerelease && !updateHasPrerelease && sameCoreVersion) {
    return false;
  }

  return true;
}

function logUpdateCheckResult(
  context: string,
  result: UpdateCheckResult | null | undefined
): void {
  if (!result) {
    mainLog(`${context} completed`, { updateAvailable: false });
    return;
  }

  const info = result.updateInfo;
  const summary = {
    updateAvailable: isUpdateNewerThanCurrent(info),
    version: info?.version ?? null,
    releaseDate: info?.releaseDate ?? null,
    fileCount: info?.files?.length ?? 0,
    stagingPercentage:
      typeof info?.stagingPercentage === "number"
        ? info.stagingPercentage
        : null,
  };

  mainLog(`${context} completed`, summary);
}

function registerLogIpcHandlers(): void {
  ipcMain.handle("cmux:logs:read-all", async () => {
    try {
      return await collectAllLogs();
    } catch (error) {
      mainWarn("Failed to read logs for renderer", error);
      const err = error instanceof Error ? error : new Error(String(error));
      throw err;
    }
  });

  ipcMain.handle("cmux:logs:copy-all", async () => {
    try {
      const { combinedText } = await collectAllLogs();
      clipboard.writeText(combinedText);
      return { ok: true };
    } catch (error) {
      mainWarn("Failed to copy logs for renderer", error);
      const err = error instanceof Error ? error : new Error(String(error));
      throw err;
    }
  });
}

function registerAutoUpdateIpcHandlers(): void {
  ipcMain.handle("cmux:auto-update:check", async () => {
    if (!app.isPackaged) {
      mainLog(
        "Auto-update check requested while app is not packaged; ignoring request"
      );
      return { ok: false, reason: "not-packaged" as const };
    }

    try {
      mainLog("Renderer requested manual checkForUpdates");
      const result = await autoUpdater.checkForUpdates();
      logUpdateCheckResult("Renderer checkForUpdates", result);

      const updateInfo = result?.updateInfo;
      const version =
        updateInfo && typeof updateInfo.version === "string"
          ? updateInfo.version
          : null;

      return {
        ok: true as const,
        updateAvailable: isUpdateNewerThanCurrent(updateInfo),
        version,
      };
    } catch (error) {
      mainWarn("Renderer-initiated checkForUpdates failed", error);
      const err = error instanceof Error ? error : new Error(String(error));
      throw err;
    }
  });

  ipcMain.handle("cmux:auto-update:install", async () => {
    if (!app.isPackaged) {
      mainLog(
        "Auto-update install requested while app is not packaged; ignoring request"
      );
      return { ok: false, reason: "not-packaged" as const };
    }

    try {
      queuedAutoUpdateToast = null;
      autoUpdater.quitAndInstall();
      return { ok: true } as const;
    } catch (error) {
      mainWarn("Failed to trigger quitAndInstall", error);
      const err = error instanceof Error ? error : new Error(String(error));
      throw err;
    }
  });
}

function registerAppIpcHandlers(): void {
  ipcMain.handle("cmux:app:get-protocol-status", async () => {
    try {
      const cmuxProtocol = env.NEXT_PUBLIC_CMUX_PROTOCOL;
      const call = computeSetAsDefaultProtocolClientCall({
        scheme: cmuxProtocol,
        defaultApp: process.defaultApp,
        execPath: process.execPath,
        argv: process.argv,
      });
      let isDefaultProtocolClient = false;
      try {
        isDefaultProtocolClient =
          call.kind === "withArgs"
            ? app.isDefaultProtocolClient(call.scheme, call.execPath, call.args)
            : app.isDefaultProtocolClient(call.scheme);
      } catch (error) {
        mainWarn(`isDefaultProtocolClient(${cmuxProtocol}) failed`, error);
      }

      return {
        ok: true as const,
        scheme: cmuxProtocol,
        isPackaged: app.isPackaged,
        isDefaultProtocolClient,
        // unpackaged electron-vite often fails OS default-handler check even after setAsDefault
        defaultApp: process.defaultApp === true,
      };
    } catch (error) {
      mainWarn("Failed to get protocol status", error);
      return {
        ok: false as const,
        scheme: env.NEXT_PUBLIC_CMUX_PROTOCOL,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("cmux:mobile:get-machine-info", async () => {
    return await getMobileMachineInfo();
  });
}

function registerMcpHostConfigIpcHandlers(): void {
  ipcMain.handle(
    MCP_HOST_CONFIG_IPC_CHANNELS.readClaudeJson,
    (): Promise<HostMcpFileResult> => readClaudeJsonConfig(),
  );
  ipcMain.handle(
    MCP_HOST_CONFIG_IPC_CHANNELS.readCodexToml,
    (): Promise<HostMcpFileResult> => readCodexTomlConfig(),
  );
  ipcMain.handle(
    MCP_HOST_CONFIG_IPC_CHANNELS.readOpencodeJson,
    (): Promise<HostMcpFileResult> => readOpencodeJsonConfig(),
  );
}

function setupAutoUpdates(): void {
  if (!app.isPackaged) {
    mainLog("Skipping auto-updates in development");
    return;
  }

  mainLog("Setting up auto-updates", {
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  });

  try {
    // Wire logs to our logger
    (autoUpdater as unknown as { logger: unknown }).logger = {
      info: (...args: unknown[]) => mainLog("[updater]", ...args),
      warn: (...args: unknown[]) => mainWarn("[updater]", ...args),
      error: (...args: unknown[]) => mainError("[updater]", ...args),
    } as unknown as typeof autoUpdater.logger;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;

    if (process.platform === "darwin") {
      const channel = "latest-universal";
      if (autoUpdater.channel !== channel) {
        autoUpdater.channel = channel;
        mainLog("Configured autoUpdater channel", {
          channel,
          arch: process.arch,
        });
      }
    }

    mainLog("Auto-updater configuration complete", {
      autoDownload: autoUpdater.autoDownload,
      autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit,
      allowPrerelease: autoUpdater.allowPrerelease,
      channel: autoUpdater.channel ?? null,
    });
  } catch (e) {
    mainWarn("Failed to initialize autoUpdater", e);
    return;
  }

  autoUpdater.on("checking-for-update", () => mainLog("Checking for update…"));
  autoUpdater.on("update-available", (info) =>
    mainLog("Update available", info?.version)
  );
  autoUpdater.on("update-not-available", () => mainLog("No updates available"));
  autoUpdater.on("error", (err) => mainWarn("Updater error", err));
  autoUpdater.on("download-progress", (p) =>
    mainLog(
      "Update download progress",
      `${p.percent?.toFixed?.(1) ?? 0}% (${p.transferred}/${p.total})`
    )
  );
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    const version =
      info &&
      typeof info === "object" &&
      "version" in info &&
      typeof info.version === "string"
        ? info.version
        : null;

    if (!isUpdateNewerThanCurrent(info)) {
      mainLog(
        "Ignoring downloaded update that is not newer than current build",
        {
          version,
          currentVersion: app.getVersion(),
        }
      );
      return;
    }

    mainLog("Update downloaded; notifying renderer", { version });
    queueAutoUpdateToast({ version });
  });

  // Initial check and periodic re-checks
  mainLog("Starting initial auto-update check");
  autoUpdater
    .checkForUpdatesAndNotify()
    .then((result) =>
      logUpdateCheckResult("Initial checkForUpdatesAndNotify", result)
    )
    .catch((e) => mainWarn("checkForUpdatesAndNotify failed", e));
  const CHECK_INTERVAL_MS = 30 * 60 * 1000;
  // Store interval ID for cleanup on app quit
  autoUpdateIntervalId = setInterval(() => {
    mainLog("Starting scheduled auto-update check");
    autoUpdater
      .checkForUpdates()
      .then((result) =>
        logUpdateCheckResult("Scheduled checkForUpdates", result)
      )
      .catch((e) => mainWarn("Periodic checkForUpdates failed", e));
  }, CHECK_INTERVAL_MS); // 30 minutes
}

async function handleOrQueueProtocolUrl(url: string) {
  if (mainWindow && rendererLoaded) {
    mainLog("Handling protocol URL immediately", { url });
    await handleProtocolUrl(url);
  } else {
    mainLog("Queueing protocol URL until renderer ready", { url });
    pendingProtocolUrl = url;
  }
}

function getSpaOrigins(): string[] {
  return buildSpaOrigins({
    appHost: APP_HOST,
    electronRendererUrl: process.env["ELECTRON_RENDERER_URL"] ?? null,
  });
}

function getAuthNavOptions() {
  return {
    spaOrigins: getSpaOrigins(),
    // electron-vite dev uses Vite browser history; packaged builds use hash.
    hashRouter: !is.dev,
  };
}

function getMainWindowSpaHomeUrl(): string {
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    return process.env["ELECTRON_RENDERER_URL"];
  }
  return `https://${APP_HOST}/index-electron.html`;
}

function closeAuthWindow(): void {
  if (!authWindow || authWindow.isDestroyed()) {
    authWindow = null;
    return;
  }
  try {
    authWindow.close();
  } catch {
    // ignore
  }
  authWindow = null;
}

/**
 * Apply a navigation decision for a main-frame load on the given webContents.
 * Returns true if the default navigation should be cancelled.
 */
function applyAuthNavDecision(
  decision: AuthNavDecision,
  webContents: Electron.WebContents,
  context: "main" | "auth"
): boolean {
  switch (decision.action) {
    case "allow":
      return false;
    case "rewrite-hash": {
      mainLog("[auth-nav] rewrite-hash", { context, url: decision.url });
      void webContents.loadURL(decision.url);
      return true;
    }
    case "auth-window": {
      mainLog("[auth-nav] open auth-window", { url: decision.url });
      openAuthWindow(decision.url);
      return true;
    }
    case "external": {
      mainLog("[auth-nav] open external", { context, url: decision.url });
      void shell.openExternal(normalizeBrowserUrl(decision.url));
      return true;
    }
    default: {
      const _exhaustive: never = decision;
      return _exhaustive;
    }
  }
}

function openAuthWindow(startUrl: string): void {
  if (authWindow && !authWindow.isDestroyed()) {
    mainLog("[auth-nav] reusing auth window", { url: startUrl });
    void authWindow.loadURL(startUrl);
    authWindow.focus();
    return;
  }

  const authNavOptions = getAuthNavOptions();
  const { spaOrigins } = authNavOptions;
  authWindow = new BrowserWindow({
    width: 520,
    height: 720,
    show: true,
    autoHideMenuBar: true,
    title: "Sign in",
    webPreferences: {
      // Same partition as main so Stack cookies are visible to the SPA.
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const win = authWindow;
  win.on("closed", () => {
    if (authWindow === win) {
      authWindow = null;
    }
  });

  /** SPA OAuth callback → main window URL, or null if not a handoff. */
  const resolveAuthCallbackHandoff = (
    url: string,
    decision: AuthNavDecision
  ): string | null => {
    if (decision.action === "rewrite-hash") {
      return decision.url;
    }
    // Hash-routed SPA callbacks classify as allow; path-form already rewrite-hash.
    if (decision.action === "allow" && isSpaAuthCallback(url, spaOrigins)) {
      return url;
    }
    return null;
  };

  const tryHandoffFromAuthUrl = (
    url: string,
    source: string,
    event?: Electron.Event,
    decision = classifyAuthWindowNavigation(url, authNavOptions)
  ): boolean => {
    const handoffUrl = resolveAuthCallbackHandoff(url, decision);
    if (!handoffUrl) {
      return false;
    }
    event?.preventDefault();
    mainLog("[auth-nav] auth callback → main", { url: handoffUrl, source });
    void loadMainWindowAuthCallback(handoffUrl);
    closeAuthWindow();
    return true;
  };

  const handleAuthNav = (
    event: Electron.Event,
    url: string,
    isMainFrame?: boolean
  ) => {
    if (isMainFrame === false) {
      return;
    }
    const decision = classifyAuthWindowNavigation(url, authNavOptions);
    mainLog("[auth-nav] auth will-navigate", { url, decision: decision.action });

    if (tryHandoffFromAuthUrl(url, "will-navigate", event, decision)) {
      return;
    }

    if (decision.action === "allow") {
      return;
    }

    if (applyAuthNavDecision(decision, win.webContents, "auth")) {
      event.preventDefault();
    }
  };

  win.webContents.on("will-navigate", (event, url) => {
    handleAuthNav(event, url, true);
  });
  // Some OAuth redirects only surface on will-redirect / did-navigate.
  win.webContents.on(
    "will-redirect",
    (event, url, _isInPlace, isMainFrame) => {
      if (isMainFrame === false) {
        return;
      }
      handleAuthNav(event, url, true);
    }
  );
  win.webContents.on("did-navigate", (_event, url) => {
    mainLog("[auth-nav] auth did-navigate", { url });
    void tryHandoffFromAuthUrl(url, "did-navigate");
  });
  win.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (!isMainFrame) {
      return;
    }
    mainLog("[auth-nav] auth did-navigate-in-page", { url });
    void tryHandoffFromAuthUrl(url, "did-navigate-in-page");
  });
  win.webContents.on(
    "did-fail-load",
    (
      _event,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame
    ) => {
      if (!isMainFrame) {
        return;
      }
      mainWarn("[auth-nav] auth did-fail-load", {
        errorCode,
        errorDescription,
        validatedURL,
      });
    }
  );

  win.webContents.setWindowOpenHandler((details) => {
    const targetUrl = normalizeBrowserUrl(details.url);
    const decision = classifyAuthWindowNavigation(targetUrl, authNavOptions);
    const handoffUrl = resolveAuthCallbackHandoff(targetUrl, decision);
    if (handoffUrl) {
      void loadMainWindowAuthCallback(handoffUrl);
      closeAuthWindow();
      return { action: "deny" };
    }
    if (decision.action === "allow") {
      void win.webContents.loadURL(targetUrl);
      return { action: "deny" };
    }
    applyAuthNavDecision(decision, win.webContents, "auth");
    return { action: "deny" };
  });

  mainLog("[auth-nav] creating auth window", { url: startUrl });
  void win.loadURL(startUrl);
}

async function loadMainWindowAuthCallback(url: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWarn("[auth-nav] no main window for auth callback", { url });
    return;
  }
  try {
    await mainWindow.loadURL(url);
    mainWindow.focus();
  } catch (error) {
    mainWarn("[auth-nav] failed to load auth callback on main", {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    // Fallback: reload SPA home so user can retry / session may still sync via cookies
    try {
      await mainWindow.loadURL(getMainWindowSpaHomeUrl());
      mainWindow.focus();
    } catch {
      // ignore
    }
  }
}

function attachMainWindowAuthNavigationGuards(window: BrowserWindow): void {
  const authNavOptions = getAuthNavOptions();
  const contents = window.webContents;

  const onNavigate = (
    event: Electron.Event,
    url: string,
    isMainFrame?: boolean
  ) => {
    if (isMainFrame === false) {
      return;
    }
    const decision = classifyMainWindowNavigation(url, authNavOptions);
    if (decision.action === "allow") {
      return;
    }
    mainLog("[auth-nav] main will-navigate", {
      url,
      decision: decision.action,
    });
    if (applyAuthNavDecision(decision, contents, "main")) {
      event.preventDefault();
    }
  };

  contents.on("will-navigate", (event, url) => {
    onNavigate(event, url, true);
  });
  contents.on("will-redirect", (event, url) => {
    onNavigate(event, url, true);
  });
}

function createWindow(): void {
  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      preload: join(app.getAppPath(), "out/preload/index.cjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      partition: PARTITION,
    },
  };

  // Use only the icon from cmux-logos iconset.
  const iconPng = resolveResourcePath(
    "cmux-logos/cmux.iconset/icon_512x512.png"
  );
  if (process.platform !== "darwin") {
    windowOptions.icon = iconPng;
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Capture renderer console output into renderer.log
  mainWindow.webContents.on(
    "console-message",
    ({ level, lineNumber, message, sourceId }) => {
      const src = sourceId
        ? `${sourceId}${lineNumber ? `:${lineNumber}` : ""}`
        : "";
      const msg = src ? `${message} (${src})` : message;
      writeRendererLogLine(level, msg);
    }
  );

  mainWindow.on("ready-to-show", () => {
    mainLog("Window ready-to-show");
    mainWindow?.show();
  });

  // Socket bridge not required; renderer connects directly

  // Initialize auto-updates
  setupAutoUpdates();

  // Once the renderer is loaded, process any queued deep-link
  mainWindow.webContents.on("did-finish-load", () => {
    mainLog("Renderer finished load");
    rendererLoaded = true;
    if (pendingProtocolUrl) {
      mainLog("Processing queued protocol URL", { url: pendingProtocolUrl });
      void handleProtocolUrl(pendingProtocolUrl);
      pendingProtocolUrl = null;
    }
    emitAutoUpdateToastIfPossible();
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (
      _event,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
      frameProcessId,
      frameRoutingId
    ) => {
      mainWarn("did-fail-load", {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
        frameProcessId,
        frameRoutingId,
      });
    }
  );

  mainWindow.webContents.on("did-navigate", (_e, url) => {
    mainLog("did-navigate", { url });
  });

  // Phase A/B/C1: keep SPA in main window; OAuth goes to dedicated auth window;
  // path /handler/* rewrites to hash router form.
  attachMainWindowAuthNavigationGuards(mainWindow);

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const targetUrl = normalizeBrowserUrl(details.url);
    const authNavOptions = getAuthNavOptions();
    const { spaOrigins } = authNavOptions;
    const decision = classifyMainWindowNavigation(targetUrl, authNavOptions);
    // Always deny popups: SPA stays in main, OAuth uses auth window, else external.
    if (decision.action === "allow" && isSpaOrigin(targetUrl, spaOrigins)) {
      void mainWindow?.loadURL(targetUrl);
      return { action: "deny" };
    }
    if (decision.action === "allow") {
      void shell.openExternal(targetUrl);
      return { action: "deny" };
    }
    // mainWindow may be null/destroyed by the time this deferred popup
    // handler runs (TS18047); deny rather than crash on webContents access.
    if (!mainWindow || mainWindow.isDestroyed()) return { action: "deny" };
    applyAuthNavDecision(decision, mainWindow.webContents, "main");
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    const url = process.env["ELECTRON_RENDERER_URL"]!;
    mainLog("Loading renderer (dev)", { url });
    mainWindow.loadURL(url);
  } else {
    // In production, serve the renderer over HTTPS on a private host which we
    // intercept and back with local files (supports cookies).
    mainLog("Loading renderer (prod)", { host: APP_HOST });
    mainWindow.loadURL(`https://${APP_HOST}/index-electron.html`);
  }
}

app.on("browser-window-created", (_event, window) => {
  const updateForWindow = () => updateHistoryMenuState(window);
  window.webContents.on("did-navigate", updateForWindow);
  window.webContents.on("did-navigate-in-page", updateForWindow);
  window.on("focus", updateForWindow);
  window.on("closed", () => updateHistoryMenuState());
  updateHistoryMenuState(window);
});

app.on("browser-window-focus", (_event, window) => {
  updateHistoryMenuState(window);
  try {
    const payload: ElectronRendererEventMap[typeof ELECTRON_WINDOW_FOCUS_EVENT] =
      { windowId: window.id };
    window.webContents.send(
      `cmux:event:${ELECTRON_WINDOW_FOCUS_EVENT}`,
      payload
    );
  } catch (error) {
    mainWarn("Failed to emit window focus event to renderer", error);
  }
});

app.on("login", (event, webContents, _request, authInfo, callback) => {
  if (!authInfo.isProxy) {
    return;
  }
  const creds = getProxyCredentialsForWebContents(webContents.id);
  if (!creds) {
    return;
  }
  event.preventDefault();
  callback(creds.username, creds.password);
});

app.on("open-url", (_event, url) => {
  handleOrQueueProtocolUrl(url);
});

app.whenReady().then(async () => {
  setupPreviewProxyCertificateTrust();
  ensureLogFiles();
  setupConsoleFileMirrors();
  const disposeContextMenu = registerGlobalContextMenu();
  app.once("will-quit", () => {
    try {
      disposeContextMenu();
    } catch (error) {
      console.error("Failed to dispose context menu", error);
    }

    // Clear auto-update interval to prevent leaks
    if (autoUpdateIntervalId !== null) {
      clearInterval(autoUpdateIntervalId);
      autoUpdateIntervalId = null;
    }

    if (embeddedServerCleanup) {
      embeddedServerCleanup().catch((error) => {
        console.error("Failed to clean up embedded server", error);
      });
      embeddedServerCleanup = null;
    }
  });
  registerLogIpcHandlers();
  registerAutoUpdateIpcHandlers();
  registerAppIpcHandlers();
  registerMcpHostConfigIpcHandlers();
  initCmdK({
    getMainWindow: () => mainWindow,
    logger: {
      log: mainLog,
      warn: mainWarn,
    },
  });

  await startPreviewProxy({
    log: mainLog,
    warn: mainWarn,
    error: mainError,
  });

  // Register before-input-event handlers for preview browser shortcuts
  // These fire before web content sees them, so they work even in WebContentsViews
  app.on("web-contents-created", (_event, contents) => {
    contents.on("before-input-event", (e, input) => {
      if (!previewWebContentsIds.has(contents.id)) return;

      const isMac = process.platform === "darwin";
      if (!isMac) {
        const isAltGrKey =
          input.code === "AltRight" || input.key === "AltGraph";
        if (isAltGrKey) {
          if (input.type === "keyDown") {
            altGrActivePreviewContents.add(contents.id);
          } else if (input.type === "keyUp") {
            altGrActivePreviewContents.delete(contents.id);
          }
        }
      }

      if (input.type !== "keyDown") return;

      // Only handle preview shortcuts when preview is visible
      if (!previewReloadMenuVisible) return;

      const key = input.key.toLowerCase();
      const primaryModifierActive = isMac
        ? input.meta && !input.control && !input.alt && !input.shift
        : input.control && !input.meta && !input.alt && !input.shift;
      const isAltGrActive =
        !isMac && altGrActivePreviewContents.has(contents.id);
      const previewNavModifierActive = isMac
        ? input.meta && input.control && !input.alt && !input.shift
        : input.control &&
          input.alt &&
          !input.meta &&
          !input.shift &&
          !isAltGrActive;

      // cmd+l / ctrl+l: focus address bar
      if (primaryModifierActive && key === "l") {
        e.preventDefault();
        sendShortcutToFocusedWindow("preview-focus-address");
        return;
      }

      // cmd+ctrl+[: go back (mac) / ctrl+alt+[ (others)
      if (previewNavModifierActive && input.key === "[") {
        e.preventDefault();
        sendShortcutToFocusedWindow("preview-back");
        return;
      }

      // cmd+ctrl+]: go forward (mac) / ctrl+alt+] (others)
      if (previewNavModifierActive && input.key === "]") {
        e.preventDefault();
        sendShortcutToFocusedWindow("preview-forward");
        return;
      }

      // cmd+r / ctrl+r: reload
      if (primaryModifierActive && key === "r") {
        e.preventDefault();
        sendShortcutToFocusedWindow("preview-reload");
        return;
      }
    });
  });
  registerWebContentsViewHandlers({
    logger: {
      log: mainLog,
      warn: mainWarn,
      error: mainError,
    },
    maxSuspendedEntries: resolveMaxSuspendedWebContents(),
    onPreviewWebContentsChange: ({ webContentsId, present }) => {
      if (present) {
        previewWebContentsIds.add(webContentsId);
      } else {
        previewWebContentsIds.delete(webContentsId);
        altGrActivePreviewContents.delete(webContentsId);
      }
    },
  });

  // Ensure macOS menu and About panel use "cmux-next" instead of package.json name
  if (process.platform === "darwin") {
    try {
      app.setName("cmux-next");
      app.setAboutPanelOptions({ applicationName: "cmux-next" });
    } catch (error) {
      console.error("Failed to set app name and about panel options", error);
    }
  }

  // Start the embedded IPC server (registers cmux:register and cmux:rpc)
  try {
    mainLog("Starting embedded IPC server...");
    const embeddedServer = await startEmbeddedServer();
    embeddedServerCleanup = embeddedServer.cleanup;
    mainLog("Embedded IPC server started successfully");
  } catch (error) {
    mainError("Failed to start embedded IPC server:", error);
    process.exit(1);
  }

  // Try to register the custom protocol handler with the OS. electron-builder
  // will add CFBundleURLTypes on macOS, but calling this is harmless and also
  // helps on Windows/Linux when packaged.
  // Use env variable for protocol (cmux-dev in dev, cmux-next in prod)
  const cmuxProtocol = env.NEXT_PUBLIC_CMUX_PROTOCOL;
  try {
    const call = computeSetAsDefaultProtocolClientCall({
      scheme: cmuxProtocol,
      defaultApp: process.defaultApp,
      execPath: process.execPath,
      argv: process.argv,
    });
    const ok =
      call.kind === "withArgs"
        ? app.setAsDefaultProtocolClient(call.scheme, call.execPath, call.args)
        : app.setAsDefaultProtocolClient(call.scheme);
    let isDefaultProtocolClient = false;
    try {
      isDefaultProtocolClient =
        call.kind === "withArgs"
          ? app.isDefaultProtocolClient(call.scheme, call.execPath, call.args)
          : app.isDefaultProtocolClient(call.scheme);
    } catch (error) {
      mainWarn(
        `isDefaultProtocolClient(${cmuxProtocol}) failed after registration`,
        error,
      );
    }
    mainLog(`setAsDefaultProtocolClient(${cmuxProtocol})`, {
      ok,
      isDefaultProtocolClient,
      packaged: app.isPackaged,
      defaultApp: process.defaultApp,
      registrationKind: call.kind,
      execPath: call.kind === "withArgs" ? call.execPath : null,
      args: call.kind === "withArgs" ? call.args : null,
    });
  } catch (e) {
    mainWarn("setAsDefaultProtocolClient failed", e);
  }

  // When packaged, electron-vite outputs the renderer to out/renderer
  // which is bundled inside app.asar (referenced by app.getAppPath()).
  const baseDir = path.join(app.getAppPath(), "out", "renderer");

  // Set Dock icon from iconset on macOS.
  if (process.platform === "darwin") {
    const iconPng = resolveResourcePath(
      "cmux-logos/cmux.iconset/icon_512x512.png"
    );
    const img = nativeImage.createFromPath(iconPng);
    if (!img.isEmpty()) app.dock?.setIcon(img);
  }

  const ses = session.fromPartition(PARTITION);
  await migrateLegacyDevAuthCookies(ses);
  const trustedProxyDomains = buildTrustedProxyDomainSet([
    process.env.PVE_PUBLIC_DOMAIN,
  ]);

  ses.webRequest.onHeadersReceived((details, callback) => {
    try {
      const hostname = new URL(details.url).hostname;
      if (!isTrustedProxyHostname(hostname, trustedProxyDomains)) {
        callback({});
        return;
      }
    } catch {
      callback({});
      return;
    }

    const responseHeaders = details.responseHeaders;
    if (!responseHeaders) {
      callback({});
      return;
    }

    const strippedHeaders: Record<string, string[]> = {};
    for (const [headerName, headerValues] of Object.entries(responseHeaders)) {
      if (FRAME_BLOCKING_RESPONSE_HEADERS.has(headerName.toLowerCase())) {
        continue;
      }
      strippedHeaders[headerName] = headerValues;
    }

    callback({ responseHeaders: strippedHeaders });
  });

  const handleCmuxProtocol = async (request: Request): Promise<Response> => {
    const electronReq = request as unknown as Electron.ProtocolRequest;
    const url = new URL(electronReq.url);

    if (url.hostname !== APP_HOST) {
      return net.fetch(request);
    }

    const pathname = url.pathname === "/" ? "/index-electron.html" : url.pathname;
    const fsPath = path.normalize(
      path.join(baseDir, decodeURIComponent(pathname))
    );
    const rel = path.relative(baseDir, fsPath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      mainWarn("Blocked path outside baseDir", { fsPath, baseDir });
      return new Response("Not found", { status: 404 });
    }

    const contentSecurityPolicy =
      "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: ws: wss:; " +
      "connect-src * sentry-ipc:; " +
      "worker-src * blob:; child-src * blob:; frame-src *";

    // Try to fetch the requested file
    try {
      const response = await net.fetch(pathToFileURL(fsPath).toString());
      response.headers.set("Content-Security-Policy", contentSecurityPolicy);
      return response;
    } catch (error) {
      // SPA fallback: if the file doesn't exist and it's not an asset request,
      // serve index-electron.html so the client-side router can handle the route.
      // Asset files (with extensions like .js, .css, etc.) should return 404.
      const hasFileExtension = /\.[a-zA-Z0-9]+$/.test(pathname);
      if (!hasFileExtension) {
        const indexPath = path.join(baseDir, "index-electron.html");
        const fallbackResponse = await net.fetch(pathToFileURL(indexPath).toString());
        fallbackResponse.headers.set("Content-Security-Policy", contentSecurityPolicy);
        return fallbackResponse;
      }
      // Re-throw for asset files to return proper error
      throw error;
    }
  };

  ses.protocol.handle("https", handleCmuxProtocol);
  ses.protocol.handle("http", handleCmuxProtocol);

  // Create the initial window.
  if (BrowserWindow.getAllWindows().length === 0) createWindow();

  // Application menu with Command Palette accelerator; keep Help items.
  try {
    const template: MenuItemConstructorOptions[] = [];
    if (process.platform === "darwin") {
      template.push({ role: "appMenu" });
    } else {
      template.push({ label: "File", submenu: [{ role: "quit" }] });
    }
    const viewMenu: MenuItemConstructorOptions = {
      label: "View",
      submenu: [
        {
          id: "cmux-preview-reload",
          visible: previewReloadMenuVisible,
          label: "Reload Preview",
          accelerator: "CommandOrControl+R",
          click: () => {
            const dispatched = sendShortcutToFocusedWindow("preview-reload");
            if (!dispatched) {
              mainWarn(
                "Reload Preview shortcut triggered with no active renderer"
              );
            }
          },
        },
        {
          id: "cmux-preview-back",
          visible: previewReloadMenuVisible,
          label: "Back",
          accelerator: getPreviewNavigationAccelerator("["),
          click: () => {
            sendShortcutToFocusedWindow("preview-back");
          },
        },
        {
          id: "cmux-preview-forward",
          visible: previewReloadMenuVisible,
          label: "Forward",
          accelerator: getPreviewNavigationAccelerator("]"),
          click: () => {
            sendShortcutToFocusedWindow("preview-forward");
          },
        },
        {
          id: "cmux-preview-focus-address",
          visible: previewReloadMenuVisible,
          label: "Focus Address Bar",
          accelerator: "CommandOrControl+L",
          click: () => {
            sendShortcutToFocusedWindow("preview-focus-address");
          },
        },
        {
          label: "Reload Application",
          click: () => {
            const target = getActiveBrowserWindow();
            target?.webContents.reload();
          },
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    };
    const historyMenu: MenuItemConstructorOptions = {
      label: "History",
      submenu: [
        {
          id: "cmux-history-back",
          label: "Back",
          accelerator: "CommandOrControl+[",
          enabled: false,
          click: () => {
            navigateHistory("back");
          },
        },
        {
          id: "cmux-history-forward",
          label: "Forward",
          accelerator: "CommandOrControl+]",
          enabled: false,
          click: () => {
            navigateHistory("forward");
          },
        },
      ],
    };
    template.push(
      { role: "editMenu" },
      historyMenu,
      {
        label: "Commands",
        submenu: [
          {
            label: "Command Palette…",
            accelerator: "CommandOrControl+K",
            click: () => {
              try {
                const target = getActiveBrowserWindow();
                keyDebug("menu-accelerator-cmdk", {
                  to: target?.webContents.id,
                });
                if (target && !target.isDestroyed()) {
                  target.webContents.send("cmux:event:shortcut:cmd-k");
                }
              } catch (err) {
                mainWarn("Failed to emit Cmd+K from menu accelerator", err);
                keyDebug("menu-accelerator-cmdk-error", { err: String(err) });
              }
            },
          },
        ],
      },
      viewMenu,
      { role: "windowMenu" }
    );
    template.push({
      role: "help",
      submenu: [
        {
          label: "Check for Updates…",
          click: async () => {
            if (!app.isPackaged) {
              await dialog.showMessageBox({
                type: "info",
                message: "Updates are only available in packaged builds.",
              });
              return;
            }
            try {
              mainLog("Manual update check initiated");
              const result = await autoUpdater.checkForUpdates();
              if (!result?.updateInfo) {
                await dialog.showMessageBox({
                  type: "info",
                  message: "You’re up to date.",
                });
              }
            } catch (e) {
              mainWarn("Manual checkForUpdates failed", e);
              await dialog.showMessageBox({
                type: "error",
                message: "Failed to check for updates.",
              });
            }
          },
        },
        {
          label: "Open Logs Folder",
          click: async () => {
            if (!logsDir) ensureLogFiles();
            if (logsDir) await shell.openPath(logsDir);
          },
        },
      ],
    });
    const menu = Menu.buildFromTemplate(template);
    previewReloadMenuItem = menu.getMenuItemById("cmux-preview-reload") ?? null;
    previewBackMenuItem = menu.getMenuItemById("cmux-preview-back") ?? null;
    previewForwardMenuItem =
      menu.getMenuItemById("cmux-preview-forward") ?? null;
    previewFocusAddressMenuItem =
      menu.getMenuItemById("cmux-preview-focus-address") ?? null;
    historyBackMenuItem = menu.getMenuItemById("cmux-history-back") ?? null;
    historyForwardMenuItem =
      menu.getMenuItemById("cmux-history-forward") ?? null;
    setPreviewReloadMenuVisibility(previewReloadMenuVisible);
    updateHistoryMenuState();
    Menu.setApplicationMenu(menu);
  } catch (e) {
    mainWarn("Failed to set application menu", e);
  }

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Simple in-memory cache of RemoteJWKSet by issuer
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksForIssuer(issuer: string) {
  const base = issuer.endsWith("/") ? issuer : issuer + "/";
  // Stack Auth exposes JWKS at <issuer>/.well-known/jwks.json
  const url = new URL(".well-known/jwks.json", base);
  let jwks = jwksCache.get(url.toString());
  if (!jwks) {
    jwks = createRemoteJWKSet(url);
    jwksCache.set(url.toString(), jwks);
  }
  return jwks;
}

async function verifyJwtAndGetPayload(
  token: string
): Promise<JWTPayload | null> {
  // JWT format: three base64url segments separated by dots
  // Opaque tokens (like Stack Auth refresh tokens) don't have this structure
  const parts = token.split(".");
  if (parts.length !== 3) {
    // Not a JWT - likely an opaque token, silently return null
    return null;
  }

  try {
    const decoded = decodeJwt(token);
    const iss = decoded.iss;
    if (!iss) return null;
    const JWKS = jwksForIssuer(iss);
    const { payload } = await jwtVerify(token, JWKS, { issuer: iss });
    return payload;
  } catch {
    // JWT decode/verify failed - return null silently
    // The caller logs a warning if both tokens fail verification
    return null;
  }
}

async function handleProtocolUrl(url: string): Promise<void> {
  if (!mainWindow) {
    // Should not happen due to queuing, but guard anyway
    mainWarn("handleProtocolUrl called with no window; queueing", { url });
    pendingProtocolUrl = url;
    return;
  }

  const urlObj = new URL(url);

  if (urlObj.hostname === "auth-callback") {
    const stackRefresh = urlObj.searchParams.get("stack_refresh");
    const stackAccess = urlObj.searchParams.get("stack_access");

    if (!stackRefresh || !stackAccess) {
      mainWarn("Aborting cookie set due to missing tokens");
      return;
    }

    mainLog("Processing auth-callback deeplink", {
      hasRefresh: !!stackRefresh,
      hasAccess: !!stackAccess,
      refreshLength: stackRefresh.length,
      accessLength: stackAccess.length,
    });

    // Verify refresh token when it looks like a JWT (for logs only). Access token
    // may be a JSON array string (`["refresh","access"]`) so skip verification.
    const refreshPayload = await verifyJwtAndGetPayload(stackRefresh);
    if (!refreshPayload) {
      mainWarn("JWT verification failed - refresh token may be opaque/malformed", {
        refreshLength: stackRefresh.length,
      });
    }

    // Stack Auth SDK expects structured refresh cookies and a paired access cookie
    // value. Using these formats avoids refresh-token rotation issues on Electron.
    const win = mainWindow;
    if (!win) {
      mainWarn("Aborting cookie set due to missing window");
      return;
    }
    const currentUrl = new URL(win.webContents.getURL());
    const cookieOrigin = `${currentUrl.origin}/`;
    const cookieHost = currentUrl.hostname;
    const isSecure = currentUrl.protocol === "https:";
    const cookieSpecs = buildStackAuthCookieSpecs({
      projectId: env.NEXT_PUBLIC_STACK_PROJECT_ID,
      refreshToken: stackRefresh,
      stackAccessParam: stackAccess,
      secure: isSecure,
    });

    // Clear all Stack Auth cookies for this host across all paths. This
    // migrates away from legacy cookie paths (e.g. /index-electron.html) that
    // can prevent Stack Auth from deleting rotated refresh tokens.
    try {
      const allCookies = await win.webContents.session.cookies.get({});
      const relevantCookies = allCookies.filter((cookie) => {
        if (!cookie.domain) return false;
        const domain = cookie.domain?.startsWith(".")
          ? cookie.domain.slice(1)
          : cookie.domain;
        return (
          domain === cookieHost &&
          isStackAuthCookieName(cookie.name, env.NEXT_PUBLIC_STACK_PROJECT_ID)
        );
      });

      if (relevantCookies.length > 0) {
        mainLog("Clearing existing Stack Auth cookies", {
          host: cookieHost,
          count: relevantCookies.length,
          names: relevantCookies.map((c) => c.name),
        });
      }

      await Promise.all(
        relevantCookies.map(async (cookie) => {
          const domain = cookie.domain?.startsWith(".")
            ? cookie.domain.slice(1)
            : cookie.domain;
          if (!domain) return;
          const scheme = cookie.secure
            ? "https"
            : currentUrl.protocol.replace(":", "");
          const removalUrl = `${scheme}://${domain}${cookie.path}`;
          try {
            await win.webContents.session.cookies.remove(removalUrl, cookie.name);
          } catch (removeError) {
            // Best-effort cleanup; don't block login.
            mainWarn("Failed to remove cookie", {
              name: cookie.name,
              removalUrl,
              error: removeError,
            });
          }
        })
      );
    } catch (clearError) {
      mainWarn("Failed to enumerate/clear Stack Auth cookies", clearError);
    }

    mainLog("Setting auth cookies", {
      url: cookieOrigin,
      refreshCookieName: cookieSpecs.refresh.name,
      accessCookieName: cookieSpecs.access.name,
      refreshValueLength: cookieSpecs.refresh.value.length,
      accessValueLength: cookieSpecs.access.value.length,
      secure: isSecure,
    });

    const nowSeconds = Math.floor(Date.now() / 1000);
    try {
      await Promise.all([
        win.webContents.session.cookies.set({
          url: cookieOrigin,
          name: cookieSpecs.refresh.name,
          value: cookieSpecs.refresh.value,
          expirationDate: nowSeconds + cookieSpecs.refresh.maxAgeSeconds,
          sameSite: cookieSpecs.refresh.sameSite,
          secure: cookieSpecs.refresh.secure,
          httpOnly: cookieSpecs.refresh.httpOnly,
          path: cookieSpecs.refresh.path,
        }),
        win.webContents.session.cookies.set({
          url: cookieOrigin,
          name: cookieSpecs.access.name,
          value: cookieSpecs.access.value,
          expirationDate: nowSeconds + cookieSpecs.access.maxAgeSeconds,
          sameSite: cookieSpecs.access.sameSite,
          secure: cookieSpecs.access.secure,
          httpOnly: cookieSpecs.access.httpOnly,
          path: cookieSpecs.access.path,
        }),
        win.webContents.session.cookies.set({
          url: cookieOrigin,
          name: cookieSpecs.isHttps.name,
          value: cookieSpecs.isHttps.value,
          expirationDate: nowSeconds + cookieSpecs.isHttps.maxAgeSeconds,
          sameSite: cookieSpecs.isHttps.sameSite,
          secure: cookieSpecs.isHttps.secure,
          httpOnly: cookieSpecs.isHttps.httpOnly,
          path: cookieSpecs.isHttps.path,
        }),
      ]);
      mainLog("Auth cookies set successfully");
    } catch (cookieError) {
      mainError("Failed to set auth cookies", cookieError);
      return;
    }

    // Navigate to clean base URL to trigger full page reload.
    // Stack Auth SDK needs a fresh page load to pick up the new cookies.
    // Hash navigation alone doesn't cause the SDK to re-initialize.
    const currentUrlObj = new URL(win.webContents.getURL());
    const homeUrl = currentUrlObj.origin;
    mainLog("Navigating to home after auth", { homeUrl });

    // Bring window to front
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();

    // Load home URL - this triggers a full page reload where Stack Auth
    // will pick up the cookies and recognize the authenticated user.
    // The SignInComponent will then hide and the app will show.
    void win.webContents.loadURL(homeUrl);
    return;
  }

  if (urlObj.hostname === "github-connect-complete") {
    try {
      mainLog("Deep link: github-connect-complete", {
        team: urlObj.searchParams.get("team"),
      });
      // Bring app to front and refresh to pick up new connections
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      const team = urlObj.searchParams.get("team");
      try {
        mainWindow.webContents.send("cmux:event:github-connect-complete", {
          team,
        });
      } catch (emitErr) {
        mainWarn("Failed to emit github-connect-complete", emitErr);
      }
    } catch (e) {
      mainWarn("Failed to handle github-connect-complete", e);
    }
    return;
  }
}
