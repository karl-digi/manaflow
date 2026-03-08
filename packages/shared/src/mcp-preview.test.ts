import { describe, expect, it } from "vitest";
import {
  buildMergedClaudeConfig,
  buildMergedClaudePreview,
  buildMergedCodexConfigToml,
  buildMergedCodexPreview,
  buildMergedOpencodePreview,
  deriveEffectiveMcpPreviewConfigs,
  deriveEffectiveMcpPreviewConfigsByAgent,
  formatPreviewNameList,
  getMcpPreviewScopeDescription,
  getWebPreviewBuiltinMcpServers,
  getWebPreviewInjectedServerNames,
  getWebPreviewInjectedServersDescription,
  getWorkspacePreviewProjectNames,
  previewOpencodeMcpServers,
} from "./mcp-preview";
import { normalizeMcpServerConfig, type McpServerConfig, type McpServerConfigInput } from "./mcp-server-config";

const STDIO_CONFIG: McpServerConfig = {
  name: "context7",
  type: "stdio",
  command: "npx",
  args: ["-y", "@upstash/context7-mcp@latest"],
  envVars: { CONTEXT7_API_KEY: "token" },
};

const REMOTE_CONFIG: McpServerConfig = {
  name: "remote-api",
  type: "http",
  url: "https://example.com/mcp",
  headers: { Authorization: "Bearer secret" },
  envVars: { MCP_SESSION: "session-token" },
};

type PreviewSourceConfig = {
  name: string;
  scope: "global" | "workspace";
  projectFullName?: string;
  enabledClaude: boolean;
  enabledCodex: boolean;
  enabledOpencode: boolean;
  preview: McpServerConfigInput;
};

const PREVIEW_SOURCE_CONFIGS: PreviewSourceConfig[] = [
  {
    name: "context7",
    scope: "global",
    enabledClaude: true,
    enabledCodex: true,
    enabledOpencode: true,
    preview: {
      name: "context7",
      type: "stdio",
      command: "npx",
      args: ["-y", "context7"],
    },
  },
  {
    name: "docs",
    scope: "global",
    enabledClaude: false,
    enabledCodex: true,
    enabledOpencode: true,
    preview: {
      name: "docs",
      type: "http",
      url: "https://example.com/mcp",
    },
  },
  {
    name: "context7",
    scope: "workspace",
    projectFullName: "owner/repo-a",
    enabledClaude: true,
    enabledCodex: false,
    enabledOpencode: true,
    preview: {
      name: "context7",
      type: "stdio",
      command: "bunx",
      args: ["workspace-context7"],
    },
  },
  {
    name: "search",
    scope: "workspace",
    projectFullName: "owner/repo-a",
    enabledClaude: true,
    enabledCodex: true,
    enabledOpencode: true,
    preview: {
      name: "search",
      type: "stdio",
      command: "npx",
      args: ["search"],
    },
  },
  {
    name: "zeta",
    scope: "workspace",
    projectFullName: "owner/repo-b",
    enabledClaude: true,
    enabledCodex: true,
    enabledOpencode: true,
    preview: {
      name: "zeta",
      type: "stdio",
      command: "npx",
      args: ["zeta"],
    },
  },
];

function normalizePreviewSourceConfig(config: PreviewSourceConfig): McpServerConfig {
  return normalizeMcpServerConfig(config.preview);
}

