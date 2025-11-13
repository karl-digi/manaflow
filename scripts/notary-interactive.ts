#!/usr/bin/env bun

import { Command } from "commander";
import dotenv from "dotenv";
import { spawn } from "node:child_process";
import { existsSync, promises as fsp } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prompts from "prompts";

type NotaryHistoryItem = {
  id: string;
  status: string;
  createdDate: string;
  name?: string;
};

type CodesignEnv = {
  APPLE_API_KEY: string;
  APPLE_API_KEY_ID: string;
  APPLE_API_ISSUER: string;
};

function getRootDir(): string {
  // Try CWD first (repo root when running `bun run scripts/...`), fallback to path relative to this file
  const cwd = process.cwd();
  if (existsSync(join(cwd, ".env.codesign"))) return cwd;
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, "..");
  return root;
}

function loadCodesignEnv(): CodesignEnv {
  const ROOT_DIR = getRootDir();
  dotenv.config({ path: join(ROOT_DIR, ".env.codesign") });
  const {
    APPLE_API_KEY = "",
    APPLE_API_KEY_ID = "",
    APPLE_API_ISSUER = "",
  } = process.env;
  if (!APPLE_API_KEY || !APPLE_API_KEY_ID || !APPLE_API_ISSUER) {
    throw new Error(
      "Missing codesign env. Ensure .env.codesign defines APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER"
    );
  }
  return { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER };
}

async function withTempApiKey<T>(
  env: CodesignEnv,
  fn: (p: string) => Promise<T>
): Promise<T> {
  const file = join(
    os.tmpdir(),
    `AuthKey_${env.APPLE_API_KEY_ID}_${Date.now()}.p8`
  );
  await fsp.writeFile(file, env.APPLE_API_KEY, { mode: 0o600 });
  try {
    return await fn(file);
  } finally {
    try {
      await fsp.unlink(file);
    } catch {
      // pass
    }
  }
}

function spawnCapture(
  cmd: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) =>
      resolvePromise({ code: code ?? 0, stdout, stderr })
    );
  });
}

function spawnStream(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("close", (code) => resolvePromise(code ?? 0));
  });
}

async function notaryHistory(
  env: CodesignEnv,
  limit = 10
): Promise<NotaryHistoryItem[]> {
  return withTempApiKey(env, async (apiKeyPath) => {
    const args = [
      "notarytool",
      "history",
      "--key",
      apiKeyPath,
      "--key-id",
      env.APPLE_API_KEY_ID,
      "--issuer",
      env.APPLE_API_ISSUER,
      "--output-format",
      "json",
    ];
    const { code, stdout, stderr } = await spawnCapture("xcrun", args);
    if (code !== 0) {
      throw new Error(
        `notarytool history failed (code ${code}): ${stderr || stdout}`
      );
    }
    try {
      const parsed = JSON.parse(stdout) as { history?: NotaryHistoryItem[] };
      const items = (parsed.history ?? []).slice(0, limit);
      return items;
    } catch (e) {
      throw new Error(`Failed to parse history JSON: ${(e as Error).message}`);
    }
  });
}

async function notaryWait(
  env: CodesignEnv,
  submissionId: string
): Promise<number> {
  return withTempApiKey(env, async (apiKeyPath) => {
    const args = [
      "notarytool",
      "wait",
      submissionId,
      "--key",
      apiKeyPath,
      "--key-id",
      env.APPLE_API_KEY_ID,
      "--issuer",
      env.APPLE_API_ISSUER,
      "--output-format",
      "json",
    ];
    return await spawnStream("xcrun", args);
  });
}

async function notaryInfo(
  env: CodesignEnv,
  submissionId: string
): Promise<unknown> {
  return withTempApiKey(env, async (apiKeyPath) => {
    const args = [
      "notarytool",
      "info",
      submissionId,
      "--key",
      apiKeyPath,
      "--key-id",
      env.APPLE_API_KEY_ID,
      "--issuer",
      env.APPLE_API_ISSUER,
      "--output-format",
      "json",
    ];
    const { code, stdout, stderr } = await spawnCapture("xcrun", args);
    if (code !== 0) {
      throw new Error(
        `notarytool info failed (code ${code}): ${stderr || stdout}`
      );
    }
    return JSON.parse(stdout) as unknown;
  });
}

