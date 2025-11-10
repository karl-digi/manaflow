import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promises as fs } from "node:fs";

type Logger = {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug?: (message: string, ...args: unknown[]) => void;
};

const VS_CODE_APP_FOLDERS = ["Code", "Code - Insiders", "VSCodium"];

type WorkspaceTrustContent = {
  trustedFolders?: string[];
  [key: string]: unknown;
};

type WorkspaceTrustFile = {
  version?: number;
  content?: WorkspaceTrustContent;
};

export async function trustVSCodeWorkspace(
  workspacePath: string,
  logger: Logger
): Promise<void> {
  const folderUri = await resolveWorkspaceUri(workspacePath);
  if (!folderUri) {
    logger.debug?.("Skipping VS Code trust update; workspace path missing.");
    return;
  }

  const userDirs = await resolveExistingVSCodeUserDirs();
  if (userDirs.length === 0) {
    logger.debug?.("No VS Code user directories found for trust update.");
    return;
  }

  for (const userDir of userDirs) {
    try {
      await updateTrustFile(userDir, folderUri);
    } catch (error) {
      logger.warn(
        `Failed to update VS Code workspace trust for ${userDir}:`,
        error
      );
    }
  }
}

async function resolveWorkspaceUri(workspacePath: string): Promise<string | null> {
  if (!workspacePath) {
    return null;
  }
  let folderPath = workspacePath;
  try {
    const stats = await fs.stat(workspacePath);
    if (!stats.isDirectory()) {
      folderPath = path.dirname(workspacePath);
    }
    folderPath = await fs.realpath(folderPath);
  } catch {
    // Fall back to resolved path even if the workspace has not been created yet
    folderPath = path.resolve(folderPath);
  }

  try {
    return normalizeFolderUri(pathToFileURL(folderPath).href);
  } catch {
    return null;
  }
}

function normalizeFolderUri(uri: string): string {
  return uri.endsWith("/") ? uri.slice(0, -1) : uri;
}

async function resolveExistingVSCodeUserDirs(): Promise<string[]> {
  const dirs: string[] = [];
  for (const folder of VS_CODE_APP_FOLDERS) {
    const userDir = getVSCodeUserDir(folder);
    try {
      await fs.access(userDir);
      dirs.push(userDir);
    } catch {
      continue;
    }
  }
  return dirs;
}

function getVSCodeUserDir(appFolderName: string): string {
  const homeDir = os.homedir();
  if (process.platform === "darwin") {
    return path.join(
      homeDir,
      "Library",
      "Application Support",
      appFolderName,
      "User"
    );
  }
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
    return path.join(appData, appFolderName, "User");
  }
  return path.join(homeDir, ".config", appFolderName, "User");
}

async function updateTrustFile(userDir: string, folderUri: string): Promise<void> {
  const trustDir = path.join(userDir, "workspaceTrust");
  const trustFilePath = path.join(trustDir, "trusted.json");
  await fs.mkdir(trustDir, { recursive: true });

  const fileData = await readTrustFile(trustFilePath);
  const content = (fileData.content ??= {});
  const trustedFolders = (content.trustedFolders = Array.isArray(
    content.trustedFolders
  )
    ? content.trustedFolders
    : []);

  const normalizedExisting = new Set(
    trustedFolders.map((uri) => normalizeFolderUri(uri))
  );
  const normalizedTarget = normalizeFolderUri(folderUri);

  if (normalizedExisting.has(normalizedTarget)) {
    return;
  }

  trustedFolders.push(folderUri);
  if (typeof fileData.version !== "number") {
    fileData.version = 1;
  }

  const json = JSON.stringify(fileData, null, 2);
  await fs.writeFile(trustFilePath, `${json}\n`, "utf8");
}

async function readTrustFile(pathname: string): Promise<WorkspaceTrustFile> {
  try {
    const raw = await fs.readFile(pathname, "utf8");
    return JSON.parse(raw) as WorkspaceTrustFile;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
    return {
      version: 1,
      content: { trustedFolders: [] },
    };
  }
}