describe("buildMergedClaudeConfig", () => {
  it("preserves unrelated host config and merges managed MCP servers", () => {
    const result = buildMergedClaudeConfig({
      hostConfigText: JSON.stringify({
        theme: "dark",
        mcpServers: {
          localtools: {
            command: "node",
            args: ["server.js"],
          },
          context7: {
            command: "old",
            args: ["stale"],
          },
          "devsh-memory": {
            command: "echo",
            args: ["hijacked"],
          },
        },
      }),
      mcpServerConfigs: [STDIO_CONFIG, REMOTE_CONFIG],
      agentName: "claude/opus-4.6",
    });

    expect(result.theme).toBe("dark");
    expect(result.mcpServers).toEqual({
      context7: {
        command: "old",
        args: ["stale"],
      },
      "remote-api": {
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer secret" },
        env: { MCP_SESSION: "session-token" },
      },
      localtools: {
        command: "node",
        args: ["server.js"],
      },
      "devsh-memory": {
        command: "npx",
        args: ["-y", "devsh-memory-mcp@latest", "--agent", "claude/opus-4.6"],
      },
    });
  });

  it("falls back cleanly when host config is missing or invalid", () => {
    expect(
      JSON.parse(
        buildMergedClaudePreview({
          hostConfigText: "{not json",
          mcpServerConfigs: [STDIO_CONFIG],
        }),
      ),
    ).toEqual({
      mcpServers: {
        context7: {
          command: "npx",
          args: ["-y", "@upstash/context7-mcp@latest"],
          env: { CONTEXT7_API_KEY: "[REDACTED]" },
        },
        "devsh-memory": {
          command: "npx",
          args: ["-y", "devsh-memory-mcp@latest"],
        },
      },
    });
  });

  it("redacts sensitive Claude preview values while preserving MCP structure", () => {
    expect(
      JSON.parse(
        buildMergedClaudePreview({
          hostConfigText: JSON.stringify({
            theme: "dark",
            projects: {
              "/tmp/project": {
                apiKeyHelper: "/tmp/helper",
              },
            },
            mcpServers: {
              existing: {
                command: "node",
                args: ["server.js", "--api-key", "secret-key"],
                env: {
                  API_TOKEN: "abc123",
                },
              },
            },
          }),
          mcpServerConfigs: [REMOTE_CONFIG],
        }),
      ),
    ).toEqual({
      mcpServers: {
        existing: {
          command: "node",
          args: ["server.js", "--api-key", "[REDACTED]"],
          env: {
            API_TOKEN: "[REDACTED]",
          },
        },
        "remote-api": {
          type: "http",
          url: "https://example.com/mcp",
          headers: {
            Authorization: "Bearer [REDACTED]",
          },
          env: {
            MCP_SESSION: "[REDACTED]",
          },
        },
        "devsh-memory": {
          command: "npx",
          args: ["-y", "devsh-memory-mcp@latest"],
        },
      },
    });
  });
});

describe("buildMergedCodexConfigToml", () => {
  it("strips filtered keys, preserves unrelated sections, replaces stale devsh-memory, and appends managed MCP blocks", () => {
    const toml = buildMergedCodexConfigToml({
      hostConfigText: `model = "gpt-5"
model_reasoning_effort = "high"
approval_policy = "on-request"
notify = ["/tmp/notify.sh"]

[profiles.default]
color = "blue"

[mcp_servers.context7]
type = "stdio"
command = "echo"
args = ["stale"]

[mcp_servers.devsh-memory]
type = "stdio"
command = "echo"
args = ["stale-memory"]

[mcp_servers.devsh-memory.env]
TOKEN = "stale"
`,
      mcpServerConfigs: [STDIO_CONFIG, REMOTE_CONFIG],
      agentName: "codex/gpt-5.3-codex-xhigh",
    });

    expect(toml).not.toContain('model = "gpt-5"');
    expect(toml).not.toContain('model_reasoning_effort = "high"');
    expect(toml).toContain('approval_policy = "never"');
    expect(toml).toContain('notify = ["/tmp/notify.sh"]');
    expect(toml).toContain('[profiles.default]');
    expect(toml).toContain('color = "blue"');
    expect(toml).toContain('[notice.model_migrations]');
    expect(toml).toContain('[mcp_servers.devsh-memory]');
    expect(toml).toContain(
      'args = ["-y","devsh-memory-mcp@latest","--agent","codex/gpt-5.3-codex-xhigh"]',
    );
    expect(toml).not.toContain('stale-memory');
    expect(toml).not.toContain('TOKEN = "stale"');
    expect(toml).toContain('[mcp_servers.context7]');
    expect(toml).toContain('command = "echo"');
    expect(toml).toContain('args = ["stale"]');
    expect(toml).not.toContain('@upstash/context7-mcp@latest');
    expect(toml).toContain('[mcp_servers."remote-api"]');
    expect(toml).toContain('[mcp_servers."remote-api".headers]');
    expect(toml.match(/\[mcp_servers\.context7\]/g)).toHaveLength(1);
  });
});