async function notaryLog(
  env: CodesignEnv,
  submissionId: string,
  stream = true
): Promise<string> {
  return withTempApiKey(env, async (apiKeyPath) => {
    // Write log to a temp file (newer notarytool requires output-path)
    const outPath = join(
      os.tmpdir(),
      `notary-log-${submissionId}-${Date.now()}.log`
    );
    const baseArgs = [
      "notarytool",
      "log",
      submissionId,
      "--key",
      apiKeyPath,
      "--key-id",
      env.APPLE_API_KEY_ID,
      "--issuer",
      env.APPLE_API_ISSUER,
      // Do not set --output-format to maximize compatibility; default is human-readable
      outPath,
    ];
    const { code, stdout, stderr } = await spawnCapture("xcrun", baseArgs);
    if (code !== 0)
      throw new Error(
        `notarytool log failed (code ${code}): ${stderr || stdout}`
      );
    const text = await fsp.readFile(outPath, "utf8");
    if (stream) {
      process.stdout.write(text);
      return "";
    }
    return text;
  });
}

async function promptInput(message: string): Promise<string> {
  const res = await prompts({ type: "text", name: "v", message });
  return (res?.v as string | undefined)?.trim() ?? "";
}

async function interactive(): Promise<void> {
  const env = loadCodesignEnv();
  while (true) {
    const items = await notaryHistory(env, 10);
    if (items.length === 0) {
      console.log("No recent submissions found.");
      return;
    }
    const choices = [
      ...items.map((it) => ({
        title: `${it.id}  [${it.status}]  ${new Date(it.createdDate).toLocaleString()}  ${it.name ?? ""}`,
        value: it.id,
      })),
      { title: "🔁 Refresh list", value: "__refresh" },
      { title: "📝 Enter submission ID…", value: "__enter" },
      { title: "Quit", value: "__quit" },
    ];
    const sel = (await prompts({
      type: "select",
      name: "v",
      message: "Select a submission",
      choices,
      initial: 0,
    })) as { v?: string };
    const v = sel?.v;
    if (!v || v === "__quit") return;
    if (v === "__refresh") continue;
    let selectedId = v;
    if (v === "__enter") {
      const id = await promptInput("Enter submission ID:");
      if (!id) continue;
      selectedId = id;
    }
    await interactiveSubmission(env, selectedId);
  }
}

