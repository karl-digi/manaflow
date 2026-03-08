import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getClaudeEnvironment } from "./environment";
import { getCrossToolSymlinkCommands } from "../../agent-memory-protocol";

const BASE_CONTEXT = {
  taskRunId: "run_test",
  prompt: "test prompt",
  taskRunJwt: "jwt_test",
  callbackUrl: "http://localhost:9779",
};

async function decodeClaudeConfig(args?: {
  agentName?: string;
  useHostConfig?: boolean;
  mcpServerConfigs?: Array<
    | {
        name: string;
        type: "stdio";
        command: string;
        args: string[];
        envVars?: Record<string, string>;
      }
    | {
        name: string;
        type: "http" | "sse";
        url: string;
        headers?: Record<string, string>;
        envVars?: Record<string, string>;
      }
  >;
}) {
  const result = await getClaudeEnvironment({
    ...BASE_CONTEXT,
    ...args,
  });
  const configFile = result.files.find(
    (file) => file.destinationPath === "$HOME/.claude.json"
  );
  expect(configFile).toBeDefined();
  return JSON.parse(Buffer.from(configFile!.contentBase64, "base64").toString("utf-8")) as {
    mcpServers: Record<
      string,
      {
        type?: "stdio" | "http" | "sse";
        command?: string;
        args?: string[];
        url?: string;
        headers?: Record<string, string>;
        env?: Record<string, string>;
      }
    >;
  };
}

describe("getClaudeEnvironment", () => {
  it("includes --agent in devsh-memory MCP args when agentName is provided", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "cmux-claude-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      await mkdir(join(homeDir, ".claude"), { recursive: true });

      const config = await decodeClaudeConfig({
        agentName: "codex/gpt-5.1-codex-mini",
      });
      expect(config.mcpServers["devsh-memory"]?.args).toEqual([
        "-y",
        "devsh-memory-mcp@latest",
        "--agent",
        "codex/gpt-5.1-codex-mini",
      ]);
    } finally {
      process.env.HOME = previousHome;
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("does not read host config in server mode by default", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "cmux-claude-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      await mkdir(join(homeDir, ".claude"), { recursive: true });
      await writeFile(
        join(homeDir, ".claude.json"),
        JSON.stringify({
          mcpServers: {
            stale: {
              command: "echo",
              args: ["host-only"],
            },
            "devsh-memory": {
              command: "npx",
              args: ["-y", "devsh-memory-mcp@latest", "--agent", "stale-agent"],
            },
          },
        }),
        "utf-8"
      );

      const config = await decodeClaudeConfig();
      expect(config.mcpServers.stale).toBeUndefined();
      expect(config.mcpServers["devsh-memory"]?.args).toEqual([
        "-y",
        "devsh-memory-mcp@latest",
      ]);
    } finally {
      process.env.HOME = previousHome;
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("reads host config in desktop mode when useHostConfig is true", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "cmux-claude-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      await mkdir(join(homeDir, ".claude"), { recursive: true });
      await writeFile(
        join(homeDir, ".claude.json"),
        JSON.stringify({
          theme: "dark",
          mcpServers: {
            localtools: {
              command: "node",
              args: ["server.js"],
            },
          },
        }),
        "utf-8"
      );

      const config = await decodeClaudeConfig({ useHostConfig: true });
      expect(config.mcpServers.localtools).toEqual({
        command: "node",
        args: ["server.js"],
      });
      expect(config.mcpServers["devsh-memory"]).toBeDefined();
    } finally {
      process.env.HOME = previousHome;
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("includes cross-tool symlink commands in startupCommands", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "cmux-claude-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      await mkdir(join(homeDir, ".claude"), { recursive: true });

      const result = await getClaudeEnvironment(BASE_CONTEXT);

      // Should include all symlink commands from getCrossToolSymlinkCommands
      const symlinkCommands = getCrossToolSymlinkCommands();
      for (const cmd of symlinkCommands) {
        expect(result.startupCommands).toContain(cmd);
      }
    } finally {
      process.env.HOME = previousHome;
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("includes CLAUDE.md at user-level path", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "cmux-claude-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      await mkdir(join(homeDir, ".claude"), { recursive: true });

      const result = await getClaudeEnvironment(BASE_CONTEXT);

      // Should include CLAUDE.md file at ~/.claude/CLAUDE.md
      const claudeMdFile = result.files.find(
        (file) => file.destinationPath === "$HOME/.claude/CLAUDE.md"
      );
      expect(claudeMdFile).toBeDefined();

      // Decode and verify content includes memory protocol
      const content = Buffer.from(claudeMdFile!.contentBase64, "base64").toString("utf-8");
      expect(content).toContain("Agent Memory Protocol");
      expect(content).toContain("/root/lifecycle/memory");
    } finally {
      process.env.HOME = previousHome;
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("merges user MCP servers into .claude.json", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "cmux-claude-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = homeDir;

    try {
      await mkdir(join(homeDir, ".claude"), { recursive: true });

      const config = await decodeClaudeConfig({
        mcpServerConfigs: [
          {
            name: "context7",
            type: "stdio",
            command: "npx",
            args: ["-y", "@upstash/context7-mcp@latest"],
            envVars: {
              CONTEXT7_API_KEY: "token",
            },
          },
          {
            name: "remote-api",
            type: "http",
            url: "https://example.com/mcp",
            headers: {
              Authorization: "Bearer secret",
            },
          },
        ],
      });

      expect(config.mcpServers.context7).toEqual({
        command: "npx",
        args: ["-y", "@upstash/context7-mcp@latest"],
        env: {
          CONTEXT7_API_KEY: "token",
        },
      });
      expect(config.mcpServers["remote-api"]).toEqual({
        type: "http",
        url: "https://example.com/mcp",
        headers: {
          Authorization: "Bearer secret",
        },
      });
      expect(config.mcpServers["devsh-memory"]).toBeDefined();
    } finally {
      process.env.HOME = previousHome;
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
