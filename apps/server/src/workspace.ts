import { api } from "@cmux/convex/api";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RepositoryManager } from "./repositoryManager";
import { getConvex } from "./utils/convexClient";
import { serverLogger } from "./utils/fileLogger";

/**
 * Auto-detect local repository path for a given repo name.
 * Checks legacy cmux clone first, then common directories.
 */
async function autoDetectLocalRepoPath(
  repoName: string,
  projectFullName?: string
): Promise<string | undefined> {
  const homeDir = os.homedir();
  const repoMgr = RepositoryManager.getInstance();

  // First, check for existing legacy cmux clone - enables seamless migration
  const legacyOriginPath = path.join(homeDir, "cmux", repoName, "origin");
  try {
    await fs.access(legacyOriginPath);
    await fs.access(path.join(legacyOriginPath, ".git"));
    serverLogger.info(
      `[autoDetectLocalRepoPath] Found legacy cmux clone at ${legacyOriginPath}, migrating to codex-style`
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
      await fs.access(candidatePath);
      await fs.access(path.join(candidatePath, ".git"));
      // Verify the remote matches if we have projectFullName
      if (projectFullName) {
        try {
          const { stdout } = await repoMgr.executeGitCommand(
            "git remote get-url origin",
            { cwd: candidatePath }
          );
          const remoteUrl = stdout.trim();
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
          // Remote check failed, skip
        }
      } else {
        // No projectFullName to verify, just use it
        serverLogger.info(
          `[autoDetectLocalRepoPath] Found local repo at ${candidatePath}`
        );
        return candidatePath;
      }
    } catch {
      // Path doesn't exist, skip
    }
  }

  return undefined;
}

interface WorkspaceResult {
  success: boolean;
  worktreePath?: string;
  error?: string;
}

type WorktreeMode = "legacy" | "codex-style";

interface WorktreeInfo {
  appDataPath: string;
  projectsPath: string;
  projectPath: string;
  originPath: string;
  worktreesPath: string;
  worktreePath: string;
  repoName: string;
  branch: string;
  mode: WorktreeMode;
  shortId?: string;
  sourceRepoPath?: string;
}

async function getAppDataPath(): Promise<string> {
  const appName = "manaflow3";
  const platform = process.platform;

  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", appName);
  } else if (platform === "win32") {
    return path.join(process.env.APPDATA || "", appName);
  } else {
    return path.join(os.homedir(), ".config", appName);
  }
}

function extractRepoName(repoUrl: string): string {
  const match = repoUrl.match(/([^/]+)\.git$/);
  if (match) {
    return match[1];
  }

  const parts = repoUrl.split("/");
  return parts[parts.length - 1] || "unknown-repo";
}

/**
 * Generate a short ID for Codex-style worktrees.
 * Uses first 8 characters of a random hex string.
 */
function generateShortId(): string {
  return crypto.randomBytes(4).toString("hex");
}

/**
 * Get the default Codex-style worktree base path.
 * Default: ~/.cmux/worktrees/
 */
function getCodexWorktreeBasePath(customPattern?: string): string {
  if (customPattern) {
    return customPattern.replace(/^~/, os.homedir());
  }
  return path.join(os.homedir(), ".cmux", "worktrees");
}

