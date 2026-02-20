import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { RepositoryManager } from "../repositoryManager";
import { getConvex } from "../utils/convexClient";
import { retryOnOptimisticConcurrency } from "../utils/convexRetry";
import { serverLogger } from "../utils/fileLogger";
import { getGitHubOAuthToken } from "../utils/getGitHubToken";
import {
  getWorktreePath,
  setupCodexStyleWorkspace,
  setupProjectWorkspace,
} from "../workspace";

/**
 * Auto-detect local repository path for a given project.
 * Scans common directories to find a matching git repo.
 * Also checks for existing legacy cmux clones at ~/cmux/<repo>/origin/
 */
async function autoDetectLocalRepoPath(
  projectFullName: string
): Promise<string | undefined> {
  const repoName = projectFullName.split("/")[1];
  if (!repoName) return undefined;

  const homeDir = os.homedir();

  // First, check for existing legacy cmux clone - this enables seamless migration
  const legacyOriginPath = path.join(homeDir, "cmux", repoName, "origin");
  try {
    await fs.access(legacyOriginPath);
    await fs.access(path.join(legacyOriginPath, ".git"));
    serverLogger.info(
      `[autoDetectLocalRepoPath] Found legacy cmux clone for ${projectFullName} at ${legacyOriginPath}, migrating to codex-style`
    );
    return legacyOriginPath;
  } catch {
    // No legacy clone, continue with other paths
  }

  const commonPaths = [
    // Common code directories
    path.join(homeDir, "code", repoName),
    path.join(homeDir, "Code", repoName),
    path.join(homeDir, "projects", repoName),
    path.join(homeDir, "Projects", repoName),
    path.join(homeDir, "dev", repoName),
    path.join(homeDir, "Dev", repoName),
    path.join(homeDir, "src", repoName),
    path.join(homeDir, "workspace", repoName),
    path.join(homeDir, "Workspace", repoName),
    path.join(homeDir, "repos", repoName),
    path.join(homeDir, "Repos", repoName),
    path.join(homeDir, "git", repoName),
    path.join(homeDir, "GitHub", repoName),
    path.join(homeDir, "github", repoName),
    // Desktop subdirectories
    path.join(homeDir, "Desktop", "code", repoName),
    path.join(homeDir, "Desktop", "Code", repoName),
    path.join(homeDir, "Desktop", "projects", repoName),
    path.join(homeDir, "Desktop", repoName),
    // Documents subdirectories
    path.join(homeDir, "Documents", "code", repoName),
    path.join(homeDir, "Documents", "Code", repoName),
    path.join(homeDir, "Documents", "projects", repoName),
    // Direct in home
    path.join(homeDir, repoName),
  ];

  for (const candidatePath of commonPaths) {
    try {
      // Check if directory exists
      await fs.access(candidatePath);
      // Check if it's a git repo
      await fs.access(path.join(candidatePath, ".git"));
      // Verify the remote matches the expected project
      const repoMgr = RepositoryManager.getInstance();
      try {
        const { stdout } = await repoMgr.executeGitCommand(
          "git remote get-url origin",
          { cwd: candidatePath }
        );
        const remoteUrl = stdout.trim();
        // Check if remote URL contains the project name
        if (
          remoteUrl.includes(projectFullName) ||
          remoteUrl.includes(projectFullName.replace("/", ":"))
        ) {
          serverLogger.info(
            `[autoDetectLocalRepoPath] Found local repo for ${projectFullName} at ${candidatePath}`
          );
          return candidatePath;
        }
      } catch {
        // Remote check failed, skip this path
      }
    } catch {
      // Path doesn't exist or isn't accessible, skip
    }
  }

  return undefined;
}

export type EnsureWorktreeResult = {
  run: Doc<"taskRuns">;
  task: Doc<"tasks">;
  worktreePath: string;
  branchName: string;
  baseBranch: string;
};

function sanitizeBranchName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._/-]/g, "-");
}

// Deduplicate concurrent ensures for the same taskRunId within this process
const pendingEnsures = new Map<string, Promise<EnsureWorktreeResult>>();

