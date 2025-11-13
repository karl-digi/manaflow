#!/usr/bin/env bun

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptName = basename(scriptPath);
const scriptDir = resolve(scriptPath, "..");
const repoRoot = resolve(scriptDir, "..");

process.chdir(repoRoot);

const semverPattern = /^\d+\.\d+\.\d+$/;

type IncrementMode = "major" | "minor" | "patch";

type RunOptions = {
  allowNonZeroExit?: boolean;
  stdio?: "pipe" | "inherit";
};

type RunResult = {
  stdout: string;
  stderr: string;
  status: number;
};

function usage(): never {
  console.error(
    `Usage: ./scripts/${scriptName} [major|minor|patch|<semver>]\nExamples:\n  ./scripts/${scriptName}\n  ./scripts/${scriptName} minor\n  ./scripts/${scriptName} 1.2.3`
  );
  return process.exit(1);
}

function run(command: string, args: string[], options: RunOptions = {}): RunResult {
  const spawnOptions: SpawnSyncOptions = {
    cwd: process.cwd(),
    stdio: options.stdio ?? "pipe",
  };

  if ((options.stdio ?? "pipe") === "pipe") {
    spawnOptions.encoding = "utf8";
  }

  const result = spawnSync(command, args, spawnOptions);

  if (result.error) {
    throw new Error(`Failed to run ${command}: ${result.error.message}`);
  }

  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const status = typeof result.status === "number" ? result.status : 0;

  if (status !== 0 && !options.allowNonZeroExit) {
    const errorMessage = stderr.trim() || stdout.trim() || `${command} ${args.join(" ")}`;
    throw new Error(`Command failed (${command} ${args.join(" ")}): ${errorMessage}`);
  }

  return { stdout, stderr, status };
}

function ensureGitAvailable(): void {
  try {
    run("git", ["--version"]);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`git is required to run ${scriptName}: ${error.message}`);
    }
    throw new Error(`git is required to run ${scriptName}`);
  }
}

function isSemver(value: string): boolean {
  return semverPattern.test(value);
}

function parseSemverParts(value: string): [number, number, number] {
  if (!isSemver(value)) {
    throw new Error(`Version "${value}" is not a valid semver (x.y.z).`);
  }
  const [major, minor, patch] = value.split(".").map((part) => Number.parseInt(part, 10));
  return [major, minor, patch];
}

function compareSemver(left: string, right: string): number {
  const [leftMajor, leftMinor, leftPatch] = parseSemverParts(left);
  const [rightMajor, rightMinor, rightPatch] = parseSemverParts(right);

  if (leftMajor !== rightMajor) {
    return leftMajor > rightMajor ? 1 : -1;
  }
  if (leftMinor !== rightMinor) {
    return leftMinor > rightMinor ? 1 : -1;
  }
  if (leftPatch !== rightPatch) {
    return leftPatch > rightPatch ? 1 : -1;
  }
  return 0;
}

function incrementVersion(mode: IncrementMode, base: string): string {
  const [major, minor, patch] = parseSemverParts(base);

  if (mode === "major") {
    return `${major + 1}.0.0`;
  }
  if (mode === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

function loadCurrentVersion(): string {
  interface PackageJson {
    version?: string;
  }

  const packagePath = resolve("apps", "client", "package.json");
  const raw = readFileSync(packagePath, "utf8");
  const parsed: PackageJson = JSON.parse(raw);

  if (typeof parsed.version !== "string" || !parsed.version) {
    throw new Error("Unable to read current version from apps/client/package.json.");
  }

  if (!isSemver(parsed.version)) {
    throw new Error(`Current version "${parsed.version}" is not in the expected x.y.z format.`);
  }

  return parsed.version;
}

function determineHighestTagVersion(): string {
  const tagOutput = run("git", ["tag", "--list", "v[0-9]*"]).stdout.trim();
  if (!tagOutput) {
    return "";
  }

  const versions = tagOutput
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("v") ? tag.slice(1) : tag))
    .filter(isSemver);

  if (versions.length === 0) {
    return "";
  }

  versions.sort((a, b) => compareSemver(a, b));
  return versions[versions.length - 1] ?? "";
}

