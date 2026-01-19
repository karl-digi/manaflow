import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const BASE_URL =
  process.env.CMUX_E2E_BASE_URL ??
  "http://localhost:5173/t/manaflow/ts7fqvmq7e4b6xacrs04sp1heh7zfw0h";
const SESSION = process.env.CMUX_E2E_SESSION ?? "cmux";

const DEFAULT_TIMEOUT_MS = 20_000;

async function runAgent(
  args: string[],
  session: string,
  timeout = DEFAULT_TIMEOUT_MS
): Promise<string> {
  const { stdout } = await execFileAsync(
    "agent-browser",
    ["--session", session, ...args],
    { timeout }
  );
  return stdout.trim();
}

function parseJsonOutput<T>(output: string): T {
  const trimmed = output.trim();
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace === -1) {
    throw new Error(`Expected JSON output, got: ${output}`);
  }
  return JSON.parse(trimmed.slice(firstBrace)) as T;
}

async function snapshotInteractive(session: string) {
  const attempts = 5;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const output = await runAgent(["snapshot", "-i", "--json"], session);
    const parsed = parseJsonOutput<{
      success: boolean;
      data?: {
        refs: Record<string, { name?: string; role?: string }>;
        snapshot: string;
      };
    }>(output);
    if (parsed.success && parsed.data?.refs) {
      const refs = parsed.data.refs;
      if (Object.keys(refs).length > 0) {
        return refs;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Snapshot failed: no interactive elements found");
}

async function snapshotCompact(session: string) {
  return await runAgent(["snapshot", "-c"], session);
}

function pickRef(
  refs: Record<string, { name?: string; role?: string }>,
  predicate: (value: { name?: string; role?: string }) => boolean
): string {
  for (const [ref, value] of Object.entries(refs)) {
    if (predicate(value)) return ref;
  }
  throw new Error("Failed to find matching ref");
}

async function waitForRef(
  session: string,
  predicate: (value: { name?: string; role?: string }) => boolean
) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const refs = await snapshotInteractive(session);
    const entry = Object.entries(refs).find(([, value]) =>
      predicate(value)
    );
    if (entry) {
      return entry[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for ref");
}

async function ensureComposerVisible(session: string) {
  const refs = await snapshotInteractive(session);
  const hasComposer = Object.values(refs).some(
    (entry) =>
      entry.role === "textbox" &&
      (entry.name?.toLowerCase().includes("start a new conversation") ?? false)
  );
  if (hasComposer) return;

  const passwordTabRef = Object.entries(refs).find(
    ([, entry]) =>
      entry.role === "tab" &&
      (entry.name?.toLowerCase().includes("email & password") ?? false)
  )?.[0];
  if (passwordTabRef) {
    await runAgent(["click", `@${passwordTabRef}`], session);
    await runAgent(["wait", "500"], session);
  }

  const refreshedRefs = await snapshotInteractive(session);
  const emailRef = Object.entries(refreshedRefs).find(
    ([, entry]) =>
      entry.role === "textbox" &&
      (entry.name?.toLowerCase().includes("email") ?? false)
  )?.[0];
  const passwordRef = Object.entries(refreshedRefs).find(
    ([, entry]) =>
      entry.role === "textbox" &&
      (entry.name?.toLowerCase().includes("password") ?? false)
  )?.[0];
  const signInRef = Object.entries(refreshedRefs).find(
    ([, entry]) =>
      entry.role === "button" &&
      (entry.name?.toLowerCase().includes("sign in") ?? false)
  )?.[0];

  if (emailRef) {
    await runAgent(
      ["fill", `@${emailRef}`, process.env.CMUX_E2E_EMAIL ?? "l@l.com"],
      session
    );
  }
  if (passwordRef) {
    await runAgent(
      ["fill", `@${passwordRef}`, process.env.CMUX_E2E_PASSWORD ?? "abc123"],
      session
    );
  }
  if (signInRef) {
    await runAgent(["click", `@${signInRef}`], session);
  }

  await runAgent(["wait", "1500"], session);
  await waitForRef(session, (entry) =>
    entry.role === "textbox" &&
    (entry.name?.toLowerCase().includes("start a new conversation") ?? false)
  );
}

function extractMainBlock(snapshot: string): string {
  const lines = snapshot.split("\n");
  const mainIndex = lines.findIndex((line) => line.trim() === "- main:");
  if (mainIndex === -1) return snapshot;
  const output: string[] = [];
  for (let i = mainIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^ {2}- /.test(line)) {
      break;
    }
    output.push(line);
  }
  return output.join("\n");
}

async function waitForMessage(session: string, message: string) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const snapshot = await snapshotCompact(session);
    const mainBlock = extractMainBlock(snapshot);
    if (mainBlock.includes(message)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for message: ${message}`);
}

async function assertMessageMissing(session: string, message: string) {
  const snapshot = await snapshotCompact(session);
  const mainBlock = extractMainBlock(snapshot);
  expect(mainBlock).not.toContain(message);
}

describe("optimistic conversations e2e", () => {
  it(
    "keeps optimistic message when leaving and returning",
    async () => {
      const message = `optimistic return ${Date.now()}`;
      await runAgent(["open", BASE_URL], SESSION);
      await runAgent(["wait", "1000"], SESSION);
      await ensureComposerVisible(SESSION);

      const initialRefs = await snapshotInteractive(SESSION);

      const inputRef = pickRef(initialRefs, (entry) =>
        entry.role === "textbox" &&
        (entry.name?.toLowerCase().includes("start a new conversation") ??
          false)
      );
      const createRef = pickRef(initialRefs, (entry) =>
        entry.role === "button" &&
        (entry.name?.toLowerCase().includes("create conversation") ?? false)
      );

      await runAgent(["fill", `@${inputRef}`, message], SESSION);
      await runAgent(["click", `@${createRef}`], SESSION);

      await waitForMessage(SESSION, message);

      const snapshotAfterCreateRefs = await snapshotInteractive(SESSION);

      const otherConversationRef = pickRef(snapshotAfterCreateRefs, (entry) => {
        if (entry.role !== "link") return false;
        if (!entry.name) return false;
        if (entry.name.toLowerCase().includes("conversation settings")) return false;
        if (entry.name.includes(message)) return false;
        return true;
      });

      await runAgent(["click", `@${otherConversationRef}`], SESSION);
      await runAgent(["wait", "800"], SESSION);

      const backSnapshotRefs = await snapshotInteractive(SESSION);

      const returnRef = pickRef(backSnapshotRefs, (entry) =>
        entry.role === "link" && (entry.name?.includes(message) ?? false)
      );

      await runAgent(["click", `@${returnRef}`], SESSION);
      await waitForMessage(SESSION, message);
    },
    30_000
  );

  it(
    "keeps latest conversation focused on quick-succession create",
    async () => {
      const first = `succession one ${Date.now()}`;
      const second = `succession two ${Date.now()}`;
      await runAgent(["open", BASE_URL], SESSION);
      await runAgent(["wait", "1000"], SESSION);
      await ensureComposerVisible(SESSION);

      const initialRefs = await snapshotInteractive(SESSION);

      const inputRef = pickRef(initialRefs, (entry) =>
        entry.role === "textbox" &&
        (entry.name?.toLowerCase().includes("start a new conversation") ??
          false)
      );
      const createRef = pickRef(initialRefs, (entry) =>
        entry.role === "button" &&
        (entry.name?.toLowerCase().includes("create conversation") ?? false)
      );

      await runAgent(["fill", `@${inputRef}`, first], SESSION);
      await runAgent(["click", `@${createRef}`], SESSION);
      await runAgent(["fill", `@${inputRef}`, second], SESSION);
      await runAgent(["click", `@${createRef}`], SESSION);

      await waitForMessage(SESSION, second);
      await assertMessageMissing(SESSION, first);
    },
    30_000
  );
});
