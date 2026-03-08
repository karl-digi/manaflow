import { describe, expect, it } from "vitest";
import {
  buildClaudeMcpServers,
  buildCodexMcpToml,
  buildGeminiMcpServers,
  buildOpencodeMcpConfig,
} from "./mcp-injection";
import type { McpServerConfig } from "./mcp-server-config";

describe("mcp-injection", () => {
  it("returns empty outputs for empty config arrays except managed OpenCode memory", () => {
    expect(buildClaudeMcpServers([])).toEqual({});
    expect(buildGeminiMcpServers([])).toEqual({});
    expect(buildCodexMcpToml([])).toBe("");
    expect(buildOpencodeMcpConfig([])).toEqual({
      "devsh-memory": {
        type: "local",
        command: ["npx", "-y", "devsh-memory-mcp@latest"],
        enabled: true,
      },
    });
  });

  it("builds Claude and Gemini MCP server maps for stdio and remote servers", () => {
    const configs: McpServerConfig[] = [
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
        envVars: {
          MCP_SESSION: "session-token",
        },
      },
    ];

    const expected = {
      context7: {
        command: "npx",
        args: ["-y", "@upstash/context7-mcp@latest"],
        env: {
          CONTEXT7_API_KEY: "token",
        },
      },
      "remote-api": {
        type: "http",
        url: "https://example.com/mcp",
        headers: {
          Authorization: "Bearer secret",
        },
        env: {
          MCP_SESSION: "session-token",
        },
      },
    };

    expect(buildClaudeMcpServers(configs)).toEqual(expected);
    expect(buildGeminiMcpServers(configs)).toEqual(expected);
  });

  it("builds Codex TOML blocks for stdio and remote MCP servers", () => {
    const configs: McpServerConfig[] = [
      {
        name: "context7",
        type: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp@latest"],
      },
      {
        name: "my-server",
        type: "sse",
        url: "https://mcp.example.com/sse",
        headers: {
          Authorization: "Bearer secret",
        },
        envVars: {
          API_TOKEN: "secret",
        },
      },
    ];

    const toml = buildCodexMcpToml(configs);

    expect(toml).toContain("[mcp_servers.context7]");
    expect(toml).toContain('type = "stdio"');
    expect(toml).toContain('command = "npx"');
    expect(toml).toContain('args = ["-y","@upstash/context7-mcp@latest"]');
    expect(toml).toContain('[mcp_servers."my-server"]');
    expect(toml).toContain('type = "sse"');
    expect(toml).toContain('url = "https://mcp.example.com/sse"');
    expect(toml).toContain('[mcp_servers."my-server".headers]');
    expect(toml).toContain('Authorization = "Bearer secret"');
    expect(toml).toContain('[mcp_servers."my-server".env]');
    expect(toml).toContain('API_TOKEN = "secret"');
  });

  it("builds Opencode MCP config with local and remote servers", () => {
    const configs: McpServerConfig[] = [
      {
        name: "github",
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github@latest"],
        envVars: {
          GITHUB_TOKEN: "ghp_test",
        },
      },
      {
        name: "remote-filesystem",
        type: "http",
        url: "https://example.com/mcp",
        headers: {
          Authorization: "Bearer remote-token",
        },
        envVars: {
          MCP_API_KEY: "mcp-secret",
        },
      },
    ];

    expect(buildOpencodeMcpConfig(configs, "opencode/sonnet-4")).toEqual({
      github: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-github@latest"],
        enabled: true,
        environment: {
          GITHUB_TOKEN: "ghp_test",
        },
      },
      "remote-filesystem": {
        type: "remote",
        url: "https://example.com/mcp",
        headers: {
          Authorization: "Bearer remote-token",
        },
        enabled: true,
        environment: {
          MCP_API_KEY: "mcp-secret",
        },
      },
      "devsh-memory": {
        type: "local",
        command: ["npx", "-y", "devsh-memory-mcp@latest", "--agent", "opencode/sonnet-4"],
        enabled: true,
      },
    });
  });
});