describe("buildMergedCodexPreview", () => {
  it("keeps host Codex MCP blocks when cloud config uses the same name", () => {
    const toml = buildMergedCodexPreview({
      hostConfigText: `[mcp_servers.context7]
 type = "stdio"
 command = "echo"
 args = ["host"]
`,
      mcpServerConfigs: [STDIO_CONFIG],
      agentName: "codex/gpt-5.3-codex-xhigh",
    });

    expect(toml).toContain('[mcp_servers.context7]');
    expect(toml).toContain('command = "echo"');
    expect(toml).toContain('args = ["host"]');
    expect(toml).not.toContain('@upstash/context7-mcp@latest');
  });

  it("redacts sensitive Codex preview values and limits output to MCP sections", () => {
    const toml = buildMergedCodexPreview({
      hostConfigText: `approval_policy = "on-request"
notify = ["/tmp/notify.sh"]

[profiles.default]
color = "blue"

[mcp_servers.context7]
type = "stdio"
command = "echo"
args = ["stale", "--api-key=secret"]

[mcp_servers."remote-api"]
type = "http"
url = "https://example.com/mcp"

[mcp_servers."remote-api".headers]
Authorization = "Bearer host-secret"
`,
      mcpServerConfigs: [STDIO_CONFIG, REMOTE_CONFIG],
      agentName: "codex/gpt-5.3-codex-xhigh",
    });

    expect(toml).not.toContain('approval_policy = "never"');
    expect(toml).not.toContain('[profiles.default]');
    expect(toml).toContain('[mcp_servers.devsh-memory]');
    expect(toml).toContain(
      'args = ["-y","devsh-memory-mcp@latest","--agent","codex/gpt-5.3-codex-xhigh"]',
    );
    expect(toml).toContain('[mcp_servers.context7]');
    expect(toml).toContain('command = "echo"');
    expect(toml).toContain('args = ["stale","--api-key=[REDACTED]"]');
    expect(toml).not.toContain('@upstash/context7-mcp@latest');
    expect(toml).toContain('[mcp_servers."remote-api".headers]');
    expect(toml).toContain('Authorization = "Bearer [REDACTED]"');
    expect(toml).not.toContain('session-token');
    expect(toml).not.toContain('host-secret');
    expect(toml).not.toContain('session-token');
  });

  it("falls back to managed preview when the host file is missing", () => {
    const toml = buildMergedCodexPreview({
      hostConfigText: undefined,
      mcpServerConfigs: [],
    });

    expect(toml).toContain('[mcp_servers.devsh-memory]');
    expect(toml).not.toContain('notify = ["/root/lifecycle/codex-notify.sh"]');
    expect(toml).not.toContain('approval_policy = "never"');
  });
});

describe("buildMergedOpencodePreview", () => {
  it("preserves host OpenCode MCP entries when cloud config uses the same name", () => {
    const preview = buildMergedOpencodePreview({
      hostConfigText: JSON.stringify({
        theme: "dark",
        mcp: {
          context7: {
            type: "local",
            command: ["echo", "host"],
            enabled: true,
          },
        },
      }),
      mcpServerConfigs: [STDIO_CONFIG],
      agentName: "opencode/sonnet-4",
    });

    expect(JSON.parse(preview)).toEqual({
      mcp: {
        context7: {
          type: "local",
          command: ["echo", "host"],
          enabled: true,
        },
        "devsh-memory": {
          type: "local",
          command: ["npx", "-y", "devsh-memory-mcp@latest", "--agent", "opencode/sonnet-4"],
          enabled: true,
        },
      },
    });
  });

  it("falls back cleanly when the OpenCode host file is missing", () => {
    expect(
      JSON.parse(
        buildMergedOpencodePreview({
          hostConfigText: undefined,
          mcpServerConfigs: [STDIO_CONFIG],
        }),
      ),
    ).toEqual({
      mcp: {
        context7: {
          type: "local",
          command: ["npx", "-y", "@upstash/context7-mcp@latest"],
          enabled: true,
          environment: { CONTEXT7_API_KEY: "[REDACTED]" },
        },
        "devsh-memory": {
          type: "local",
          command: ["npx", "-y", "devsh-memory-mcp@latest"],
          enabled: true,
        },
      },
    });
  });
});

describe("formatPreviewNameList", () => {
  it("formats one or many preview names for UI copy", () => {
    expect(formatPreviewNameList([])).toBe("");
    expect(formatPreviewNameList(["context7"])).toBe("context7");
    expect(formatPreviewNameList(["context7", "devsh-memory"])).toBe(
      "context7 and devsh-memory",
    );
    expect(formatPreviewNameList(["context7", "devsh-memory", "search"])).toBe(
      "context7, devsh-memory and search",
    );
  });
});

describe("getMcpPreviewScopeDescription", () => {
  it("describes global and workspace MCP previews", () => {
    expect(getMcpPreviewScopeDescription("global")).toBe("Global MCP settings preview.");
    expect(getMcpPreviewScopeDescription("workspace")).toBe(
      "Workspace preview layered over global MCP settings.",
    );
    expect(getMcpPreviewScopeDescription("workspace", "owner/repo-a")).toBe(
      "Workspace preview for owner/repo-a layered over global MCP settings.",
    );
  });
});

describe("getWebPreviewInjectedServerNames", () => {
  it("returns injected server names with optional built-ins", () => {
    expect(getWebPreviewInjectedServerNames("claude")).toEqual(["devsh-memory"]);
    expect(getWebPreviewInjectedServerNames("claude", { includeBuiltins: true })).toEqual([
      "context7",
      "devsh-memory",
    ]);
  });
});

describe("getWebPreviewInjectedServersDescription", () => {
  it("formats injected server copy from shared state", () => {
    expect(getWebPreviewInjectedServersDescription("claude")).toBe("devsh-memory is included.");
    expect(getWebPreviewInjectedServersDescription("claude", { includeBuiltins: true })).toBe(
      "context7 and devsh-memory are included.",
    );
  });
});

