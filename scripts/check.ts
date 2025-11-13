#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

type Pkg = {
  name: string;
  path: string; // relative to repo root
  hasLint: boolean;
  hasTypecheck: boolean;
};

type CheckKind = "lint" | "typecheck";

type CheckResult = {
  pkgName: string;
  kind: CheckKind;
  success: boolean;
  output: string;
};

function findPackages(): Pkg[] {
  const repoRoot = join(__dirname, "..");
  const roots = ["apps", "packages", "scripts"];

  const pkgs: Pkg[] = [];

  for (const root of roots) {
    const rootPath = join(repoRoot, root);
    try {
      const stats = statSync(rootPath);
      if (!stats.isDirectory()) continue;
    } catch {
      continue;
    }

    // "scripts" is a single package; others have many subfolders
    const dirs =
      root === "scripts"
        ? [rootPath]
        : readdirSync(rootPath)
            .map((d) => join(rootPath, d))
            .filter((p) => {
              try {
                return statSync(p).isDirectory();
              } catch {
                return false;
              }
            });

    for (const dir of dirs) {
      const pkgJsonPath = join(dir, "package.json");
      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
          name?: string;
          scripts?: Record<string, string>;
        };
        const name = pkgJson.name ?? relative(repoRoot, dir);
        const hasLint = Boolean(pkgJson.scripts && pkgJson.scripts["lint"]);
        const hasTypecheck = Boolean(
          pkgJson.scripts && pkgJson.scripts["typecheck"]
        );
        if (hasLint || hasTypecheck) {
          pkgs.push({
            name,
            path: relative(repoRoot, dir),
            hasLint,
            hasTypecheck,
          });
        }
      } catch {
        // not a package or invalid json; skip
      }
    }
  }

  return pkgs;
}

function runScript(pkg: Pkg, kind: CheckKind): Promise<CheckResult> {
  const cwd = join(__dirname, "..", pkg.path);
  const child = spawn("bun", ["run", "--silent", kind], {
    cwd,
    shell: true,
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (d) => (stdout += String(d)));
  child.stderr?.on("data", (d) => (stderr += String(d)));

  return new Promise((resolve) => {
    child.on("close", (code) => {
      resolve({
        pkgName: pkg.name,
        kind,
        success: code === 0,
        output: (stdout || stderr).trim(),
      });
    });
    child.on("error", (err) => {
      resolve({
        pkgName: pkg.name,
        kind,
        success: false,
        output: err.message,
      });
    });
  });
}

async function main() {
  const pkgs = findPackages();

  const jobs: Promise<CheckResult>[] = [];
  for (const pkg of pkgs) {
    if (pkg.hasLint) jobs.push(runScript(pkg, "lint"));
    if (pkg.hasTypecheck) jobs.push(runScript(pkg, "typecheck"));
  }

  if (jobs.length === 0) {
    console.log("✅ Checks passed (nothing to run)");
    return;
  }

  const results = await Promise.all(jobs);
  const failures = results.filter((r) => !r.success);

  if (failures.length === 0) {
    console.log("✅ Checks passed (lint + typecheck)");
    return;
  }

  const lintFailures = failures.filter((f) => f.kind === "lint");
  const typeFailures = failures.filter((f) => f.kind === "typecheck");

  if (lintFailures.length > 0) {
    console.log("❌ Lint failures:\n");
    for (const f of lintFailures) {
      console.log(`- ${f.pkgName}`);
      if (f.output) {
        const indented = f.output
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n");
        console.log(indented + "\n");
      }
    }
  }

  if (typeFailures.length > 0) {
    console.log("❌ Typecheck failures:\n");
    for (const f of typeFailures) {
      console.log(`- ${f.pkgName}`);
      if (f.output) {
        const indented = f.output
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n");
        console.log(indented + "\n");
      }
    }
  }

  process.exit(1);
}

main().catch((err) => {
  console.error("check.ts failed:", err);
  process.exit(1);
});
