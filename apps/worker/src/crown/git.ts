import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { log } from "../logger";
import { WORKSPACE_ROOT, execAsync, execFileAsync } from "./utils";

type ExecError = Error & {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  code?: number;
  status?: number;
};

type PushTokenSupplier = () => Promise<{
  token: string;
  repoFullName: string;
} | null>;

let cachedRepoPath: string | null = null;
let cachedRepoHint: string | null = null;
let cachedRepoPaths: string[] = [];

const PROTECTED_BRANCH_FALLBACKS = new Set(["main", "master"]);
const AUTH_ERROR_PATTERNS = [
  /bad credentials/i,
  /authentication failed/i,
  /invalid username or password/i,
  /could not read username/i,
  /fatal: authentication/i,
  /HTTP 401/i,
  /HTTP 403/i,
  /remote: Permission.*denied/i,
];
const GITHUB_TOKEN_IN_URL_PATTERN =
  /(https:\/\/x-access-token:)([^@]+)(@github\.com)/gi;
type BranchProtectionCheckResult = {
  isProtected: boolean;
  reason?: "remote_head" | "fallback";
  remoteHead?: string | null;
};

export function isAuthError(output: string): boolean {
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(output));
}

const getRepoHint = (): string | null => {
  const repoFull = process.env.CMUX_REPO_FULL?.trim();
  if (repoFull) {
    const repoFromFull = repoFull.split("/").pop()?.trim();
    if (repoFromFull) {
      return repoFromFull;
    }
  }
  const repoName = process.env.CMUX_REPO?.trim();
  return repoName || null;
};

const hasGitDirectory = (candidatePath: string): boolean => {
  try {
    const gitPath = join(candidatePath, ".git");
    return existsSync(gitPath) && statSync(gitPath).isDirectory();
  } catch {
    return false;
  }
};

