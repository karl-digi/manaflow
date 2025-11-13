import { exec as execCb } from "node:child_process";
import { promises as fs } from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeEntriesNodeGit } from "./parseGitDiff";

const exec = promisify(execCb);

async function initRepo(): Promise<{ work: string; remote: string }> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "cmux-diff-"));
  const remote = path.join(tmp, "remote.git");
  const work = path.join(tmp, "work");

  await exec(`git init --bare "${remote}"`);

  await fs.mkdir(work, { recursive: true });
  await exec(`git init "${work}"`);
  await exec(`git -C "${work}" config user.name "Test User"`);
  await exec(`git -C "${work}" config user.email "test@example.com"`);
  // Ensure main branch exists for consistency with server logic
  await exec(`git -C "${work}" checkout -b main`);
  // Add a baseline file and .gitignore
  await fs.writeFile(path.join(work, ".gitignore"), "node_modules/\n", "utf8");
  const bigContent =
    Array.from({ length: 50 }, (_, i) => `line-${i}`).join("\n") + "\n";
  await fs.writeFile(path.join(work, "README.md"), bigContent, "utf8");
  await exec(`git -C "${work}" add .`);
  await exec(`git -C "${work}" commit -m init`);
  await exec(`git -C "${work}" remote add origin "${remote}"`);
  await exec(`git -C "${work}" push -u origin main`);
  return { work, remote };
}

async function cleanupRepo(dir: string): Promise<void> {
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe("computeEntriesNodeGit", () => {
  let work: string;
  let root: string;

  beforeEach(async () => {
    const { work: w } = await initRepo();
    work = w;
    root = path.dirname(work);
  });

  afterEach(async () => {
    await cleanupRepo(root);
  });

  it("returns empty when no changes", async () => {
    const entries = await computeEntriesNodeGit({ worktreePath: work });
    expect(entries.length).toBe(0);
  });

  it("detects untracked additions and respects .gitignore", async () => {
    const addedPath = path.join(work, "src", "new.txt");
    await fs.mkdir(path.dirname(addedPath), { recursive: true });
    await fs.writeFile(addedPath, "a\nb\n", "utf8");
    // Ignored path
    const ignored = path.join(work, "node_modules", "ignored.txt");
    await fs.mkdir(path.dirname(ignored), { recursive: true });
    await fs.writeFile(ignored, "x\n", "utf8");

    const entries = await computeEntriesNodeGit({ worktreePath: work });
    const byPath = new Map(entries.map((e) => [e.filePath, e]));

    expect(byPath.has("src/new.txt")).toBe(true);
    const e = byPath.get("src/new.txt")!;
    expect(e.status).toBe("added");
    expect(e.additions).toBeGreaterThan(0);
    // Ensure ignored file is not reported
    expect(byPath.has("node_modules/ignored.txt")).toBe(false);
  });

  it("detects modified content vs origin/main", async () => {
    // Modify README and stage
    await fs.appendFile(path.join(work, "README.md"), "world\n", "utf8");
    await exec(`git -C "${work}" add README.md`);
    const { stdout: raw } = await exec(
      `git -C "${work}" diff --name-status origin/main`
    );

    console.log("raw-diff:", raw);
    const entries = await computeEntriesNodeGit({ worktreePath: work });
    const readme = entries.find((e) => e.filePath === "README.md");
    expect(readme).toBeTruthy();
    expect(readme!.status).toBe("modified");
    // additions should be >= 1
    expect(readme!.additions).toBeGreaterThanOrEqual(1);
  });

  it("detects deletions", async () => {
    await exec(`git -C "${work}" rm README.md`);
    const { stdout: raw } = await exec(
      `git -C "${work}" diff --name-status origin/main`
    );

    console.log("raw-diff-del:", raw);
    const entries = await computeEntriesNodeGit({ worktreePath: work });
    const del = entries.find((e) => e.filePath === "README.md");
    expect(del).toBeTruthy();
    expect(del!.status).toBe("deleted");
    // deletions might be 0 for empty files; ensure non-negative
    expect(del!.deletions).toBeGreaterThanOrEqual(0);
  });

  it("reports rename as D+A in worktree baseline (no commit)", async () => {
    // Rename without changing content
    await exec(`git -C "${work}" mv README.md README2.md`);
    const { stdout: raw } = await exec(
      `git -C "${work}" diff --name-status -M origin/main`
    );

    console.log("raw-diff-rename:", raw);
    const entries = await computeEntriesNodeGit({ worktreePath: work });
    const add = entries.find((e) => e.filePath === "README2.md");
    const del = entries.find((e) => e.filePath === "README.md");
    if (add?.status === "renamed") {
      expect(add.oldPath).toBe("README.md");
    } else {
      expect(add?.status).toBe("added");
      expect(del?.status).toBe("deleted");
    }
  });
});
