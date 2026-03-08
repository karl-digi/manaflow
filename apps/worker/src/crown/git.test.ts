import { beforeEach, describe, expect, it, vi } from "vitest";

const { execAsyncMock, execFileAsyncMock, logMock } = vi.hoisted(() => ({
  execAsyncMock: vi.fn(),
  execFileAsyncMock: vi.fn(),
  logMock: vi.fn(),
}));

vi.mock("./utils", () => ({
  WORKSPACE_ROOT: "/tmp/cmux-worker-git-tests",
  execAsync: execAsyncMock,
  execFileAsync: execFileAsyncMock,
}));

vi.mock("../logger", () => ({
  log: logMock,
}));

import { autoCommitAndPush, isAuthError, pushWithEphemeralToken } from "./git";

function makeExecError(message: string, stderr = "", code = 1): Error & {
  stdout: string;
  stderr: string;
  code: number;
} {
  const error = new Error(message) as Error & {
    stdout: string;
    stderr: string;
    code: number;
  };
  error.stdout = "";
  error.stderr = stderr;
  error.code = code;
  return error;
}

describe("crown git auth retry", () => {
  beforeEach(() => {
    execAsyncMock.mockReset();
    execFileAsyncMock.mockReset();
    logMock.mockReset();

    execAsyncMock.mockResolvedValue({ stdout: "", stderr: "" });
    execFileAsyncMock.mockResolvedValue({ stdout: "", stderr: "" });
  });

  it("detects auth failures from git output", () => {
    expect(isAuthError("fatal: Authentication failed")).toBe(true);
    expect(isAuthError("HTTP 403 from server")).toBe(true);
    expect(isAuthError("Everything up-to-date")).toBe(false);
  });

  it("pushWithEphemeralToken redacts token in returned errors", async () => {
    execFileAsyncMock.mockRejectedValueOnce(
      makeExecError(
        "Command failed",
        "fatal: could not push to https://x-access-token:secret-token@github.com/owner/repo.git",
        128,
      ),
    );

    const result = await pushWithEphemeralToken(
      "feature/test",
      "/tmp/repo",
      "secret-token",
      "owner/repo",
    );

    expect(result.success).toBe(false);
    expect(result.error).not.toContain("secret-token");
    expect(result.error).toContain("***");
  });

  it("retries exactly once with fresh token on auth push failure", async () => {
    execFileAsyncMock.mockImplementation(async (_command: string, args: string[]) => {
      if (args[0] === "push" && args[2] === "origin") {
        throw makeExecError(
          "Command failed",
          "fatal: Authentication failed for 'https://github.com/owner/repo.git'",
          128,
        );
      }
      return { stdout: "", stderr: "" };
    });

    const tokenSupplier = vi
      .fn<() => Promise<{ token: string; repoFullName: string } | null>>()
      .mockResolvedValue({
        token: "fresh-token",
        repoFullName: "owner/repo",
      });

    const result = await autoCommitAndPush({
      branchName: "feature/test",
      commitMessage: "test commit",
      remoteUrl: "https://github.com/owner/repo.git",
      tokenSupplier,
    });

    expect(result.success).toBe(true);
    expect(result.pushedRepos).toHaveLength(1);
    expect(tokenSupplier).toHaveBeenCalledTimes(1);

    const pushCalls = execFileAsyncMock.mock.calls.filter(([, args]) => {
      return Array.isArray(args) && args[0] === "push";
    });

    expect(pushCalls).toHaveLength(2);
    // Verify retry push uses tokenized URL (arg index 1) and refspec (arg index 2)
    const retryArgs = pushCalls[1]?.[1] as string[];
    expect(retryArgs[1]).toContain("x-access-token:fresh-token@github.com/owner/repo.git");
    expect(retryArgs[2]).toBe("HEAD:refs/heads/feature/test");
  });

  it("does not retry when no token supplier is provided", async () => {
    execFileAsyncMock.mockImplementation(async (_command: string, args: string[]) => {
      if (args[0] === "push" && args[2] === "origin") {
        throw makeExecError(
          "Command failed",
          "fatal: Authentication failed for 'https://github.com/owner/repo.git'",
          128,
        );
      }
      return { stdout: "", stderr: "" };
    });

    const result = await autoCommitAndPush({
      branchName: "feature/test",
      commitMessage: "test commit",
      remoteUrl: "https://github.com/owner/repo.git",
    });

    expect(result.success).toBe(false);
    expect(result.pushedRepos).toHaveLength(0);

    const pushCalls = execFileAsyncMock.mock.calls.filter(([, args]) => {
      return Array.isArray(args) && args[0] === "push";
    });

    expect(pushCalls).toHaveLength(1);
    expect((pushCalls[0]?.[1] as string[])[2]).toBe("origin");
  });
});