function updateVersionFile(version: string): void {
  const packagePath = resolve("apps", "client", "package.json");
  const raw = readFileSync(packagePath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  parsed.version = version;
  writeFileSync(packagePath, `${JSON.stringify(parsed, null, 2)}\n`);
  run("git", ["add", packagePath]);
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length > 1) {
    usage();
  }

  if (args[0] === "-h" || args[0] === "--help") {
    usage();
  }

  ensureGitAvailable();

  const statusOutput = run("git", ["status", "--porcelain", "--untracked-files=no"]).stdout.trim();
  if (statusOutput) {
    throw new Error("Working tree has tracked changes. Commit or stash them before releasing.");
  }

  const currentBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  if (currentBranch === "HEAD") {
    throw new Error("You are in a detached HEAD state. Check out a branch before releasing.");
  }

  const remotes = run("git", ["remote"]).stdout
    .split(/\r?\n/)
    .map((remote) => remote.trim())
    .filter(Boolean);

  if (remotes.length === 0) {
    throw new Error("No git remote configured. Add a remote before releasing.");
  }

  const firstRemote = remotes[0] ?? "";

  run("git", ["fetch", "--tags", firstRemote], { stdio: "inherit" });

  const packageVersion = loadCurrentVersion();
  const highestTagVersion = determineHighestTagVersion();

  let baseVersion = packageVersion;
  if (highestTagVersion && compareSemver(highestTagVersion, baseVersion) > 0) {
    baseVersion = highestTagVersion;
  }

  const bumpTarget = args[0] ?? "";

  let newVersion: string;

  if (!bumpTarget) {
    newVersion = incrementVersion("patch", baseVersion);
  } else if (bumpTarget === "major" || bumpTarget === "minor" || bumpTarget === "patch") {
    newVersion = incrementVersion(bumpTarget, baseVersion);
  } else {
    const manualTarget = bumpTarget.startsWith("v") ? bumpTarget.slice(1) : bumpTarget;
    newVersion = manualTarget;
  }

  if (!isSemver(newVersion)) {
    throw new Error(`Version "${newVersion}" is not a valid semver (x.y.z).`);
  }

  if (compareSemver(newVersion, baseVersion) <= 0) {
    throw new Error(`New version ${newVersion} must be greater than existing version ${baseVersion}.`);
  }

  const localTagCheck = run(
    "git",
    ["rev-parse", "-q", "--verify", `refs/tags/v${newVersion}`],
    { allowNonZeroExit: true }
  );
  if (localTagCheck.status === 0) {
    throw new Error(`Tag v${newVersion} already exists locally.`);
  }

  const remoteTagCheck = run(
    "git",
    ["ls-remote", "--tags", firstRemote, `refs/tags/v${newVersion}`],
    { allowNonZeroExit: true }
  );
  if (remoteTagCheck.stdout.trim()) {
    throw new Error(`Tag v${newVersion} already exists on ${firstRemote}.`);
  }

  updateVersionFile(newVersion);

  console.log(`Releasing version ${newVersion} (base was ${baseVersion})`);

  run("git", ["commit", "-m", `chore: release v${newVersion}`], { stdio: "inherit" });

  const upstreamResult = run(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    { allowNonZeroExit: true }
  );

  if (upstreamResult.status === 0) {
    run("git", ["push"], { stdio: "inherit" });
    const upstreamRef = upstreamResult.stdout.trim();
    if (upstreamRef) {
      console.log(`Pushed ${currentBranch} to ${upstreamRef}`);
    }
  } else {
    run("git", ["push", "-u", firstRemote, currentBranch], { stdio: "inherit" });
    console.log(`Pushed ${currentBranch} to ${firstRemote}/${currentBranch}`);
  }

  console.log(`Done. New version: ${newVersion}`);
}

try {
  main();
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exit(1);
}
