import type { Id } from "@cmux/convex/dataModel";
import type {
  ServerToWorkerEvents,
  WorkerToServerEvents,
  WorkerUploadFiles,
} from "@cmux/shared";
import type { Socket } from "@cmux/shared/socket";
import chokidar, { type FSWatcher } from "chokidar";
import ignore from "ignore";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { serverLogger } from "./utils/fileLogger";
import { workerUploadFiles } from "./utils/workerUploadFiles";
import { VSCodeInstance } from "./vscode/VSCodeInstance";

type PendingChangeType = "upsert" | "delete";

type SyncSession = {
  localWorkspacePath: string;
  cloudTaskRunId: Id<"taskRuns">;
  watcher: FSWatcher;
  pendingChanges: Map<string, PendingChangeType>;
  debounceMs: number;
  flushTimer: NodeJS.Timeout | null;
  retryTimer: NodeJS.Timeout | null;
  isFlushing: boolean;
  flushQueued: boolean;
  ignored: (candidatePath: string) => boolean;
  lastUnavailableLogAt: number | null;
};

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error
  );
};

const DEFAULT_IGNORE_PATTERNS = [
  ".git/",
  "node_modules/",
  "dist/",
  "build/",
  ".next/",
  "out/",
  ".cache/",
  ".turbo/",
  ".parcel-cache/",
  ".idea/",
  ".vscode/",
  "**/*.log",
];

const REMOTE_WORKSPACE_ROOT = "/root/workspace";
const DEFAULT_DEBOUNCE_MS = 750;
const RETRY_DELAY_MS = 5000;
const MAX_FILES_PER_BATCH = 30;

export class LocalWorkspaceSyncManager {
  private sessions: Map<string, SyncSession> = new Map();

  async startSync({
    localWorkspacePath,
    cloudTaskRunId,
    debounceMs = DEFAULT_DEBOUNCE_MS,
  }: {
    localWorkspacePath: string;
    cloudTaskRunId: Id<"taskRuns">;
    debounceMs?: number;
  }): Promise<void> {
    const resolvedPath = path.resolve(localWorkspacePath);
    const existing = this.sessions.get(resolvedPath);
    if (existing) {
      existing.cloudTaskRunId = cloudTaskRunId;
      return;
    }

    const ignored = await this.buildIgnoreMatcher(resolvedPath);
    const watcher = chokidar.watch(resolvedPath, {
      ignored,
      persistent: true,
      ignoreInitial: true,
      depth: 8,
      usePolling: false,
      awaitWriteFinish: {
        stabilityThreshold: 400,
        pollInterval: 100,
      },
      followSymlinks: false,
      atomic: false,
    });

    const session: SyncSession = {
      localWorkspacePath: resolvedPath,
      cloudTaskRunId,
      watcher,
      pendingChanges: new Map(),
      debounceMs,
      flushTimer: null,
      retryTimer: null,
      isFlushing: false,
      flushQueued: false,
      ignored,
      lastUnavailableLogAt: null,
    };

    watcher.on("add", (filePath) => {
      this.queueChange(session, filePath, "upsert");
    });

    watcher.on("change", (filePath) => {
      this.queueChange(session, filePath, "upsert");
    });

    watcher.on("unlink", (filePath) => {
      this.queueChange(session, filePath, "delete");
    });

    watcher.on("error", (error) => {
      serverLogger.error(
        `[LocalWorkspaceSync] Watcher error for ${resolvedPath}:`,
        error
      );
    });

    watcher.on("ready", () => {
      serverLogger.info(
        `[LocalWorkspaceSync] Watching ${resolvedPath} for cloud sync`
      );
    });

    this.sessions.set(resolvedPath, session);
  }

  stopSync(localWorkspacePath: string): void {
    const resolvedPath = path.resolve(localWorkspacePath);
    const session = this.sessions.get(resolvedPath);
    if (!session) {
      return;
    }

    session.watcher.close();
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
    }
    if (session.retryTimer) {
      clearTimeout(session.retryTimer);
    }