const normalizeBranchName = (value: string): string =>
  value.replace(/^refs\/(heads|remotes\/origin)\//, "").replace(/^origin\//, "").trim();

const scanWorkspaceForRepos = (): string[] => {
  const candidates: string[] = [];

  if (hasGitDirectory(WORKSPACE_ROOT)) {
    candidates.push(WORKSPACE_ROOT);
  }

  try {
    const entries = readdirSync(WORKSPACE_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDirPath = join(WORKSPACE_ROOT, entry.name);
        if (hasGitDirectory(subDirPath)) {
          candidates.push(subDirPath);
        }
      }
    }
  } catch (error) {
    log("WARN", "Failed to search for git repositories", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }

  return Array.from(new Set(candidates));
};

const resolveHomeDirectory = (): string => {
  const envHome = process.env.HOME?.trim();
  if (envHome) {
    return envHome;
  }

  try {
    const osHome = homedir();
    if (osHome) {
      return osHome;
    }
  } catch {
    // no-op, fall through to default
  }

  return "/root";
};

export async function detectGitRepoPath(): Promise<string> {
  const repoHint = getRepoHint();

  if (
    cachedRepoPath &&
    cachedRepoHint === repoHint &&
    hasGitDirectory(cachedRepoPath)
  ) {
    return cachedRepoPath;
  }

  const repoPaths = scanWorkspaceForRepos();
  cachedRepoPaths = repoPaths;
  let selectedPath = repoPaths[0];

  if (repoHint) {
    const matchedByHint = repoPaths.find((candidate) => {
      const name = basename(candidate);
      return name === repoHint;
    });
    if (matchedByHint) {
      selectedPath = matchedByHint;
    } else if (repoPaths.length > 1) {
      log("WARN", "Multiple git repositories found, hint did not match", {
        repoHint,
        candidates: repoPaths,
      });
    }
  }

  if (selectedPath) {
    cachedRepoPath = selectedPath;
    cachedRepoHint = repoHint ?? null;
    log("INFO", "Git repository selected", {
      path: selectedPath,
      repoHint,
      candidates: repoPaths,
    });
    return selectedPath;
  }

  log("WARN", "No git repository found, defaulting to workspace root", {
    path: WORKSPACE_ROOT,
    repoHint,
  });
  cachedRepoPath = WORKSPACE_ROOT;
  cachedRepoHint = repoHint ?? null;
  cachedRepoPaths = [WORKSPACE_ROOT];
  return WORKSPACE_ROOT;
}

export async function listGitRepoPaths(): Promise<string[]> {
  const repoHint = getRepoHint();
  const validCache =
    cachedRepoPaths.length > 0 &&
    cachedRepoHint === repoHint &&
    (cachedRepoPaths.every((path) => hasGitDirectory(path)) ||
      (cachedRepoPaths.length === 1 &&
        cachedRepoPaths[0] === WORKSPACE_ROOT));

  if (validCache) {
    return [...cachedRepoPaths];
  }

  const selected = await detectGitRepoPath();
  if (!cachedRepoPaths.includes(selected)) {
    cachedRepoPaths = [selected];
  }
  return [...cachedRepoPaths];
}

async function getRemoteHeadBranch(repoPath: string): Promise<string | null> {
  const result = await runGitCommand(
    "git symbolic-ref refs/remotes/origin/HEAD",
    true,
    repoPath,
  );

  if (!result || result.exitCode !== 0) {
    return null;
  }

  const ref = result.stdout.trim();
  if (!ref) {
    return null;
  }

  const normalized = normalizeBranchName(ref);
  return normalized.length > 0 ? normalized : null;
}

/**
 * Auto-detect the default base branch for the repository.
 * Tries: refs/remotes/origin/HEAD -> origin/main -> origin/master
 */
export async function getDefaultBaseBranch(): Promise<string> {
  const repoPath = await detectGitRepoPath();

  // Try refs/remotes/origin/HEAD first (symref to default branch)
  const remoteHead = await getRemoteHeadBranch(repoPath);
  if (remoteHead) {
    return remoteHead;
  }

  // Fallback: check if origin/main exists, otherwise use master
  const mainExists = await runGitCommand(
    "git rev-parse --verify origin/main",
    true,
    repoPath,
  );
  return mainExists?.exitCode === 0 ? "main" : "master";
}

async function checkProtectedBranch(
  branchName: string,
  repoPath: string,
): Promise<BranchProtectionCheckResult> {
  const normalizedBranch = normalizeBranchName(branchName);
  if (!normalizedBranch) {
    return { isProtected: false };
  }

  const remoteHead = await getRemoteHeadBranch(repoPath);

  if (remoteHead && normalizeBranchName(remoteHead) === normalizedBranch) {
    return {
      isProtected: true,
      reason: "remote_head",
      remoteHead,
    };
  }

  if (PROTECTED_BRANCH_FALLBACKS.has(normalizedBranch)) {
    return {
      isProtected: true,
      reason: "fallback",
      remoteHead,
    };
  }

  return {
    isProtected: false,
    remoteHead,
  };
}

export async function runGitCommand(
  command: string,
  allowFailure = false,
  repoPathOverride?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number } | null> {
  const formatOutput = (value: string | Buffer): string => String(value);

  try {
    const repoPath =
      repoPathOverride ?? (await detectGitRepoPath());
    const result = await execAsync(command, {
      cwd: repoPath,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: resolveHomeDirectory(),
      },
    });
    const stdout = formatOutput(result.stdout);
    const stderr = formatOutput(result.stderr);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const execError: ExecError =
      error instanceof Error
        ? error
        : new Error(
            typeof error === "string" ? error : "Unknown git command error",
          );
    const stdout = formatOutput(execError.stdout ?? "");
    const stderr = formatOutput(execError.stderr ?? "");
    const exitCode = execError.code ?? execError.status ?? 1;
    const errorPayload = {
      command,
      message: execError.message,
      exitCode,
      stdout: stdout?.slice(0, 500),
      stderr: stderr?.slice(0, 500),
    };
    if (!allowFailure) {
      log("ERROR", "Git command failed", errorPayload);
      throw error;
    }
    log("WARN", "Git command failed (ignored)", errorPayload);
    return { stdout, stderr, exitCode };
  }
}