async function interactiveSubmission(
  env: CodesignEnv,
  id: string
): Promise<void> {
  while (true) {
    let status = "Unknown";
    try {
      const info = await notaryInfo(env, id);
      status = extractStatus(info);
    } catch (_e) {
      // ignore, will show in actions if needed
    }
    const message = `Submission ${id}\nCurrent status: ${status}`;
    const sel = (await prompts({
      type: "select",
      name: "v",
      message,
      choices: [
        { title: "Wait for completion (stream)", value: "wait" },
        { title: "Show info (JSON)", value: "info" },
        { title: "Show log (print)", value: "log" },
        { title: "Open log in pager (less)", value: "pager" },
        { title: "Auto-refresh status (until done)", value: "watch" },
        { title: "Change submission id", value: "back" },
        { title: "Quit", value: "quit" },
      ],
      initial: 0,
    })) as { v?: string };
    const v = sel?.v;
    if (!v || v === "quit") return;
    if (v === "back") return; // go back to list
    if (v === "wait") {
      console.log(`==> Waiting for submission: ${id}`);
      const code = await notaryWait(env, id);
      console.log(`==> notarytool wait exited with code ${code}`);
      try {
        const info = await notaryInfo(env, id);
        const s = extractStatus(info);
        console.log(`Final status: ${s}`);
        if (s.toLowerCase() !== "accepted") {
          const confirm = (await prompts({
            type: "confirm",
            name: "y",
            message: "Show failure log now?",
            initial: true,
          })) as { y?: boolean };
          if (confirm?.y) await notaryLog(env, id, true);
        }
      } catch (e) {
        console.log(String(e));
      }
    } else if (v === "info") {
      try {
        const info = await notaryInfo(env, id);
        console.log(JSON.stringify(info, null, 2));
      } catch (e) {
        console.log(String(e));
      }
    } else if (v === "log") {
      try {
        await notaryLog(env, id, true);
      } catch (e) {
        console.log(String(e));
      }
    } else if (v === "pager") {
      try {
        const text = await notaryLog(env, id, false);
        const file = join(os.tmpdir(), `notary-log-${id}.txt`);
        await fsp.writeFile(file, text);
        const pager = process.env.PAGER || "less";
        await spawnStream(pager, [file]);
      } catch (e) {
        console.log(String(e));
      }
    } else if (v === "watch") {
      try {
        console.log("Auto-refreshing status every 5s until completion...");
        let last = "";
        while (true) {
          const info = await notaryInfo(env, id);
          const s = extractStatus(info);
          const line = `${new Date().toLocaleTimeString()}  ${s}`;
          if (s !== last) console.log(line);
          last = s;
          const done = s.toLowerCase() !== "in progress";
          if (done) {
            console.log("Reached final state.");
            break;
          }
          await sleep(5000);
        }
      } catch (e) {
        console.log(String(e));
      }
    }
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("notary-interactive")
    .description(
      "Interactive helper around xcrun notarytool (history, wait, logs)"
    )
    .version("0.1.0");

  program
    .command("history")
    .description("Show recent submissions")
    .option("-n, --limit <number>", "Number of items", (v) => Number(v), 10)
    .action(async (opts: { limit: number }) => {
      const env = loadCodesignEnv();
      const items = await notaryHistory(env, opts.limit);
      if (items.length === 0) {
        console.log("No recent submissions found.");
        return;
      }
      for (const it of items) {
        const when = new Date(it.createdDate).toLocaleString();
        console.log(`${it.id}  [${it.status}]  ${when}  ${it.name ?? ""}`);
      }
    });

  program
    .command("wait")
    .argument("[submissionId]", "Submission ID to wait for")
    .description("Wait for a submission to complete")
    .action(async (submissionId?: string) => {
      const env = loadCodesignEnv();
      let id = submissionId;
      if (!id) {
        const items = await notaryHistory(env, 10);
        const choices = items.map((it) => ({
          title: `${it.id}  [${it.status}]  ${new Date(it.createdDate).toLocaleString()}  ${it.name ?? ""}`,
          value: it.id,
        }));
        const sel = (await prompts({
          type: "select",
          name: "v",
          message: "Select submission to wait for",
          choices,
          initial: 0,
        })) as { v?: string };
        id = sel?.v;
      }
      if (!id) throw new Error("No submission id provided");
      console.log(`==> Waiting for submission: ${id}`);
      const code = await notaryWait(env, id);
      console.log(`==> notarytool wait exited with code ${code}`);
      const info = await notaryInfo(env, id);
      const status = extractStatus(info);
      console.log(`Final status: ${status}`);
      if (String(status).toLowerCase() !== "accepted") {
        const confirm = (await prompts({
          type: "confirm",
          name: "y",
          message: "Show failure log now?",
          initial: true,
        })) as { y?: boolean };
        if (confirm?.y) await notaryLog(env, id, true);
      }
    });

  program
    .command("logs")
    .argument("[submissionId]", "Submission ID to view logs for")
    .option("-p, --pager", "Open in pager (less)")
    .description("Show notarization log for a submission")
    .action(
      async (submissionId: string | undefined, opts: { pager?: boolean }) => {
        const env = loadCodesignEnv();
        let id = submissionId;
        if (!id) {
          const ans = await promptInput("Paste submission id:");
          id = ans;
        }
        if (!id) throw new Error("No submission id provided");
        if (opts.pager) {
          const text = await notaryLog(env, id, false);
          const file = join(os.tmpdir(), `notary-log-${id}.txt`);
          await fsp.writeFile(file, text);
          const pager = process.env.PAGER || "less";
          await spawnStream(pager, [file]);
        } else {
          await notaryLog(env, id, true);
        }
      }
    );

  program
    .command("interactive")
    .description("Interactive mode: browse history and inspect submissions")
    .action(async () => {
      await interactive();
    });

  program.action(async () => {
    // Default to interactive when no subcommand
    await interactive();
  });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(String(err?.stack || err));
  process.exit(1);
});

function extractStatus(info: unknown): string {
  if (typeof info === "object" && info !== null) {
    const obj = info as Record<string, unknown>;
    if (typeof obj.status === "string") return obj.status;
    const cap = obj["Status"];
    if (typeof cap === "string") return cap;
  }
  return "Unknown";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
