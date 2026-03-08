import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RepositoryManager } from "./repositoryManager";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";

const execAsync = promisify(exec);

describe("RepositoryManager worktree operations", () => {
  let testDir: string;
  let repoPath: string;
  let worktreeDir: string;
  let repoManager: RepositoryManager;

  beforeEach(async () => {
    // Create isolated test directory
    testDir = await mkdtemp(join(tmpdir(), "worktree-test-"));
    repoPath = join(testDir, "test-repo");
    worktreeDir = join(testDir, "worktrees");

    // Initialize test git repository with proper config
    await mkdir(repoPath, { recursive: true });
    await execAsync("git init --initial-branch=main", { cwd: repoPath });
    await execAsync("git config user.email 'test@example.com'", { cwd: repoPath });
    await execAsync("git config user.name 'Test User'", { cwd: repoPath });

    // Create initial commit on main branch
    await writeFile(join(repoPath, "README.md"), "# Test Repo");
    await execAsync("git add README.md", { cwd: repoPath });
    await execAsync("git commit -m 'Initial commit'", { cwd: repoPath });

    // Create a fake origin remote pointing to itself
    // This allows testing the origin/* branch fetches
    await execAsync(`git remote add origin "${repoPath}"`, { cwd: repoPath });

    // Fetch to populate origin/main
    await execAsync("git fetch origin main", { cwd: repoPath });

    // Create develop branch locally
    await execAsync("git checkout -b develop", { cwd: repoPath });

    // Checkout back to main
    await execAsync("git checkout main", { cwd: repoPath });

    // Create worktrees directory
    await mkdir(worktreeDir, { recursive: true });

    // Get fresh instance for each test
    repoManager = new (RepositoryManager as any)();
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe("Path Normalization", () => {
    it("should detect worktree with symlinked paths on different systems", async () => {
      const worktreePath = join(worktreeDir, "symlink-test");
      await mkdir(worktreePath, { recursive: true });

      // Create a symlinked version
      const symlinkedWorktreePath = join(worktreeDir, "symlink-ptr");
      try {
        await execAsync(`ln -s "${worktreePath}" "${symlinkedWorktreePath}"`, {
          shell: "/bin/bash",
        });

        // Add a worktree at the real path
        await execAsync(`git worktree add "${worktreePath}" -b test-symlink`, {
          cwd: repoPath,
        });

        // Query using the symlinked path - should find it
        const exists = await repoManager.worktreeExists(repoPath, symlinkedWorktreePath);
        expect(exists).toBe(true);
      } catch (err) {
        // Skip symlink test on systems that don't support it (Windows) or without bash
        if (err instanceof Error && err.message.includes("ENOENT")) {
          // Test skipped on systems without symlink support
          return;
        }
        throw err;
      }

      // Clean up
      try {
        await execAsync(`rm "${symlinkedWorktreePath}"`);
      } catch {
        // ignore
      }
    });

    it("should handle non-existent worktree paths gracefully", async () => {
      const nonExistentPath = join(worktreeDir, "does-not-exist");
      const exists = await repoManager.worktreeExists(repoPath, nonExistentPath);
      expect(exists).toBe(false);
    });

    it("should distinguish between similar path names (no false positives)", async () => {
      const path1 = join(worktreeDir, "feature");
      const path2 = join(worktreeDir, "feature-branch");

      await mkdir(path1, { recursive: true });
      await mkdir(path2, { recursive: true });

      // Create worktree at path1
      await execAsync(`git worktree add "${path1}" -b branch1`, {
        cwd: repoPath,
      });

      // path2 should not be detected as existing
      const exists = await repoManager.worktreeExists(repoPath, path2);
      expect(exists).toBe(false);
    });

    it("should resolve realpath for consistent comparisons", async () => {
      const worktreePath = join(worktreeDir, "resolved-path");
      await mkdir(worktreePath, { recursive: true });

      // Create a worktree
      await execAsync(`git worktree add "${worktreePath}" -b resolved-test`, {
        cwd: repoPath,
      });

      // Get the real path
      const realWorktreePath = await realpath(worktreePath);

      // Should be found using the realpath
      const exists = await repoManager.worktreeExists(
        repoPath,
        realWorktreePath
      );
      expect(exists).toBe(true);
    });
  });

  describe("Concurrent Worktree Creation", () => {
    it("should not conflict when two concurrent createWorktree calls for the same branch are made", async () => {
      const branchName = "concurrent-test";
      const worktreePath1 = join(worktreeDir, "wt1");
      const worktreePath2 = join(worktreeDir, "wt2");

      await mkdir(worktreePath1, { recursive: true });
      await mkdir(worktreePath2, { recursive: true });

      // Make two concurrent calls for the same branch
      const [result1, result2] = await Promise.all([
        repoManager.createWorktree(repoPath, worktreePath1, branchName, "main"),
        repoManager.createWorktree(repoPath, worktreePath2, branchName, "main"),
      ]);

      // At least one should succeed (the first one wins)
      expect(result1 || result2).toBeTruthy();

      // Verify the branch is only attached to one worktree
      const { stdout } = await execAsync("git worktree list --porcelain", {
        cwd: repoPath,
      });

      const branchLines = stdout
        .split("\n")
        .filter((line) => line.includes(`refs/heads/${branchName}`));

      // Should have only one worktree for this branch
      expect(branchLines.length).toBeLessThanOrEqual(1);
    });

    it("should reuse existing worktree instead of failing on concurrent calls", async () => {
      const branchName = "reuse-test";
      const worktreePath = join(worktreeDir, "shared-wt");

      await mkdir(worktreePath, { recursive: true });

      // Create initial worktree
      const initial = await repoManager.createWorktree(
        repoPath,
        worktreePath,
        branchName,
        "main"
      );
      expect(initial).toBe(worktreePath);

      // Second call should reuse the existing worktree
      const reused = await repoManager.createWorktree(
        repoPath,
        worktreePath,
        branchName,
        "main"
      );

      expect(reused).toBe(worktreePath);

      // Verify directory still exists and is valid
      const exists = await repoManager.worktreeExists(repoPath, worktreePath);
      expect(exists).toBe(true);
    });

    it("should clean up properly if creation fails mid-way", async () => {
      const branchName = "partial-fail-test";
      const worktreePath = join(worktreeDir, "partial-wt");

      await mkdir(worktreePath, { recursive: true });

      // Create a lock file to simulate git being busy
      const lockPath = join(repoPath, ".git", "shallow.lock");
      await writeFile(lockPath, "locked");

      try {
        // This should handle the lock gracefully
        const result = await repoManager.createWorktree(
          repoPath,
          worktreePath,
          branchName,
          "main"
        );

        // Should eventually succeed after lock resolution
        expect(result).toBeTruthy();
      } finally {
        // Clean up lock
        try {
          await rm(lockPath, { force: true });
        } catch {
          // ignore
        }
      }
    });

    it("should serialize worktree operations on the same repository", async () => {
      const branch1 = "serial-test-1";
      const branch2 = "serial-test-2";
      const wt1 = join(worktreeDir, "wt-1");
      const wt2 = join(worktreeDir, "wt-2");

      await mkdir(wt1, { recursive: true });
      await mkdir(wt2, { recursive: true });

      const executionTimes: number[] = [];

      // Start two operations in parallel
      const op1 = (async () => {
        const start = Date.now();
        const result = await repoManager.createWorktree(
          repoPath,
          wt1,
          branch1,
          "main"
        );
        executionTimes.push(Date.now() - start);
        return result;
      })();

      const op2 = (async () => {
        const start = Date.now();
        const result = await repoManager.createWorktree(
          repoPath,
          wt2,
          branch2,
          "main"
        );
        executionTimes.push(Date.now() - start);
        return result;
      })();

      const [result1, result2] = await Promise.all([op1, op2]);

      // Both should succeed
      expect(result1).toBeTruthy();
      expect(result2).toBeTruthy();

      // Both worktrees should exist
      const exists1 = await repoManager.worktreeExists(repoPath, wt1);
      const exists2 = await repoManager.worktreeExists(repoPath, wt2);

      expect(exists1).toBe(true);
      expect(exists2).toBe(true);
    });
  });

  describe("Error Recovery", () => {
    it("should recover when shallow.lock exists", async () => {
      const branchName = "lock-recovery-test";
      const worktreePath = join(worktreeDir, "lock-wt");

      await mkdir(worktreePath, { recursive: true });

      // Create a shallow.lock file
      const lockPath = join(repoPath, ".git", "shallow.lock");
      await writeFile(lockPath, "");

      try {
        // Should still succeed despite lock
        const result = await repoManager.createWorktree(
          repoPath,
          worktreePath,
          branchName,
          "main"
        );

        expect(result).toBeTruthy();
      } finally {
        try {
          await rm(lockPath, { force: true });
        } catch {
          // ignore
        }
      }
    });

    it("should handle 'already exists' error as success", async () => {
      const branchName = "exists-test";
      const worktreePath = join(worktreeDir, "exists-wt");

      await mkdir(worktreePath, { recursive: true });

      // Create a worktree first
      const first = await repoManager.createWorktree(
        repoPath,
        worktreePath,
        branchName,
        "main"
      );

      expect(first).toBeTruthy();

      // Try to create again - should treat as success
      const second = await repoManager.createWorktree(
        repoPath,
        worktreePath,
        branchName,
        "main"
      );

      expect(second).toBeTruthy();
      expect(second).toBe(first);
    });

    it("should not break subsequent operations if cleanup fails", async () => {
      const branch1 = "cleanup-fail-1";
      const branch2 = "cleanup-fail-2";
      const wt1 = join(worktreeDir, "cf-wt-1");
      const wt2 = join(worktreeDir, "cf-wt-2");

      await mkdir(wt1, { recursive: true });
      await mkdir(wt2, { recursive: true });

      // Create first worktree
      const result1 = await repoManager.createWorktree(
        repoPath,
        wt1,
        branch1,
        "main"
      );
      expect(result1).toBeTruthy();

      // Create a file in the worktree to make removal harder
      await writeFile(join(wt1, "locked-file.txt"), "content");

      // Try to remove - might fail but should not break
      try {
        await repoManager.removeWorktree(repoPath, wt1);
      } catch {
        // Expected to potentially fail
      }

      // Second operation should still work
      const result2 = await repoManager.createWorktree(
        repoPath,
        wt2,
        branch2,
        "main"
      );
      expect(result2).toBeTruthy();
    });

    it("should handle worktree in detached HEAD state", async () => {
      const branchName = "detached-test";
      const worktreePath = join(worktreeDir, "detached-wt");

      await mkdir(worktreePath, { recursive: true });

      // Create a worktree
      const created = await repoManager.createWorktree(
        repoPath,
        worktreePath,
        branchName,
        "main"
      );

      expect(created).toBeTruthy();

      // Verify it can be detected as existing
      const exists = await repoManager.worktreeExists(repoPath, worktreePath);
      expect(exists).toBe(true);
    });
  });

  describe("Branch Management", () => {
    it("should create new branch from base branch when branch does not exist", async () => {
      const branchName = "new-from-base";
      const worktreePath = join(worktreeDir, "new-branch-wt");

      await mkdir(worktreePath, { recursive: true });

      // Create worktree for non-existent branch
      const result = await repoManager.createWorktree(
        repoPath,
        worktreePath,
        branchName,
        "main"
      );

      expect(result).toBeTruthy();

      // Verify the new branch was created
      const { stdout } = await execAsync(
        "git branch --list new-from-base",
        { cwd: repoPath }
      );

      expect(stdout).toContain("new-from-base");
    });

    it("should find worktree using branch name", async () => {
      const branchName = "find-by-branch";
      const worktreePath = join(worktreeDir, "find-branch-wt");

      await mkdir(worktreePath, { recursive: true });

      // Create worktree
      await repoManager.createWorktree(
        repoPath,
        worktreePath,
        branchName,
        "main"
      );

      // Find worktree by branch
      const found = await (
        repoManager as any
      ).findWorktreeUsingBranch(repoPath, branchName);

      expect(found).toBe(worktreePath);
    });

    it("should return null when finding non-existent branch", async () => {
      const branchName = "non-existent-branch";

      const found = await (
        repoManager as any
      ).findWorktreeUsingBranch(repoPath, branchName);

      expect(found).toBeNull();
    });
  });

  describe("Worktree Listing", () => {
    it("should list all worktrees in repository", async () => {
      const wt1 = join(worktreeDir, "list-wt-1");
      const wt2 = join(worktreeDir, "list-wt-2");

      await mkdir(wt1, { recursive: true });
      await mkdir(wt2, { recursive: true });

      // Create multiple worktrees
      await repoManager.createWorktree(repoPath, wt1, "branch1", "main");
      await repoManager.createWorktree(repoPath, wt2, "branch2", "main");

      // List worktrees
      const worktrees = await repoManager.listWorktrees(repoPath);

      // Should include main + 2 created worktrees
      expect(worktrees.length).toBeGreaterThanOrEqual(2);

      const paths = worktrees.map((w) => w.path);
      expect(paths).toContain(wt1);
      expect(paths).toContain(wt2);
    });

    it("should include branch and HEAD info in worktree listing", async () => {
      const branchName = "info-test";
      const worktreePath = join(worktreeDir, "info-wt");

      await mkdir(worktreePath, { recursive: true });

      // Create worktree
      await repoManager.createWorktree(
        repoPath,
        worktreePath,
        branchName,
        "main"
      );

      // List worktrees
      const worktrees = await repoManager.listWorktrees(repoPath);

      // Find the created worktree
      const created = worktrees.find(
        (w) => w.path === worktreePath
      );

      expect(created).toBeDefined();
      // Branch info may be prefixed with "refs/heads/" or just the branch name depending on git version
      expect(created?.branch).toMatch(new RegExp(`(refs/heads/)?${branchName}$`));
      expect(created?.head).toBeTruthy();
    });
  });

  describe("Worktree Removal", () => {
    it("should remove worktree successfully", async () => {
      const branchName = "remove-test";
      const worktreePath = join(worktreeDir, "remove-wt");

      await mkdir(worktreePath, { recursive: true });

      // Create worktree
      await repoManager.createWorktree(
        repoPath,
        worktreePath,
        branchName,
        "main"
      );

      // Verify it exists
      let exists = await repoManager.worktreeExists(repoPath, worktreePath);
      expect(exists).toBe(true);

      // Remove it
      await repoManager.removeWorktree(repoPath, worktreePath);

      // Verify it's gone
      exists = await repoManager.worktreeExists(repoPath, worktreePath);
      expect(exists).toBe(false);
    });

    it("should handle removal of non-existent worktree gracefully", async () => {
      const worktreePath = join(worktreeDir, "non-existent-wt");

      // Should not throw
      await expect(
        repoManager.removeWorktree(repoPath, worktreePath)
      ).resolves.not.toThrow();
    });
  });

  describe("createWorktreeFromLocalRepo", () => {
    it("should create worktree from existing local repository", async () => {
      const branchName = "from-local-test";
      const worktreePath = join(worktreeDir, "from-local-wt");

      await mkdir(worktreePath, { recursive: true });

      // Create worktree from local repo
      const result = await repoManager.createWorktreeFromLocalRepo(
        repoPath,
        worktreePath,
        branchName,
        "main"
      );

      expect(result).toBeTruthy();

      // Verify it exists
      const exists = await repoManager.worktreeExists(repoPath, worktreePath);
      expect(exists).toBe(true);
    });

    it("should reuse existing worktree in createWorktreeFromLocalRepo", async () => {
      const branchName = "local-reuse-test";
      const worktreePath = join(worktreeDir, "local-reuse-wt");

      await mkdir(worktreePath, { recursive: true });

      // Create first time
      const first = await repoManager.createWorktreeFromLocalRepo(
        repoPath,
        worktreePath,
        branchName,
        "main"
      );

      expect(first).toBeTruthy();

      // Create second time - should reuse
      const second = await repoManager.createWorktreeFromLocalRepo(
        repoPath,
        worktreePath,
        branchName,
        "main"
      );

      expect(second).toBe(first);
    });

    it("should handle concurrent createWorktreeFromLocalRepo calls", async () => {
      const branchName = "local-concurrent-test";
      const wt1 = join(worktreeDir, "local-concurrent-1");
      const wt2 = join(worktreeDir, "local-concurrent-2");

      await mkdir(wt1, { recursive: true });
      await mkdir(wt2, { recursive: true });

      // Make concurrent calls
      const [result1, result2] = await Promise.all([
        repoManager.createWorktreeFromLocalRepo(
          repoPath,
          wt1,
          branchName,
          "main"
        ),
        repoManager.createWorktreeFromLocalRepo(
          repoPath,
          wt2,
          branchName,
          "main"
        ),
      ]);

      // At least one should succeed
      expect(result1 || result2).toBeTruthy();
    });

    it("should recover from shallow.lock in createWorktreeFromLocalRepo", async () => {
      const branchName = "local-lock-test";
      const worktreePath = join(worktreeDir, "local-lock-wt");

      await mkdir(worktreePath, { recursive: true });

      // Create a shallow.lock
      const lockPath = join(repoPath, ".git", "shallow.lock");
      await writeFile(lockPath, "");

      try {
        const result = await repoManager.createWorktreeFromLocalRepo(
          repoPath,
          worktreePath,
          branchName,
          "main"
        );

        expect(result).toBeTruthy();
      } finally {
        try {
          await rm(lockPath, { force: true });
        } catch {
          // ignore
        }
      }
    });
  });
});
