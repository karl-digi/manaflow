import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

interface StoredTokenPayload {
  refreshToken: string;
  storedAt: string;
}

interface ErrnoException extends Error {
  code?: string;
}

const baseDir = path.join(homedir(), ".cmux", "cli");

const tokenFileForProject = (projectId: string): string =>
  path.join(baseDir, `stack-refresh-${projectId}.json`);

export async function loadSavedRefreshToken(
  projectId: string,
): Promise<string | null> {
  try {
    const filePath = tokenFileForProject(projectId);
    const contents = await readFile(filePath, "utf8");
    const parsed = JSON.parse(contents) as StoredTokenPayload;
    if (!parsed.refreshToken || typeof parsed.refreshToken !== "string") {
      return null;
    }
    return parsed.refreshToken;
  } catch (error) {
    const errno = error as ErrnoException;
    if (errno.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function persistRefreshToken(
  projectId: string,
  refreshToken: string,
): Promise<void> {
  await mkdir(baseDir, { recursive: true });
  const payload: StoredTokenPayload = {
    refreshToken,
    storedAt: new Date().toISOString(),
  };
  const filePath = tokenFileForProject(projectId);
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
