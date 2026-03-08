"use node";

/**
 * Server-side repo discovery for custom environment tasks.
 *
 * When an agent completes in a custom environment (projectFullName starts with "env:"),
 * this action scans the sandbox workspace for git repos and stores them in discoveredRepos.
 * This enables the git diff UI to work immediately without waiting for client-side discovery.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  createMorphCloudClient,
  execInstanceInstanceIdExecPost,
} from "@cmux/morphcloud-openapi-client";
import { Agent, fetch as undiciFetch } from "undici";

const pveHttpsAgent = new Agent({
  connect: { rejectUnauthorized: false },
});

function parseGitRemoteUrl(url: string): string | null {
  // Match GitHub HTTPS URLs: https://github.com/owner/repo.git or https://github.com/owner/repo
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/)?$/);
  if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`;
  // Match GitHub SSH URLs: git@github.com:owner/repo.git or git@github.com:owner/repo
  const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?(?:\/)?$/);
  if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`;
  return null;
}

export const discoverRepos = internalAction({
  args: {
    runId: v.id("taskRuns"),
    sandboxId: v.string(),
  },
  handler: async (ctx, args) => {
    const workspacePath = "/root/workspace";
    const cmd = `for d in $(find "${workspacePath}" -maxdepth 3 -name ".git" -type d 2>/dev/null); do git -C "$(dirname "$d")" remote get-url origin 2>/dev/null; done`;

    try {
      let stdout: string;

      if (args.sandboxId.startsWith("pvelxc-")) {
        stdout = await execPveLxc(args.sandboxId, cmd);
      } else {
        stdout = await execMorph(args.sandboxId, cmd);
      }

      const repos = parseRepos(stdout);
      if (repos.length > 0) {
        await ctx.runMutation(internal.taskRuns.updateDiscoveredReposInternal, {
          runId: args.runId,
          discoveredRepos: repos,
        });
        console.log("[discoverRepos] Found repos:", repos);
      } else {
        console.log("[discoverRepos] No repos found in workspace");
      }
    } catch (error) {
      console.error("[discoverRepos] Failed:", error);
      // Don't throw - discovery failure shouldn't block completion
    }
  },
});

async function execMorph(sandboxId: string, cmd: string): Promise<string> {
  const apiKey = process.env.MORPH_API_KEY;
  if (!apiKey) throw new Error("MORPH_API_KEY not set");

  const client = createMorphCloudClient({ auth: apiKey });
  const response = await execInstanceInstanceIdExecPost({
    client,
    path: { instance_id: sandboxId },
    body: { command: ["bash", "-c", cmd] },
  });
  return response.data?.stdout ?? "";
}

async function execPveLxc(sandboxId: string, cmd: string): Promise<string> {
  // PVE LXC containers use cmux-execd daemon on port 39375 for command execution
  // sandboxId format: pvelxc-XXXXXXXX where XXXXXXXX is the hostname suffix

  const publicDomain = process.env.PVE_PUBLIC_DOMAIN;
  if (!publicDomain) throw new Error("PVE_PUBLIC_DOMAIN not set");

  // Build public exec URL (same format as pve-lxc-client.ts buildPublicServiceUrl)
  // Format: https://port-{port}-{hostId}.{domain}/exec (Caddyfile routing pattern)
  const execUrl = `https://port-39375-${sandboxId}.${publicDomain}/exec`;

  const response = await undiciFetch(execUrl, {
    dispatcher: pveHttpsAgent,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: cmd }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`cmux-execd failed: ${response.status} - ${text}`);
  }

  // Parse streaming response - each line is a JSON object like:
  // {"type":"stdout","data":"..."}
  // {"type":"exit","code":0}
  const text = await response.text();
  let stdout = "";
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { type?: string; data?: string };
      if (parsed.type === "stdout" && parsed.data) {
        stdout += parsed.data + "\n";
      }
    } catch (error) {
      // Skip malformed lines - log for debugging but continue processing
      console.debug("[execPveLxc] Skipped malformed JSON line:", error);
    }
  }
  return stdout;
}

function parseRepos(stdout: string): string[] {
  const repos = new Set<string>();
  for (const line of stdout.split("\n")) {
    const repo = parseGitRemoteUrl(line.trim());
    if (repo) repos.add(repo);
  }
  return Array.from(repos);
}