    this.sessions.delete(resolvedPath);
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      session.watcher.close();
      if (session.flushTimer) {
        clearTimeout(session.flushTimer);
      }
      if (session.retryTimer) {
        clearTimeout(session.retryTimer);
      }
    }
    this.sessions.clear();
  }

  private async buildIgnoreMatcher(
    workspacePath: string
  ): Promise<(candidatePath: string) => boolean> {
    const ig = ignore();
    try {
      const contents = await fs.readFile(
        path.join(workspacePath, ".gitignore"),
        "utf8"
      );
      ig.add(contents.split("\n"));
    } catch {
      // Ignore missing gitignore
    }

    ig.add(DEFAULT_IGNORE_PATTERNS);

    return (candidatePath: string): boolean => {
      const relative = path.relative(workspacePath, candidatePath);
      if (relative.startsWith("..")) {
        return true;
      }
      if (relative === "" || relative === ".") {
        return false;
      }
      const relPath = relative.replace(/\\/g, "/");
      return ig.ignores(relPath);
    };
  }

  private queueChange(
    session: SyncSession,
    filePath: string,
    changeType: PendingChangeType
  ): void {
    if (!this.sessions.has(session.localWorkspacePath)) {
      return;
    }

    if (session.ignored(filePath)) {
      return;
    }

    const relativePath = path.relative(session.localWorkspacePath, filePath);
    if (
      relativePath === "" ||
      relativePath === "." ||
      relativePath.startsWith("..")
    ) {
      return;
    }

    const relPosix = relativePath.replace(/\\/g, "/");
    session.pendingChanges.set(relPosix, changeType);

    if (session.isFlushing) {
      session.flushQueued = true;
      return;
    }

    this.scheduleFlush(session);
  }

  private scheduleFlush(session: SyncSession): void {
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
    }

    session.flushTimer = setTimeout(() => {
      session.flushTimer = null;
      void this.flush(session);
    }, session.debounceMs);
  }

  private scheduleRetry(session: SyncSession): void {
    if (session.retryTimer) {
      return;
    }

    session.retryTimer = setTimeout(() => {
      session.retryTimer = null;
      void this.flush(session);
    }, RETRY_DELAY_MS);
  }

  private getWorkerSocket(
    cloudTaskRunId: Id<"taskRuns">
  ): Socket<WorkerToServerEvents, ServerToWorkerEvents> | null {
    const instance = VSCodeInstance.getInstance(cloudTaskRunId);
    if (!instance) {
      return null;
    }
    if (!instance.isWorkerConnected()) {
      return null;
    }
    try {
      return instance.getWorkerSocket();
    } catch {
      return null;
    }
  }

  private async flush(session: SyncSession): Promise<void> {
    if (!this.sessions.has(session.localWorkspacePath)) {
      return;
    }

    if (session.isFlushing) {
      session.flushQueued = true;
      return;
    }

    const workerSocket = this.getWorkerSocket(session.cloudTaskRunId);
    if (!workerSocket) {
      const now = Date.now();
      if (
        session.lastUnavailableLogAt === null ||
        now - session.lastUnavailableLogAt > 30_000
      ) {
        serverLogger.warn(
          `[LocalWorkspaceSync] Worker unavailable for ${session.localWorkspacePath}; retrying...`
        );
        session.lastUnavailableLogAt = now;
      }
      this.scheduleRetry(session);
      return;
    }

    if (session.pendingChanges.size === 0) {
      return;
    }

    session.isFlushing = true;
    session.flushQueued = false;
    const pendingEntries = Array.from(session.pendingChanges.entries());
    session.pendingChanges.clear();

    const uploads: WorkerUploadFiles["files"] = [];
    const deletePaths: string[] = [];

    for (const [relativePath, changeType] of pendingEntries) {
      const localPath = path.join(session.localWorkspacePath, relativePath);
      const remotePath = path.posix.join(
        REMOTE_WORKSPACE_ROOT,
        relativePath.replace(/\\/g, "/")
      );

      if (changeType === "delete") {
        deletePaths.push(remotePath);
        continue;
      }

      try {
        const stats = await fs.stat(localPath);
        if (!stats.isFile()) {
          continue;
        }
        const content = await fs.readFile(localPath);
        const mode = (stats.mode & 0o777).toString(8);
        uploads.push({
          sourcePath: localPath,
          destinationPath: remotePath,
          content: content.toString("base64"),
          mode,
        });
      } catch (error) {
        if (isErrnoException(error) && error.code === "ENOENT") {
          deletePaths.push(remotePath);
          continue;
        }
        serverLogger.warn(
          `[LocalWorkspaceSync] Failed reading ${localPath}:`,
          error
        );
      }
    }

    try {
      if (deletePaths.length > 0) {
        await workerUploadFiles({
          workerSocket,
          payload: { files: [], deletePaths },
          timeout: 30_000,
        });
      }

      for (let i = 0; i < uploads.length; i += MAX_FILES_PER_BATCH) {
        const batch = uploads.slice(i, i + MAX_FILES_PER_BATCH);
        await workerUploadFiles({
          workerSocket,
          payload: { files: batch },
          timeout: 30_000,
        });
      }
    } catch (error) {
      serverLogger.error(
        `[LocalWorkspaceSync] Failed syncing ${session.localWorkspacePath}:`,
        error
      );
      for (const [relativePath, changeType] of pendingEntries) {
        session.pendingChanges.set(relativePath, changeType);
      }
      this.scheduleRetry(session);
    } finally {
      session.isFlushing = false;
      if (session.flushQueued || session.pendingChanges.size > 0) {
        this.scheduleFlush(session);
      }
    }
  }
}