export async function runGitCommandSafe(
  args: string[],
  allowFailure = false,
  repoPathOverride?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number } | null> {
  const formatOutput = (value: string | Buffer): string => String(value);

  try {
    const repoPath =
      repoPathOverride ?? (await detectGitRepoPath());
    const result = await execFileAsync("git", args, {
      cwd: repoPath,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: resolveHomeDirectory(),
      },
    });
    const stdout = formatOutput(result.stdout);
    const stderr = formatOutput(result.stderr);
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const execError: ExecError =
      error instanceof Error
        ? error
        : new Error(
            typeof error === "string" ? error : "Unknown git command error",
          );
    const stdout = formatOutput(execError.stdout ?? "");
    const stderr = formatOutput(execError.stderr ?? "");
    const exitCode = execError.code ?? execError.status ?? 1;
    const errorPayload = {
      args,
      message: execError.message,
      exitCode,
      stdout: stdout?.slice(0, 500),
      stderr: stderr?.slice(0, 500),
    };
    if (!allowFailure) {
      log("ERROR", "Git command failed", errorPayload);
      throw error;
    }
    log("WARN", "Git command failed (ignored)", errorPayload);
    return { stdout, stderr, exitCode };
  }
}

export async function fetchRemoteRef(ref: string | null): Promise<boolean> {
  if (!ref) {
    return false;
  }
  const trimmedRef = ref.trim();
  if (!trimmedRef) {
    return false;
  }

  const remoteBranch = trimmedRef.replace(/^origin\//, "");
  const verifyRef = `refs/remotes/origin/${remoteBranch}`;
  const refspec = `refs/heads/${remoteBranch}:${verifyRef}`;

  log("DEBUG", "Fetching remote ref", { ref: trimmedRef, remoteBranch });

  const result = await runGitCommandSafe(
    ["fetch", "--no-tags", "--prune", "origin", refspec],
    true,
  );

  if (!result) {
    log("WARN", "git fetch failed for ref", { ref: trimmedRef });
    return false;
  }

  const trimmedStdout = result.stdout?.trim();
  if (trimmedStdout && trimmedStdout.length > 0) {
    log("DEBUG", "git fetch output", {
      ref: trimmedRef,
      output: trimmedStdout.slice(0, 160),
    });
  }

  const verifyResult = await runGitCommandSafe(
    ["rev-parse", "--verify", "--quiet", verifyRef],
    true,
  );

  if (verifyResult?.stdout?.trim()) {
    log("INFO", "Remote ref verified", {
      ref: trimmedRef,
      commit: verifyResult.stdout.trim(),
    });
    return true;
  }

  log("WARN", "Remote ref missing after fetch", { ref: trimmedRef });
  return false;
}

function formatDiff(diff: string): string {
  if (!diff) return "No changes detected";
  const trimmed = diff.trim();
  if (trimmed.length === 0) return "No changes detected";
  return trimmed;
}

export async function collectDiffForRun(
  baseBranch: string | undefined,
  branch: string | null,
): Promise<string> {
  if (!branch) {
    return "No changes detected";
  }

  const repoPath = await detectGitRepoPath();

  // Auto-detect base branch if not provided
  let sanitizedBase = baseBranch?.trim();
  if (!sanitizedBase) {
    // Try refs/remotes/origin/HEAD first (symref to default branch)
    sanitizedBase = await getRemoteHeadBranch(repoPath) ?? undefined;
    if (!sanitizedBase) {
      // Fallback: check if origin/main exists, otherwise use master
      const mainExists = await runGitCommand(
        "git rev-parse --verify origin/main",
        true,
        repoPath,
      );
      sanitizedBase = mainExists?.exitCode === 0 ? "main" : "master";
    }
    log("INFO", "Auto-detected base branch", { detectedBase: sanitizedBase });
  }

  log("INFO", "Collecting diff from remote branches", {
    baseBranch: sanitizedBase,
    branch,
  });

  await fetchRemoteRef(sanitizedBase);
  await fetchRemoteRef(branch);

  const baseRef = sanitizedBase.startsWith("origin/")
    ? sanitizedBase
    : `origin/${sanitizedBase}`;
  const branchRef = branch.startsWith("origin/") ? branch : `origin/${branch}`;

  let result;
  try {
    result = await execAsync("/usr/local/bin/cmux-collect-crown-diff.sh", {
      cwd: repoPath,
      maxBuffer: 5 * 1024 * 1024,
      env: {
        ...process.env,
        CMUX_DIFF_BASE: baseRef,
        CMUX_DIFF_HEAD_REF: branchRef,
      },
    });
  } catch (error) {
    const execError = error as ExecError;
    const stderr = execError.stderr ? String(execError.stderr).trim() : "";
    const stdout = execError.stdout ? String(execError.stdout).trim() : "";
    const exitCode = execError.code ?? execError.status ?? 1;

    log("ERROR", "Failed to collect diff for run", {
      baseBranch: sanitizedBase,
      branch,
      exitCode,
      stderr: stderr.slice(0, 500),
      stdout: stdout.slice(0, 500),
      message: execError.message,
    });

    throw new Error(
      `Failed to collect diff between ${baseRef} and ${branchRef}: ${stderr || execError.message}`,
    );
  }

  const { stdout, stderr } = result;

  if (stderr) {
    log("WARN", "cmux-collect-crown-diff.sh stderr", {
      stderr,
    });
  }

  const diff = stdout.trim();
  if (!diff) {
    log("INFO", "No differences found between branches", {
      base: baseRef,
      branch: branchRef,
    });
    return "No changes detected";
  }

  return formatDiff(diff);
}

export async function ensureBranchesAvailable(
  completedRuns: Array<{ id: string; newBranch: string | null }>,
  baseBranch: string | undefined,
): Promise<boolean> {
  // Auto-detect base branch if not provided
  const sanitizedBase = baseBranch || await getDefaultBaseBranch();
  const baseOk = await fetchRemoteRef(sanitizedBase);
  log("INFO", "Ensuring branches available", {
    baseBranch: sanitizedBase,
    baseOk,
    completedRunCount: completedRuns.length,
  });
  let allBranchesOk = true;
  for (const run of completedRuns) {
    if (!run.newBranch) {
      log("ERROR", "Run missing branch name", { runId: run.id });
      return false;
    }
    const branchOk = await fetchRemoteRef(run.newBranch);
    log("INFO", "Checked branch availability", {
      runId: run.id,
      branch: run.newBranch,
      branchOk,
    });
    if (!branchOk) {
      allBranchesOk = false;
    }
  }
  return baseOk && allBranchesOk;
}

export function buildCommitMessage({
  prompt,
  agentName,
}: {
  prompt: string;
  agentName: string;
}): string {
  const baseLine = prompt.trim().split("\n")[0] ?? "task";
  const subject =
    baseLine.length > 60 ? `${baseLine.slice(0, 57)}...` : baseLine;
  const sanitizedAgent = agentName.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `chore(${sanitizedAgent}): ${subject}`;
}

export async function getCurrentBranch(): Promise<string | null> {
  const result = await runGitCommand("git rev-parse --abbrev-ref HEAD", true);
  const branch = result?.stdout.trim();
  if (!branch) {
    log("WARN", "Unable to determine current git branch");
    return null;
  }
  return branch;
}

async function ensureGitRepository(gitPath: string): Promise<boolean> {
  const gitCheck = await runGitCommand(
    "git rev-parse --git-dir",
    true,
    gitPath,
  );
  if (gitCheck && gitCheck.exitCode === 0) {
    return true;
  }

  log("WARN", "Not in a git repository, initializing", { gitPath });
  const initResult = await runGitCommand("git init", true, gitPath);
  if (!initResult || initResult.exitCode !== 0) {
    log("ERROR", "Failed to initialize git repository", {
      gitPath,
      error: initResult?.stderr,
    });
    return false;
  }

  log("INFO", "Initialized git repository", { gitPath });
  return true;
}

async function configureRemote(
  remoteUrl: string,
  repoPath: string,
): Promise<void> {
  const currentRemote = await runGitCommand(
    "git remote get-url origin",
    true,
    repoPath,
  );
  const currentUrl = currentRemote?.stdout.trim();

  if (!currentUrl) {
    log("INFO", "Adding origin remote", { remoteUrl, repoPath });
    await runGitCommandSafe(
      ["remote", "add", "origin", remoteUrl],
      false,
      repoPath,
    );
  } else if (currentUrl !== remoteUrl) {
    log("INFO", "Updating origin remote", {
      currentRemote: currentUrl,
      remoteUrl,
      repoPath,
    });
    await runGitCommandSafe(
      ["remote", "set-url", "origin", remoteUrl],
      false,
      repoPath,
    );
  }

  const updatedRemote = await runGitCommand(
    "git remote -v",
    true,
    repoPath,
  );
  if (updatedRemote) {
    log("INFO", "Current git remotes", {
      repoPath,
      remotes: updatedRemote.stdout.trim().split("\n"),
    });
  }
}

function truncateOutput(output: string | undefined, length = 200): string {
  return output ? output.trim().slice(0, length) : "";
}

function redactSensitiveOutput(output: string): string {
  return output.replace(GITHUB_TOKEN_IN_URL_PATTERN, "$1***$3");
}

export async function pushWithEphemeralToken(
  branchName: string,
  repoPath: string,
  token: string,
  repoFullName: string,
): Promise<{ success: boolean; error?: string }> {
  const remoteUrl = `https://x-access-token:${token}@github.com/${repoFullName}.git`;

  try {
    // Avoid -u flag: it would persist the tokenized URL in .git/config as branch.<name>.remote
    await execFileAsync("git", ["push", remoteUrl, `HEAD:refs/heads/${branchName}`], {
      cwd: repoPath,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: resolveHomeDirectory(),
      },
    });
    return { success: true };
  } catch (error) {
    const execError: ExecError =
      error instanceof Error
        ? error
        : new Error(
            typeof error === "string"
              ? error
              : "Unknown git push with ephemeral token error",
          );
    const combinedError = redactSensitiveOutput(
      [
        String(execError.stdout ?? "").trim(),
        String(execError.stderr ?? "").trim(),
        execError.message ?? "",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    return {
      success: false,
      error: truncateOutput(combinedError, 200),
    };
  }
}

async function stageAndCommitChanges(
  branchName: string,
  commitMessage: string,
  repoPath: string,
): Promise<void> {
  await runGitCommand("git add -A", false, repoPath);
  log("INFO", "Staged all changes", { repoPath });

  await runGitCommandSafe(["checkout", "-B", branchName], false, repoPath);
  log("INFO", "Checked out branch", { branchName, repoPath });

  const status = await runGitCommand("git status --short", true, repoPath);
  const hasChanges = Boolean(status?.stdout.trim());

  if (status) {
    const lines = status.stdout.trim().split("\n");
    log("INFO", "Git status before commit", {
      branchName,
      repoPath,
      entries: lines.slice(0, 10),
      totalLines: status.stdout.trim() === "" ? 0 : lines.length,
    });
  }

  if (!hasChanges) {
    log("INFO", "No changes to commit", { branchName, repoPath });
    return;
  }

  const commitResult = await runGitCommandSafe(
    ["commit", "-m", commitMessage],
    true,
    repoPath,
  );

  if (commitResult) {
    log("INFO", "Created commit", {
      branchName,
      repoPath,
      stdout: truncateOutput(commitResult.stdout),
      stderr: truncateOutput(commitResult.stderr),
    });
  } else {
    log("WARN", "Commit command did not produce output", {
      branchName,
      repoPath,
    });
  }
}

async function syncWithRemote(
  branchName: string,
  repoPath: string,
): Promise<void> {
  const remoteExists = await runGitCommandSafe(
    ["ls-remote", "--heads", "origin", branchName],
    true,
    repoPath,
  );

  if (remoteExists?.stdout.trim()) {
    log("INFO", "Remote branch exists, rebasing", {
      branchName,
      repoPath,
      remoteHead: remoteExists.stdout.trim().slice(0, 120),
    });

    const pullResult = await runGitCommandSafe(
      ["pull", "--rebase", "origin", branchName],
      false,
      repoPath,
    );

    if (pullResult) {
      log("INFO", "Rebased branch onto remote", {
        branchName,
        repoPath,
        stdout: truncateOutput(pullResult.stdout),
        stderr: truncateOutput(pullResult.stderr),
      });
    }
  } else {
    log("INFO", "Remote branch does not exist, will create", {
      branchName,
      repoPath,
    });
  }
}

export async function autoCommitAndPush({
  branchName,
  commitMessage,
  remoteUrl,
  tokenSupplier,
}: {
  branchName: string;
  commitMessage: string;
  remoteUrl?: string;
  tokenSupplier?: PushTokenSupplier;
}): Promise<{ success: boolean; pushedRepos: string[]; errors: string[] }> {
  const result = { success: false, pushedRepos: [] as string[], errors: [] as string[] };

  if (!branchName) {
    const errorMsg = "Missing branch name for auto-commit";
    log("ERROR", errorMsg);
    result.errors.push(errorMsg);
    return result;
  }

  log("INFO", "[AUTOCOMMIT] Starting auto-commit workflow", {
    branchName,
    commitMessage: commitMessage.slice(0, 100),
    remoteUrl,
  });

  const repoPaths = await listGitRepoPaths();
  const repoHint = getRepoHint();
  const targets = repoPaths.length > 0 ? repoPaths : [WORKSPACE_ROOT];

  log("INFO", "[AUTOCOMMIT] Repository targets resolved", {
    branchName,
    repoHint,
    targetCount: targets.length,
    targets,
  });

  for (const repoPath of targets) {
    const repoName = basename(repoPath);
    log("INFO", "[AUTOCOMMIT] Processing repository", {
      branchName,
      repoPath,
      repoName,
    });

    const isRepo = await ensureGitRepository(repoPath);
    if (!isRepo) {
      const errorMsg = `Repository ensure failed: ${repoPath}`;
      log("WARN", "[AUTOCOMMIT] Skipping repository, ensure failed", { repoPath });
      result.errors.push(errorMsg);
      continue;
    }

    const protection = await checkProtectedBranch(branchName, repoPath);
    if (protection.isProtected) {
      log("WARN", "[AUTOCOMMIT] Skipped protected branch", {
        branchName,
        repoPath,
        remoteHead: protection.remoteHead,
        reason: protection.reason,
      });
      result.errors.push(`Protected branch skipped: ${branchName} in ${repoPath}`);
      continue;
    }

    const applyRemoteUrl =
      remoteUrl &&
      (targets.length === 1 || (repoHint && repoName === repoHint))
        ? remoteUrl
        : undefined;

    if (applyRemoteUrl) {
      log("INFO", "[AUTOCOMMIT] Configuring remote URL", {
        repoPath,
        remoteUrl: applyRemoteUrl,
      });
      await configureRemote(applyRemoteUrl, repoPath);
    }

    // Check current remote configuration
    const remoteCheck = await runGitCommand("git remote -v", true, repoPath);
    log("INFO", "[AUTOCOMMIT] Current remotes before push", {
      repoPath,
      remotes: remoteCheck?.stdout.trim().split("\n") || [],
    });

    await stageAndCommitChanges(branchName, commitMessage, repoPath);
    await syncWithRemote(branchName, repoPath);

    // Check git credential helper configuration
    const credentialHelper = await runGitCommand("git config --get credential.helper", true, repoPath);
    const ghAuthStatus = await runGitCommand("gh auth status 2>&1", true, repoPath);

    // Check what commits exist on this branch vs origin
    const currentHead = await runGitCommand("git rev-parse HEAD", true, repoPath);
    const logResult = await runGitCommand(`git log --oneline -5`, true, repoPath);

    log("INFO", "[AUTOCOMMIT] Pre-push diagnostic", {
      repoPath,
      branchName,
      credentialHelper: credentialHelper?.stdout.trim() || "not set",
      ghAuthStatus: ghAuthStatus?.stdout.trim().slice(0, 300) || "unknown",
      currentHead: currentHead?.stdout.trim() || "unknown",
      recentCommits: logResult?.stdout.trim().split("\n").slice(0, 3) || [],
    });

    log("INFO", "[AUTOCOMMIT] Pushing to remote", {
      branchName,
      repoPath,
      command: `git push -u origin ${branchName}`,
    });

    const pushResult = await runGitCommandSafe(
      ["push", "-u", "origin", branchName],
      true,
      repoPath,
    );

    if (!pushResult) {
      result.errors.push(`Push failed for ${repoPath}: no git output`);
      continue;
    }

    log("INFO", "[AUTOCOMMIT] Push completed", {
      branchName,
      repoPath,
      exitCode: pushResult.exitCode,
      stdout: truncateOutput(pushResult.stdout),
      stderr: truncateOutput(pushResult.stderr),
    });

    if (pushResult.exitCode === 0) {
      result.pushedRepos.push(repoPath);
      continue;
    }

    const pushOutput = `${pushResult.stdout}\n${pushResult.stderr}`;
    const pushErrorSnippet = truncateOutput(
      redactSensitiveOutput(pushOutput),
      200,
    );

    const canRetryWithFreshToken =
      Boolean(tokenSupplier) && (targets.length === 1 || Boolean(applyRemoteUrl));

    if (canRetryWithFreshToken && isAuthError(pushOutput) && tokenSupplier) {
      log("WARN", "[AUTOCOMMIT] Auth error detected, fetching fresh token for retry", {
        repoPath,
        branchName,
      });

      const freshAuth = await tokenSupplier();
      if (freshAuth?.token && freshAuth.repoFullName) {
        const retryResult = await pushWithEphemeralToken(
          branchName,
          repoPath,
          freshAuth.token,
          freshAuth.repoFullName,
        );

        if (retryResult.success) {
          result.pushedRepos.push(repoPath);
          log("INFO", "[AUTOCOMMIT] Push succeeded with fresh token", {
            repoPath,
            branchName,
          });
          continue;
        }

        log("ERROR", "[AUTOCOMMIT] Push retry with fresh token also failed", {
          repoPath,
          branchName,
          error: retryResult.error,
        });

        result.errors.push(
          `Push failed after auth refresh for ${repoPath}: ${retryResult.error ?? "Unknown error"}`,
        );
        continue;
      }

      log("WARN", "[AUTOCOMMIT] Fresh token unavailable for push retry", {
        repoPath,
        branchName,
      });
    }

    result.errors.push(
      `Push failed with exit code ${pushResult.exitCode}: ${pushErrorSnippet || "Unknown git error"}`,
    );
  }

  result.success = result.pushedRepos.length > 0;

  log("INFO", "[AUTOCOMMIT] Auto-commit workflow finished", {
    branchName,
    repositoriesProcessed: targets.length,
    pushedRepos: result.pushedRepos,
    errors: result.errors,
    success: result.success,
  });

  return result;
}