export async function ensureRunWorktreeAndBranch(
  taskRunId: Id<"taskRuns">,
  teamSlugOrId: string
): Promise<EnsureWorktreeResult> {
  const key = String(taskRunId);
  const existing = pendingEnsures.get(key);
  if (existing) return existing;

  const p = (async (): Promise<EnsureWorktreeResult> => {
    const run = await getConvex().query(api.taskRuns.get, {
      teamSlugOrId,
      id: taskRunId,
    });
    if (!run) throw new Error("Task run not found");

    const task = await getConvex().query(api.tasks.getById, {
      teamSlugOrId,
      id: run.taskId,
    });
    if (!task) throw new Error("Task not found");

    // Determine base branch: prefer explicit task.baseBranch; otherwise detect later
    let baseBranch = task.baseBranch || "";
    const branchName = sanitizeBranchName(
      run.newBranch || `cmux-run-${String(taskRunId).slice(-8)}`
    );

    // Ensure worktree exists
    let worktreePath = run.worktreePath;
    let needsSetup = !worktreePath;

    // Check if the worktree directory actually exists (handle manual deletion case)
    if (worktreePath) {
      try {
        await fs.access(worktreePath);
        // Also check if it's a valid git directory
        await fs.access(path.join(worktreePath, ".git"));
      } catch {
        serverLogger.warn(
          `Worktree path ${worktreePath} doesn't exist or is not a git directory, recreating...`
        );
        needsSetup = true;
        worktreePath = undefined;
      }
    }

    if (needsSetup) {
      // Derive repo URL from task.projectFullName
      if (!task.projectFullName) {
        throw new Error("Missing projectFullName to set up worktree");
      }
      const repoUrl = `https://github.com/${task.projectFullName}.git`;

      // Fetch GitHub OAuth token for private repo access
      let authenticatedRepoUrl: string | undefined;
      try {
        const token = await getGitHubOAuthToken();
        if (token) {
          authenticatedRepoUrl = `https://x-access-token:${token}@github.com/${task.projectFullName}.git`;
        }
      } catch (error) {
        // Non-fatal: if token fetch fails, fall back to unauthenticated access (works for public repos)
        serverLogger.warn(
          `[ensureRunWorktree] Failed to get GitHub OAuth token for ${task.projectFullName}: ${String(error)}`
        );
      }

      // Check for source repo mapping to enable codex-style worktrees
      let localRepoPath: string | undefined;
      try {
        const sourceMapping = await getConvex().query(
          api.sourceRepoMappings.getByProject,
          {
            teamSlugOrId,
            projectFullName: task.projectFullName,
          }
        );
        if (sourceMapping?.localRepoPath) {
          // Verify the local repo path exists
          try {
            await fs.access(sourceMapping.localRepoPath);
            await fs.access(path.join(sourceMapping.localRepoPath, ".git"));
            localRepoPath = sourceMapping.localRepoPath;
            serverLogger.info(
              `[ensureRunWorktree] Using codex-style worktree from mapping: ${localRepoPath}`
            );
          } catch {
            serverLogger.warn(
              `[ensureRunWorktree] Source repo mapping path ${sourceMapping.localRepoPath} doesn't exist or is not a git repo, trying auto-detection`
            );
          }
        }

        // If no mapping or mapping path invalid, try auto-detection
        if (!localRepoPath) {
          const detectedPath = await autoDetectLocalRepoPath(
            task.projectFullName
          );
          if (detectedPath) {
            localRepoPath = detectedPath;
            serverLogger.info(
              `[ensureRunWorktree] Auto-detected local repo at ${localRepoPath}`
            );
            // Auto-save the mapping for future use
            try {
              await getConvex().mutation(api.sourceRepoMappings.upsert, {
                teamSlugOrId,
                projectFullName: task.projectFullName,
                localRepoPath: detectedPath,
              });
              serverLogger.info(
                `[ensureRunWorktree] Auto-saved source repo mapping for ${task.projectFullName}`
              );
            } catch (saveError) {
              serverLogger.warn(
                `[ensureRunWorktree] Failed to auto-save source repo mapping: ${String(saveError)}`
              );
            }
          }
        }
      } catch (error) {
        serverLogger.warn(
          `[ensureRunWorktree] Failed to check source repo mapping: ${String(error)}`
        );
      }

      const worktreeInfo = await getWorktreePath(
        {
          repoUrl,
          branch: branchName,
          localRepoPath,
          projectFullName: task.projectFullName,
        },
        teamSlugOrId
      );

      // Use appropriate setup function based on mode
      const repoMgr = RepositoryManager.getInstance();
      let res: { success: boolean; worktreePath?: string; error?: string };
      if (worktreeInfo.mode === "codex-style" && worktreeInfo.sourceRepoPath) {
        res = await setupCodexStyleWorkspace(
          {
            repoUrl,
            branch: baseBranch || undefined,
            worktreeInfo,
            authenticatedRepoUrl,
          },
          repoMgr
        );
      } else {
        res = await setupProjectWorkspace({
          repoUrl,
          branch: baseBranch || undefined,
          worktreeInfo,
          authenticatedRepoUrl,
        });
      }
      if (!res.success || !res.worktreePath) {
        throw new Error(res.error || "Failed to set up worktree");
      }
      worktreePath = res.worktreePath;
      await retryOnOptimisticConcurrency(() =>
        getConvex().mutation(api.taskRuns.updateWorktreePath, {
          teamSlugOrId,
          id: run._id,
          worktreePath: worktreePath as string,
        })
      );

      // If baseBranch wasn't specified, detect it now from the origin repo
      if (!baseBranch) {
        const repoMgr = RepositoryManager.getInstance();
        baseBranch = await repoMgr.getDefaultBranch(worktreeInfo.originPath);
      }
    }

    // If worktree already existed and baseBranch is still empty, detect from the worktree
    if (!baseBranch && worktreePath) {
      const repoMgr = RepositoryManager.getInstance();
      baseBranch = await repoMgr.getDefaultBranch(worktreePath);
    }

    // Ensure worktreePath is defined before proceeding
    if (!worktreePath) {
      throw new Error("Failed to establish worktree path");
    }

    // Ensure we're on the correct branch without discarding changes
    const repoMgr = RepositoryManager.getInstance();
    try {
      const currentBranch = await repoMgr.getCurrentBranch(worktreePath);
      if (currentBranch !== branchName) {
        try {
          // Try to create a new branch
          await repoMgr.executeGitCommand(`git checkout -b ${branchName}`, {
            cwd: worktreePath,
          });
        } catch {
          // If branch already exists, just switch to it
          await repoMgr.executeGitCommand(`git checkout ${branchName}`, {
            cwd: worktreePath,
          });
        }
      }
      // After ensuring we're on the correct branch, attempt to fetch the remote
      // branch for this run so the local worktree reflects the pushed commits.
      // This is especially important in cloud mode where commits happen in a VM.
      try {
        // Fetch the specific branch, force-updating the remote-tracking ref
        await repoMgr.updateRemoteBranchIfStale(worktreePath, branchName);
        // If the worktree has no local changes, fast-forward/reset to origin/<branch>
        const { stdout: statusOut } = await repoMgr.executeGitCommand(
          `git status --porcelain`,
          { cwd: worktreePath }
        );
        const isClean = statusOut.trim().length === 0;
        if (isClean) {
          // Only hard reset when clean to avoid clobbering local edits
          await repoMgr.executeGitCommand(
            `git reset --hard origin/${branchName}`,
            { cwd: worktreePath }
          );
        }
      } catch (e) {
        // Non-fatal: if fetch/reset fails, continue so UI can still render whatever exists
        serverLogger.warn(
          `[ensureRunWorktree] Non-fatal fetch/update failure for ${branchName}: ${String(e)}`
        );
      }

      // Prewarm both base and run branch histories to make merge-base fast/reliable
      try {
        await repoMgr.prewarmCommitHistory(worktreePath, branchName);
      } catch (e) {
        serverLogger.warn(`Prewarm run branch failed: ${String(e)}`);
      }
    } catch (e: unknown) {
      const err = e as { message?: string; stderr?: string };
      serverLogger.error(
        `[ensureRunWorktree] Failed to ensure branch: ${err?.stderr || err?.message || "unknown"}`
      );
      console.error(e);
      throw new Error(
        `Failed to ensure branch: ${err?.stderr || err?.message || "unknown"}`
      );
    }

    return { run, task, worktreePath, branchName, baseBranch };
  })();

  pendingEnsures.set(key, p);
  try {
    return await p;
  } finally {
    pendingEnsures.delete(key);
  }
}
