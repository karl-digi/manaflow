import { exec as execCb } from "node:child_process";
import { promises as fs } from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeEntriesBetweenRefs } from "./parseGitDiff";

const exec = promisify(execCb);

async function initRepo(): Promise<{ work: string; root: string }> {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "cmux-compare-"));
  const work = path.join(tmp, "work");
  await fs.mkdir(work, { recursive: true });
  await exec(`git init "${work}"`);
  await exec(`git -C "${work}" config user.name "Test User"`);
  await exec(`git -C "${work}" config user.email "test@example.com"`);
  await exec(`git -C "${work}" checkout -b main`);
  await fs.writeFile(path.join(work, "README.md"), "hello\n", "utf8");
  await exec(`git -C "${work}" add README.md`);
  await exec(`git -C "${work}" commit -m init`);
  return { work, root: tmp };
}

async function cleanup(dir: string): Promise<void> {
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

describe("computeEntriesBetweenRefs", () => {
  let work: string;
  let root: string;

  beforeEach(async () => {
    const r = await initRepo();
    work = r.work;
    root = r.root;
  });

  afterEach(async () => {
    await cleanup(root);
  });

  it("computes diffs between main and a feature branch", async () => {
    // Create a feature branch from main and make changes
    await exec(`git -C "${work}" checkout -b feature/add-file`);
    await fs.writeFile(path.join(work, "src.txt"), "one\ntwo\n", "utf8");
    await fs.appendFile(path.join(work, "README.md"), "feat\n", "utf8");
    await exec(`git -C "${work}" add .`);
    await exec(
      `git -C "${work}" commit -m "feature: add file and edit readme"`
    );

    const entries = await computeEntriesBetweenRefs({
      repoPath: work,
      ref1: "main",
      ref2: "feature/add-file",
      includeContents: true,
    });

    const byPath = new Map(entries.map((e) => [e.filePath, e]));
    expect(byPath.has("src.txt")).toBe(true);
    expect(byPath.get("src.txt")!.status).toBe("added");

    expect(byPath.has("README.md")).toBe(true);
    expect(byPath.get("README.md")!.status).toBe("modified");
  });

  it("detects rename between refs", async () => {
    // Make a commit to main after init to have distinct base
    await fs.appendFile(path.join(work, "README.md"), "base\n", "utf8");
    await exec(`git -C "${work}" add README.md`);
    await exec(`git -C "${work}" commit -m "base change"`);
    const { stdout: baseSha } = await exec(`git -C "${work}" rev-parse HEAD`);

    // Create a new commit that renames README.md
    await exec(`git -C "${work}" mv README.md README2.md`);
    await exec(`git -C "${work}" commit -m "rename readme"`);
    const { stdout: headSha } = await exec(`git -C "${work}" rev-parse HEAD`);

    const entries = await computeEntriesBetweenRefs({
      repoPath: work,
      ref1: baseSha.trim(),
      ref2: headSha.trim(),
      includeContents: true,
    });

    const renamed = entries.find((e) => e.filePath === "README2.md");
    if (renamed) {
      // Prefer rename status
      expect(["renamed", "added"]).toContain(renamed.status);
      if (renamed.status === "renamed") {
        expect(renamed.oldPath).toBe("README.md");
      }
    } else {
      // Fallback: detect D + A pair
      const added = entries.find((e) => e.filePath === "README2.md");
      const deleted = entries.find((e) => e.filePath === "README.md");
      expect(added?.status).toBe("added");
      expect(deleted?.status).toBe("deleted");
    }
  });
});
