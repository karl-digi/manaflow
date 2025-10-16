#!/usr/bin/env bun

import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";

interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

async function runCommand(
  command: string,
  args: readonly string[],
  options: CommandOptions = {}
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      cwd: options.cwd,
      env: options.env,
      shell: false,
    });

    child.once("error", (error) => reject(error));
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Command "${command} ${args.join(" ")}" exited with ${
            code === null ? `signal ${String(signal)}` : `code ${code}`
          }`
        )
      );
    });
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const workspaceDir = requireEnv("WORKSPACE_DIR");
  const repoUrl = requireEnv("GIT_REPO_URL");
  const branchName = requireEnv("GIT_BRANCH");

  console.log(`[inject] Clearing workspace ${workspaceDir}...`);
  await rm(workspaceDir, { recursive: true, force: true });

  const cloneAndCheckout = (async () => {
    console.log(`[inject] Cloning ${repoUrl} into ${workspaceDir}...`);
    await runCommand("git", ["clone", repoUrl, workspaceDir]);
    console.log(`[inject] Checking out branch ${branchName}...`);
    await runCommand("git", ["checkout", branchName], { cwd: workspaceDir });
  })();

  const installCodex = (async () => {
    console.log("[inject] Installing @openai/codex globally...");
    await runCommand("bun", ["add", "-g", "@openai/codex@latest"]);
  })();

  await Promise.all([cloneAndCheckout, installCodex]);

  console.log("[inject] Repository prepared.");
}

await main();
