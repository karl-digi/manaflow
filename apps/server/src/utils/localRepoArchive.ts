import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { serverLogger } from "./fileLogger";

const execFileAsync = promisify(execFile);

export interface LocalRepoArchivePayload {
  fileName: string;
  base64: string;
  size: number;
  branch?: string;
}

export async function createLocalRepoArchive({
  repoPath,
  branch,
}: {
  repoPath: string;
  branch?: string;
}): Promise<LocalRepoArchivePayload> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "cmux-local-archive-")
  );
  const tarPath = path.join(tempDir, "repo.tar");
  const treeRef = branch ?? "HEAD";
  try {
    await execFileAsync("git", [
      "-C",
      repoPath,
      "archive",
      "--format=tar",
      treeRef,
      "-o",
      tarPath,
    ]);
    await execFileAsync("tar", ["-rf", tarPath, "-C", repoPath, ".git"]);
    const buffer = await fs.readFile(tarPath);
    const base64 = buffer.toString("base64");
    const repoName = path.basename(repoPath) || "local-repo";
    const sanitizedName = repoName.replace(/[^a-zA-Z0-9._-]/g, "-");
    serverLogger.info(
      `[localRepoArchive] Created archive for ${repoPath} (${buffer.length} bytes)`
    );
    return {
      fileName: `${sanitizedName || "local-repo"}.tar`,
      base64,
      size: buffer.length,
      branch,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {
      /* ignore */
    });
  }
}
