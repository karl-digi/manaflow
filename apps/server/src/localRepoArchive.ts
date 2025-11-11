import type { LocalPathSuggestion } from "@cmux/shared";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as fssync from "node:fs";
import * as path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

export interface LocalRepoMetadata {
  repoRoot: string;
  path: string;
  displayPath: string;
  repoName: string;
  branches: string[];
  currentBranch?: string;
  defaultBranch?: string;
  remoteUrl?: string;
  headSha: string;
}

export interface LocalRepoArchive extends LocalRepoMetadata {
  archivePath: string;
}

export function expandUserPath(target: string): string {
  if (!target) return "";
  if (target.startsWith("~")) {
    return path.join(os.homedir(), target.slice(1));
  }
  if (path.isAbsolute(target)) {
    return target;
  }
  return path.join(os.homedir(), target);
}

export function formatDisplayPath(absPath: string): string {
  const home = os.homedir();
  if (absPath === home) {
    return "~";
  }
  if (absPath.startsWith(home)) {
    const suffix = absPath.slice(home.length);
    if (!suffix) {
      return "~";
    }
    if (suffix.startsWith(path.sep)) {
      return `~${suffix}`;
    }
    return `~${path.sep}${suffix}`;
  }
  return absPath;
}

async function runGit(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd });
    return { stdout: stdout.toString(), stderr: stderr?.toString() ?? "" };
  } catch (error) {
    const err = error as { message?: string; stderr?: string };
    throw new Error(
      `Git command failed (${args.join(" ")}): ${
        err.stderr?.toString()?.trim() || err.message || "unknown error"
      }`
    );
  }
}

async function tryRunGit(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout.toString().trim();
  } catch {
    return null;
  }
}

export async function inspectLocalRepo(
  targetPath: string
): Promise<LocalRepoMetadata> {
  const expanded = expandUserPath(targetPath.trim());
  const stats = await fs.stat(expanded).catch(() => null);
  if (!stats) {
    throw new Error(`Path does not exist: ${targetPath}`);
  }

  const repoRoot = await runGit(
    ["rev-parse", "--show-toplevel"],
    stats.isDirectory() ? expanded : path.dirname(expanded)
  ).then((res) => res.stdout.trim());

  const repoName = path.basename(repoRoot);
  const displayPath = formatDisplayPath(repoRoot);

  const headSha = await runGit(["rev-parse", "HEAD"], repoRoot).then((res) =>
    res.stdout.trim()
  );
  const currentBranch = await tryRunGit(
    ["rev-parse", "--abbrev-ref", "HEAD"],
    repoRoot
  );

  const branchesRaw = await runGit(
    ["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
    repoRoot
  ).then((res) =>
    res.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  );

  const remoteHead = await tryRunGit(
    ["symbolic-ref", "refs/remotes/origin/HEAD"],
    repoRoot
  );
  const defaultBranch = remoteHead
    ? remoteHead.replace(/^refs\/remotes\/origin\//, "")
    : undefined;

  const remoteUrl =
    (await tryRunGit(["config", "--get", "remote.origin.url"], repoRoot)) ||
    undefined;

  return {
    repoRoot,
    path: repoRoot,
    displayPath,
    repoName,
    branches: branchesRaw,
    currentBranch: currentBranch || undefined,
    defaultBranch: defaultBranch || currentBranch || undefined,
    remoteUrl,
    headSha,
  };
}

export async function createGitArchive(
  repoRoot: string
): Promise<{ archivePath: string }> {
  await fs.access(repoRoot);
  const archivePath = path.join(
    os.tmpdir(),
    `cmux-local-archive-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.tar`
  );
  await execFileAsync(
    "git",
    ["archive", "--format=tar", `--output=${archivePath}`, "HEAD"],
    { cwd: repoRoot }
  );
  return { archivePath };
}

async function hasGitRepo(dirPath: string): Promise<boolean> {
  try {
    const gitPath = path.join(dirPath, ".git");
    const stat = await fs.stat(gitPath);
    if (stat.isDirectory()) return true;
    // In case of bare repo, .git might be a file; treat as repo as well
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function listDirectorySuggestions(
  rawInput: string,
  limit = 8
): Promise<LocalPathSuggestion[]> {
  const input = rawInput.trim();
  if (!input) {
    return [];
  }
  const expanded = expandUserPath(input);
  const endsWithSep = input.endsWith(path.sep);
  const candidateDir = endsWithSep ? expanded : path.dirname(expanded);
  const partialName = endsWithSep ? "" : path.basename(expanded);

  const suggestions: LocalPathSuggestion[] = [];
  try {
    const entries = await fs.readdir(candidateDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (partialName && !entry.name.toLowerCase().startsWith(partialName.toLowerCase())) {
        continue;
      }
      const fullPath = path.join(candidateDir, entry.name);
      const suggestion: LocalPathSuggestion = {
        path: fullPath,
        displayPath: formatDisplayPath(fullPath),
        repoName: entry.name,
        isGitRepo: await hasGitRepo(fullPath),
      };
      suggestions.push(suggestion);
      if (suggestions.length >= limit) {
        break;
      }
    }
  } catch {
    return [];
  }
  return suggestions;
}

export async function pathLooksLikeRepo(pathInput: string): Promise<boolean> {
  const expanded = expandUserPath(pathInput.trim());
  return hasGitRepo(expanded);
}

export async function extractArchiveToPath(
  archivePath: string,
  destination: string
): Promise<void> {
  await fs.rm(destination, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(destination, { recursive: true });
  await execFileAsync("tar", ["-xf", archivePath, "-C", destination]);
}

export function archiveExists(archivePath: string): boolean {
  try {
    return fssync.existsSync(archivePath);
  } catch {
    return false;
  }
}