describe("getWorkspacePreviewProjectNames", () => {
  it("returns sorted unique workspace project names", () => {
    expect(getWorkspacePreviewProjectNames(PREVIEW_SOURCE_CONFIGS)).toEqual([
      "owner/repo-a",
      "owner/repo-b",
    ]);
  });
});

describe("deriveEffectiveMcpPreviewConfigsByAgent", () => {
  it("derives preview configs for all agents in a single pass", () => {
    const previewConfigs = deriveEffectiveMcpPreviewConfigsByAgent(
      PREVIEW_SOURCE_CONFIGS,
      "workspace",
      normalizePreviewSourceConfig,
      {
        workspaceProjectFullName: "owner/repo-a",
        includeBuiltins: true,
      },
    );

    expect(previewConfigs.claude).toEqual([
      {
        name: "context7",
        type: "stdio",
        command: "bunx",
        args: ["workspace-context7"],
      },
      {
        name: "search",
        type: "stdio",
        command: "npx",
        args: ["search"],
      },
    ]);
    expect(previewConfigs.codex).toEqual([
      {
        name: "docs",
        type: "http",
        url: "https://example.com/mcp",
      },
      {
        name: "search",
        type: "stdio",
        command: "npx",
        args: ["search"],
      },
    ]);
    expect(previewConfigs.opencode).toEqual([
      {
        name: "context7",
        type: "stdio",
        command: "bunx",
        args: ["workspace-context7"],
      },
      {
        name: "docs",
        type: "http",
        url: "https://example.com/mcp",
      },
      {
        name: "search",
        type: "stdio",
        command: "npx",
        args: ["search"],
      },
    ]);
  });
});

describe("deriveEffectiveMcpPreviewConfigs", () => {
  it("returns global configs when no workspace project is selected", () => {
    expect(
      deriveEffectiveMcpPreviewConfigs(
        PREVIEW_SOURCE_CONFIGS,
        "workspace",
        "claude",
        normalizePreviewSourceConfig,
        { includeBuiltins: true },
      ),
    ).toEqual([
      {
        name: "context7",
        type: "stdio",
        command: "npx",
        args: ["-y", "context7"],
      },
    ]);
  });
});

describe("getWebPreviewBuiltinMcpServers", () => {
  it("returns the built-in Claude web preview MCP servers", () => {
    expect(getWebPreviewBuiltinMcpServers("claude")).toEqual([
      {
        name: "context7",
        type: "stdio",
        command: "bunx",
        args: ["-y", "@upstash/context7-mcp", "--api-key", "[REDACTED]"],
      },
    ]);
  });

  it("returns cloned built-in configs", () => {
    const firstRead = getWebPreviewBuiltinMcpServers("claude");
    const secondRead = getWebPreviewBuiltinMcpServers("claude");
    const firstConfig = firstRead[0];
    const secondConfig = secondRead[0];

    expect(firstConfig?.type).toBe("stdio");
    expect(secondConfig?.type).toBe("stdio");

    if (firstConfig?.type === "stdio") {
      firstConfig.args.push("--mutated");
    }

    expect(secondConfig?.type === "stdio" ? secondConfig.args : undefined).toEqual([
      "-y",
      "@upstash/context7-mcp",
      "--api-key",
      "[REDACTED]",
    ]);
  });

  it("returns no extra web preview MCP servers for Codex or OpenCode", () => {
    expect(getWebPreviewBuiltinMcpServers("codex")).toEqual([]);
    expect(getWebPreviewBuiltinMcpServers("opencode")).toEqual([]);
  });
});

describe("previewOpencodeMcpServers", () => {
  it("includes managed devsh-memory when configs are empty", () => {
    expect(previewOpencodeMcpServers([])).toEqual({
      "devsh-memory": {
        type: "local",
        command: ["npx", "-y", "devsh-memory-mcp@latest"],
        enabled: true,
      },
    });
  });

  it("converts stdio to local and remote to remote", () => {
    const result = previewOpencodeMcpServers(
      [STDIO_CONFIG, REMOTE_CONFIG],
      "opencode/sonnet-4",
    );
    expect(result.context7).toEqual({
      type: "local",
      command: ["npx", "-y", "@upstash/context7-mcp@latest"],
      enabled: true,
      environment: { CONTEXT7_API_KEY: "token" },
    });
    expect(result["remote-api"]).toEqual({
      type: "remote",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer secret" },
      enabled: true,
      environment: { MCP_SESSION: "session-token" },
    });
    expect(result["devsh-memory"]).toEqual({
      type: "local",
      command: ["npx", "-y", "devsh-memory-mcp@latest", "--agent", "opencode/sonnet-4"],
      enabled: true,
    });
  });
});