export async function getWorktreePath(
  args: {
    repoUrl: string;
    branch: string;
    /** Optional local repo path for Codex-style mode */
    localRepoPath?: string;
    /** Optional project full name (owner/repo) for better auto-detection */
    projectFullName?: string;
  },
  teamSlugOrId: string
): Promise<WorktreeInfo> {
  // Check for custom worktree path setting
  const settings = await getConvex().query(api.workspaceSettings.get, {
    teamSlugOrId,
  });

  const mode: WorktreeMode = settings?.worktreeMode ?? "codex-style";
  const repoName = extractRepoName(args.repoUrl);
  const appDataPath = await getAppDataPath();

  // Try to find a local repo path for codex-style mode
  let localRepoPath = args.localRepoPath;

  // Auto-detect if not provided and mode is codex-style
  if (mode === "codex-style" && !localRepoPath) {
    serverLogger.info(
      `[getWorktreePath] Auto-detecting local repo for ${repoName}`
    );
    localRepoPath = await autoDetectLocalRepoPath(
      repoName,
      args.projectFullName
    );
    if (localRepoPath) {
      serverLogger.info(
        `[getWorktreePath] Auto-detected local repo at ${localRepoPath}`
      );
    }
  }

  // Codex-style mode: requires an existing local repo
  if (mode === "codex-style" && localRepoPath) {
    const shortId = generateShortId();
    const worktreeBasePath = getCodexWorktreeBasePath(
      settings?.codexWorktreePathPattern
    );
    const worktreesPath = path.join(worktreeBasePath, shortId);
    const worktreePath = path.join(worktreesPath, repoName);

    return {
      appDataPath,
      projectsPath: worktreeBasePath,
      projectPath: worktreesPath,
      originPath: localRepoPath, // Use existing local repo
      worktreesPath,
      worktreePath,
      repoName,
      branch: args.branch,
      mode: "codex-style",
      shortId,
      sourceRepoPath: localRepoPath,
    };
  }

  // No local repo found for codex-style mode - throw error
  // User must add a source repo mapping in Settings > Worktrees
  if (mode === "codex-style" && !localRepoPath) {
    const errorMsg =
      `No local repository found for "${repoName}". ` +
      `Please clone the repository locally first, or add a source repo mapping in Settings > Worktrees.`;
    serverLogger.error(`[getWorktreePath] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  // Legacy mode (only reached if settings.worktreeMode is explicitly "legacy")
  // This path is kept for backward compatibility but not used by default
  let projectsPath: string;

  if (settings?.worktreePath) {
    // Use custom path, expand ~ to home directory
    const expandedPath = settings.worktreePath.replace(/^~/, os.homedir());
    projectsPath = expandedPath;
  } else {
    // Use default path: ~/cmux
    projectsPath = path.join(os.homedir(), "cmux");
  }

  const projectPath = path.join(projectsPath, repoName);
  const originPath = path.join(projectPath, "origin");
  const worktreesPath = path.join(projectPath, "worktrees");

  const worktreePath = path.join(worktreesPath, args.branch);

  return {
    appDataPath,
    projectsPath,
    projectPath,
    originPath,
    worktreesPath,
    worktreePath,
    repoName,
    branch: args.branch,
    mode: "legacy",
  };
}

/**
 * Get worktree path using Codex-style approach.
 * Creates worktrees from an existing local repository.
 */
export async function getWorktreePathCodexStyle(args: {
  repoUrl: string;
  branch: string;
  localRepoPath: string;
  customPattern?: string;
}): Promise<WorktreeInfo> {
  const repoName = extractRepoName(args.repoUrl);
  const shortId = generateShortId();
  const worktreeBasePath = getCodexWorktreeBasePath(args.customPattern);
  const worktreesPath = path.join(worktreeBasePath, shortId);
  const worktreePath = path.join(worktreesPath, repoName);
  const appDataPath = await getAppDataPath();

  return {
    appDataPath,
    projectsPath: worktreeBasePath,
    projectPath: worktreesPath,
    originPath: args.localRepoPath,
    worktreesPath,
    worktreePath,
    repoName,
    branch: args.branch,
    mode: "codex-style",
    shortId,
    sourceRepoPath: args.localRepoPath,
  };
}

export async function getProjectPaths(
  repoUrl: string,
  teamSlugOrId: string,
  localRepoPath?: string,
  projectFullName?: string
): Promise<{
  appDataPath: string;
  projectsPath: string;
  projectPath: string;
  originPath: string;
  worktreesPath: string;
  repoName: string;
  mode: WorktreeMode;
}> {
  const settings = await getConvex().query(api.workspaceSettings.get, {
    teamSlugOrId,
  });

  const mode: WorktreeMode = settings?.worktreeMode ?? "codex-style";
  const repoName = extractRepoName(repoUrl);
  const appDataPath = await getAppDataPath();

  // Try to find a local repo path for codex-style mode
  let effectiveLocalRepoPath = localRepoPath;

  // Auto-detect if not provided and mode is codex-style
  if (mode === "codex-style" && !effectiveLocalRepoPath) {
    serverLogger.info(
      `[getProjectPaths] Auto-detecting local repo for ${repoName}`
    );
    effectiveLocalRepoPath = await autoDetectLocalRepoPath(
      repoName,
      projectFullName
    );
    if (effectiveLocalRepoPath) {
      serverLogger.info(
        `[getProjectPaths] Auto-detected local repo at ${effectiveLocalRepoPath}`
      );
    }
  }

  // Codex-style mode: requires an existing local repo
  if (mode === "codex-style" && effectiveLocalRepoPath) {
    const worktreeBasePath = getCodexWorktreeBasePath(
      settings?.codexWorktreePathPattern
    );
    return {
      appDataPath,
      projectsPath: worktreeBasePath,
      projectPath: effectiveLocalRepoPath,
      originPath: effectiveLocalRepoPath,
      worktreesPath: worktreeBasePath,
      repoName,
      mode: "codex-style",
    };
  }

  // No local repo found - return "legacy" mode flag so caller can handle
  // (e.g., show warning to user to add source repo mapping)
  serverLogger.warn(
    `[getProjectPaths] No local repo found for ${repoName}. User should add a source repo mapping in Settings > Worktrees.`
  );
  return {
    appDataPath,
    projectsPath: "",
    projectPath: "",
    originPath: "",
    worktreesPath: "",
    repoName,
    mode: "legacy", // Indicates no local repo found
  };
}

export async function setupProjectWorkspace(args: {
  repoUrl: string;
  branch?: string;
  worktreeInfo: WorktreeInfo;
  /** Optional authenticated URL for git operations (with embedded token). repoUrl is stored as remote. */
  authenticatedRepoUrl?: string;
}): Promise<WorkspaceResult> {
  try {
    const { worktreeInfo } = args;
    const repoManager = RepositoryManager.getInstance();

    // Handle Codex-style mode differently
    if (worktreeInfo.mode === "codex-style" && worktreeInfo.sourceRepoPath) {
      return setupCodexStyleWorkspace(args, repoManager);
    }

    // Legacy mode: clone to origin path and create worktree
    // Normalize worktree path to avoid accidental extra folders like "cmux/<branch>"
    const normalizedWorktreePath = path.join(
      worktreeInfo.worktreesPath,
      worktreeInfo.branch
    );
    if (worktreeInfo.worktreePath !== normalizedWorktreePath) {
      serverLogger.info(
        `Normalizing worktree path from ${worktreeInfo.worktreePath} to ${normalizedWorktreePath}`
      );
      worktreeInfo.worktreePath = normalizedWorktreePath;
    }

    await fs.mkdir(worktreeInfo.projectPath, { recursive: true });
    await fs.mkdir(worktreeInfo.worktreesPath, { recursive: true });

    // Use RepositoryManager to handle clone/fetch with deduplication
    // If authenticatedRepoUrl provided, use it for git operations but store clean repoUrl as remote
    await repoManager.ensureRepository(
      args.authenticatedRepoUrl ?? args.repoUrl,
      worktreeInfo.originPath,
      args.branch,
      args.authenticatedRepoUrl ? args.repoUrl : undefined
    );

    // Get the default branch if not specified
    const baseBranch =
      args.branch ||
      (await repoManager.getDefaultBranch(worktreeInfo.originPath));

    // Prewarm commit history at origin for fast merge-base computation
    try {
      await repoManager.prewarmCommitHistory(
        worktreeInfo.originPath,
        baseBranch
      );
    } catch (e) {
      serverLogger.warn("Prewarm commit history failed:", e);
    }

    // If a worktree for this branch already exists anywhere, reuse it
    try {
      const existingByBranch = await repoManager.findWorktreeUsingBranch(
        worktreeInfo.originPath,
        worktreeInfo.branch
      );
      if (existingByBranch) {
        if (existingByBranch !== worktreeInfo.worktreePath) {
          serverLogger.info(
            `Reusing existing worktree for ${worktreeInfo.branch} at ${existingByBranch}`
          );
          worktreeInfo.worktreePath = existingByBranch;
        } else {
          serverLogger.info(
            `Worktree for ${worktreeInfo.branch} already registered at ${existingByBranch}`
          );
        }
        // Ensure configuration and hooks are present
        await repoManager.ensureWorktreeConfigured(
          worktreeInfo.worktreePath,
          worktreeInfo.branch
        );
      }
    } catch (e) {
      serverLogger.warn(
        `Failed checking for existing worktree for ${worktreeInfo.branch}:`,
        e
      );
    }

    // Check if worktree already exists in git
    const worktreeRegistered = await repoManager.worktreeExists(
      worktreeInfo.originPath,
      worktreeInfo.worktreePath
    );

    if (worktreeRegistered) {
      // Check if the directory actually exists AND is a valid git worktree
      let isValidWorktree = false;
      try {
        await fs.access(worktreeInfo.worktreePath);
        // Also verify it's actually a git worktree by checking for .git file/directory
        const gitPath = path.join(worktreeInfo.worktreePath, ".git");
        const gitStat = await fs.stat(gitPath);
        // Worktrees have a .git file (not directory) pointing to the main repo
        isValidWorktree = gitStat.isFile() || gitStat.isDirectory();
      } catch {
        isValidWorktree = false;
      }

      if (isValidWorktree) {
        serverLogger.info(
          `Worktree already exists at ${worktreeInfo.worktreePath}, using existing`
        );
      } else {
        // Worktree is registered but directory doesn't exist or is invalid, remove and recreate
        serverLogger.info(
          `Worktree registered but directory missing or invalid, recreating...`
        );
        try {
          await repoManager.removeWorktree(
            worktreeInfo.originPath,
            worktreeInfo.worktreePath
          );
        } catch (removeErr) {
          // Log but continue - the worktree may already be in a broken state
          serverLogger.warn(
            `Failed to remove stale worktree registration: ${removeErr}`
          );
        }
        // Also clean up the directory if it exists but is invalid
        try {
          await fs.rm(worktreeInfo.worktreePath, { recursive: true, force: true });
        } catch {
          // Ignore - directory may not exist
        }
        const actualPath = await repoManager.createWorktree(
          worktreeInfo.originPath,
          worktreeInfo.worktreePath,
          worktreeInfo.branch,
          baseBranch
        );
        if (actualPath && actualPath !== worktreeInfo.worktreePath) {
          serverLogger.info(
            `Worktree path resolved to ${actualPath} for branch ${worktreeInfo.branch}`
          );
          worktreeInfo.worktreePath = actualPath;
        }
      }
    } else {
      // Worktree not registered - but directory might exist from a previous broken state
      // Clean it up first to avoid conflicts
      try {
        const dirExists = await fs.access(worktreeInfo.worktreePath).then(() => true).catch(() => false);
        if (dirExists) {
          serverLogger.info(
            `Directory exists at ${worktreeInfo.worktreePath} but not registered as worktree, cleaning up...`
          );
          await fs.rm(worktreeInfo.worktreePath, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup errors
      }

      // Create the worktree
      const actualPath = await repoManager.createWorktree(
        worktreeInfo.originPath,
        worktreeInfo.worktreePath,
        worktreeInfo.branch,
        baseBranch
      );
      if (actualPath && actualPath !== worktreeInfo.worktreePath) {
        serverLogger.info(
          `Worktree path resolved to ${actualPath} for branch ${worktreeInfo.branch}`
        );
        worktreeInfo.worktreePath = actualPath;
      }
    }

    return { success: true, worktreePath: worktreeInfo.worktreePath };
  } catch (error) {
    serverLogger.error("Failed to setup workspace:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Setup workspace using Codex-style approach.
 * Uses existing local repository as source, creates worktree without cloning.
 */
export async function setupCodexStyleWorkspace(
  args: {
    repoUrl: string;
    branch?: string;
    worktreeInfo: WorktreeInfo;
    authenticatedRepoUrl?: string;
  },
  repoManager: RepositoryManager
): Promise<WorkspaceResult> {
  const { worktreeInfo } = args;
  const sourceRepoPath = worktreeInfo.sourceRepoPath;

  if (!sourceRepoPath) {
    return {
      success: false,
      error: "Source repo path is required for codex-style mode",
    };
  }

  serverLogger.info(
    `Setting up Codex-style workspace from ${sourceRepoPath} for branch ${worktreeInfo.branch}`
  );

  try {
    // Verify source repo exists and is a valid git repository
    const isValidRepo = await repoManager.isValidGitRepository(sourceRepoPath);
    if (!isValidRepo) {
      return {
        success: false,
        error: `${sourceRepoPath} is not a valid git repository`,
      };
    }

    // Fetch latest from origin to ensure we have up-to-date refs
    try {
      const fetchSource = args.authenticatedRepoUrl
        ? `"${args.authenticatedRepoUrl}"`
        : "origin";
      await repoManager.executeGitCommand(
        `git fetch ${fetchSource}`,
        { cwd: sourceRepoPath }
      );
    } catch (e) {
      serverLogger.warn("Failed to fetch from origin:", e);
      // Continue anyway - we might have the branch locally
    }

    // Get the default branch if not specified
    const baseBranch =
      args.branch || (await repoManager.getDefaultBranch(sourceRepoPath));

    // Check if a worktree for this branch already exists
    const existingByBranch = await repoManager.findWorktreeUsingBranch(
      sourceRepoPath,
      worktreeInfo.branch
    );

    if (existingByBranch) {
      serverLogger.info(
        `Reusing existing worktree for ${worktreeInfo.branch} at ${existingByBranch}`
      );
      worktreeInfo.worktreePath = existingByBranch;
      await repoManager.ensureWorktreeConfigured(
        worktreeInfo.worktreePath,
        worktreeInfo.branch
      );
      return { success: true, worktreePath: worktreeInfo.worktreePath };
    }

    // Create the worktrees directory (only if we're going to create a new worktree)
    await fs.mkdir(worktreeInfo.worktreesPath, { recursive: true });

    // Create the worktree from local repo
    const actualPath = await repoManager.createWorktreeFromLocalRepo(
      sourceRepoPath,
      worktreeInfo.worktreePath,
      worktreeInfo.branch,
      baseBranch,
      args.authenticatedRepoUrl
    );

    if (actualPath && actualPath !== worktreeInfo.worktreePath) {
      serverLogger.info(
        `Worktree path resolved to ${actualPath} for branch ${worktreeInfo.branch}`
      );
      worktreeInfo.worktreePath = actualPath;
    }

    serverLogger.info(
      `Successfully created Codex-style worktree at ${worktreeInfo.worktreePath}`
    );

    return { success: true, worktreePath: worktreeInfo.worktreePath };
  } catch (error) {
    serverLogger.error("Failed to setup Codex-style workspace:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
