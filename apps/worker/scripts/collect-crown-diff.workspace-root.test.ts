import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function run(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

describe("collect-crown-diff.sh workspace discovery", () => {
  let workspaceDir: string;
  const scriptPath = fileURLToPath(new URL("./collect-crown-diff.sh", import.meta.url));

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), "cmux-crown-workspace-"));
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("collects diff when a repository lives at workspace/root", () => {
    const rootRepo = join(workspaceDir, "root");
    mkdirSync(rootRepo, { recursive: true });

    run("git init", rootRepo);
    run("git config user.email test@example.com", rootRepo);
    run("git config user.name Test User", rootRepo);

    const rootFile = join(rootRepo, "root-app.ts");
    writeFileSync(rootFile, "console.log('root base');\n");
    run("git add root-app.ts", rootRepo);
    run("git commit -m base", rootRepo);

    writeFileSync(rootFile, "console.log('root change');\n");

    const scriptPath = fileURLToPath(new URL("./collect-crown-diff.sh", import.meta.url));
    const diff = execFileSync("bash", [scriptPath], { cwd: workspaceDir }).toString();

    expect(diff).toContain("root-app.ts");
    expect(diff).toContain("root change");
  });

  it("collects diff from single nested repository", () => {
    const repoDir = join(workspaceDir, "solo-repo");
    mkdirSync(repoDir, { recursive: true });

    run("git init", repoDir);
    run("git config user.email test@example.com", repoDir);
    run("git config user.name Test User", repoDir);

    const filePath = join(repoDir, "solo.ts");
    writeFileSync(filePath, "console.log('base');\n");
    run("git add solo.ts", repoDir);
    run("git commit -m base", repoDir);

    writeFileSync(filePath, "console.log('updated');\n");

    const diff = execFileSync("bash", [scriptPath], { cwd: workspaceDir }).toString();

    expect(diff).toContain("solo.ts");
    expect(diff).toContain("updated");
  });

  it("collects diff from all nested repositories", () => {
    const alphaRepo = join(workspaceDir, "alpha-repo");
    const betaRepo = join(workspaceDir, "beta-repo");

    mkdirSync(alphaRepo, { recursive: true });
    mkdirSync(betaRepo, { recursive: true });

    run("git init", alphaRepo);
    run("git config user.email test@example.com", alphaRepo);
    run("git config user.name Test User", alphaRepo);
    writeFileSync(join(alphaRepo, "app.ts"), "console.log('base');\n");
    run("git add app.ts", alphaRepo);
    run("git commit -m base", alphaRepo);

    writeFileSync(join(alphaRepo, "app.ts"), "console.log('alpha change');\n");

    run("git init", betaRepo);
    run("git config user.email test@example.com", betaRepo);
    run("git config user.name Test User", betaRepo);
    writeFileSync(join(betaRepo, "README.md"), "beta base\n");
    run("git add README.md", betaRepo);
    run("git commit -m base", betaRepo);

    writeFileSync(join(betaRepo, "README.md"), "beta change\n");

    const diff = execFileSync("bash", [scriptPath], { cwd: workspaceDir }).toString();

    expect(diff).toContain("app.ts");
    expect(diff).toContain("alpha change");
    expect(diff).toContain("README.md");
    expect(diff).toContain("beta change");
  });
});
