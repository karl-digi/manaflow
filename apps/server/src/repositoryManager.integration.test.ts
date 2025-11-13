import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RepositoryManager } from "./repositoryManager";

const execAsync = promisify(exec);

describe("RepositoryManager - Integration Tests", () => {
  let testDir: string;
  let testRepoPath: string;
  let bareRepoPath: string;
  let repoManager: RepositoryManager;

  beforeAll(async () => {
    // Create a temporary directory for tests
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "cmux-repo-test-"));
    testRepoPath = path.join(testDir, "test-repo");
    bareRepoPath = path.join(testDir, "test-repo.git");

    // Initialize a test git repository
    await fs.mkdir(testRepoPath, { recursive: true });
    await execAsync("git init", { cwd: testRepoPath });
    await execAsync("git config user.email 'test@example.com'", {
      cwd: testRepoPath,
    });
    await execAsync("git config user.name 'Test User'", { cwd: testRepoPath });

    // Create initial commit
    await fs.writeFile(path.join(testRepoPath, "README.md"), "# Test Repo");
    await execAsync("git add .", { cwd: testRepoPath });
    await execAsync("git commit -m 'Initial commit'", { cwd: testRepoPath });

    // Create main branch explicitly
    await execAsync("git branch -M main", { cwd: testRepoPath });

    // Set up a bare repository to act as remote
    await execAsync(`git clone --bare ${testRepoPath} ${bareRepoPath}`);
    await execAsync(`git remote add origin ${bareRepoPath}`, {
      cwd: testRepoPath,
    });
    await execAsync("git push -u origin main", { cwd: testRepoPath });

    // Create repository manager instance
    repoManager = RepositoryManager.getInstance();
  });

  afterAll(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      console.error("Failed to clean up test directory:", error);
    }
  });

  it("should create a worktree for a new branch", async () => {
    const worktreePath = path.join(testDir, "worktree-1");
    const branchName = "feature-test-1";

    await repoManager.createWorktree(
      testRepoPath,
      worktreePath,
      branchName,
      "main"
    );

    // Verify worktree exists
    const exists = await fs
      .access(worktreePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    // Verify correct branch
    const { stdout } = await execAsync("git branch --show-current", {
      cwd: worktreePath,
    });
    expect(stdout.trim()).toBe(branchName);

    // Clean up
    await execAsync(`git worktree remove "${worktreePath}" --force`, {
      cwd: testRepoPath,
    }).catch(() => {});
  });

  it("should handle existing branch when creating worktree", async () => {
    const worktreePath = path.join(testDir, "worktree-2");
    const branchName = "feature-test-2";

    // Create branch first
    await execAsync(`git checkout -b ${branchName}`, { cwd: testRepoPath });
    await execAsync("git checkout main", { cwd: testRepoPath });

    // Should still create worktree even though branch exists
    await repoManager.createWorktree(
      testRepoPath,
      worktreePath,
      branchName,
      "main"
    );

    // Verify worktree exists
    const exists = await fs
      .access(worktreePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    // Verify correct branch
    const { stdout } = await execAsync("git branch --show-current", {
      cwd: worktreePath,
    });
    expect(stdout.trim()).toBe(branchName);

    // Clean up
    await execAsync(`git worktree remove "${worktreePath}" --force`, {
      cwd: testRepoPath,
    }).catch(() => {});
  });

  it("should detect if worktree exists", async () => {
    const worktreePath = path.join(testDir, "worktree-3");
    const branchName = "feature-test-3";

    // Initially should not exist
    let exists = await repoManager.worktreeExists(testRepoPath, worktreePath);
    expect(exists).toBe(false);

    // Create worktree
    await execAsync(
      `git worktree add -b ${branchName} "${worktreePath}" main`,
      { cwd: testRepoPath }
    );

    // Now should exist
    exists = await repoManager.worktreeExists(testRepoPath, worktreePath);
    expect(exists).toBe(true);

    // Clean up
    await execAsync(`git worktree remove "${worktreePath}" --force`, {
      cwd: testRepoPath,
    }).catch(() => {});
  });

  it("should remove worktree", async () => {
    const worktreePath = path.join(testDir, "worktree-4");
    const branchName = "feature-test-4";

    // Create worktree
    await execAsync(
      `git worktree add -b ${branchName} "${worktreePath}" main`,
      { cwd: testRepoPath }
    );

    // Verify it exists
    let exists = await repoManager.worktreeExists(testRepoPath, worktreePath);
    expect(exists).toBe(true);

    // Remove it
    await repoManager.removeWorktree(testRepoPath, worktreePath);

    // Verify it's gone
    exists = await repoManager.worktreeExists(testRepoPath, worktreePath);
    expect(exists).toBe(false);
  });

  it("should get current branch", async () => {
    const worktreePath = path.join(testDir, "worktree-5");
    const branchName = "feature-test-5";

    // Create worktree
    await execAsync(
      `git worktree add -b ${branchName} "${worktreePath}" main`,
      { cwd: testRepoPath }
    );

    // Get current branch
    const currentBranch = await repoManager.getCurrentBranch(worktreePath);
    expect(currentBranch).toBe(branchName);

    // Clean up
    await execAsync(`git worktree remove "${worktreePath}" --force`, {
      cwd: testRepoPath,
    }).catch(() => {});
  });

  it("should execute git commands", async () => {
    const { stdout } = await repoManager.executeGitCommand(
      "git status --short",
      { cwd: testRepoPath }
    );
    expect(stdout).toBeDefined();
  });

  it("should handle branch already used by another worktree", async () => {
    const oldWorktreePath = path.join(testDir, "worktree-old");
    const newWorktreePath = path.join(testDir, "worktree-new");
    const branchName = "feature-conflict";

    // Create first worktree with the branch
    await repoManager.createWorktree(
      testRepoPath,
      oldWorktreePath,
      branchName,
      "main"
    );

    // Verify old worktree exists
    let exists = await fs
      .access(oldWorktreePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    // Try to create new worktree with same branch - should remove old one
    await repoManager.createWorktree(
      testRepoPath,
      newWorktreePath,
      branchName,
      "main"
    );

    // Verify new worktree exists
    exists = await fs
      .access(newWorktreePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    // Verify old worktree was removed from git
    const oldWorktreeRegistered = await repoManager.worktreeExists(
      testRepoPath,
      oldWorktreePath
    );
    expect(oldWorktreeRegistered).toBe(false);

    // Clean up
    await execAsync(`git worktree remove "${newWorktreePath}" --force`, {
      cwd: testRepoPath,
    }).catch(() => {});
  });

  it("should handle worktree with branch that already exists in origin", async () => {
    const worktreePath = path.join(testDir, "worktree-6");
    const branchName = "feature-test-6";

    // Create and push branch to origin
    await execAsync(`git checkout -b ${branchName}`, { cwd: testRepoPath });
    await fs.writeFile(path.join(testRepoPath, "test.txt"), "test content");
    await execAsync("git add .", { cwd: testRepoPath });
    await execAsync("git commit -m 'Add test file'", { cwd: testRepoPath });
    await execAsync(`git push origin ${branchName}`, { cwd: testRepoPath });
    await execAsync("git checkout main", { cwd: testRepoPath });

    // Should handle existing branch gracefully
    await repoManager.createWorktree(
      testRepoPath,
      worktreePath,
      branchName,
      "main"
    );

    // Verify worktree exists and is on correct branch
    const exists = await fs
      .access(worktreePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    const { stdout } = await execAsync("git branch --show-current", {
      cwd: worktreePath,
    });
    expect(stdout.trim()).toBe(branchName);

    // Clean up
    await execAsync(`git worktree remove "${worktreePath}" --force`, {
      cwd: testRepoPath,
    }).catch(() => {});
  });

  it("should be idempotent when creating the same worktree twice", async () => {
    const worktreePath = path.join(testDir, "worktree-idempotent");
    const branchName = "feature-idempotent";

    // First creation
    await repoManager.createWorktree(
      testRepoPath,
      worktreePath,
      branchName,
      "main"
    );

    // Second creation should not throw and should be treated as success
    await repoManager.createWorktree(
      testRepoPath,
      worktreePath,
      branchName,
      "main"
    );

    // Verify worktree exists and is on correct branch
    const exists = await fs
      .access(worktreePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    const { stdout } = await execAsync("git branch --show-current", {
      cwd: worktreePath,
    });
    expect(stdout.trim()).toBe(branchName);

    // Clean up
    await execAsync(`git worktree remove "${worktreePath}" --force`, {
      cwd: testRepoPath,
    }).catch(() => {});
  });
});
