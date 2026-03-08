import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { McpServerConfig } from "@/lib/mcp-form-helpers";
import type { HostMcpFileResult } from "@/types/electron";
import { McpMergedPreview, type McpMergedPreviewProps } from "./McpMergedPreview";
import {
  deriveEffectiveMcpConfigs,
  getWorkspacePreviewProjects,
} from "./mcp-preview-helpers";

const missingHostConfig: HostMcpFileResult = {
  ok: false,
  path: "/Users/test/.claude.json",
  error: "ENOENT",
};

const presentClaudeHostConfig: HostMcpFileResult = {
  ok: true,
  path: "/Users/test/.claude.json",
  content: '{"theme":"dark"}',
};

const presentCodexHostConfig: HostMcpFileResult = {
  ok: true,
  path: "/Users/test/.codex/config.toml",
  content: 'model = "gpt-5"',
};

const missingOpencodeHostConfig: HostMcpFileResult = {
  ok: false,
  path: "/Users/test/.config/opencode/opencode.json",
  error: "ENOENT",
};

function createConfig(
  config: Omit<McpServerConfig, "_id" | "_creationTime" | "createdAt" | "updatedAt" | "teamId" | "userId">,
): McpServerConfig {
  return {
    _id: `${config.scope}-${config.name}` as McpServerConfig["_id"],
    _creationTime: 1,
    createdAt: 1,
    updatedAt: 1,
    teamId: "team-1",
    userId: "user-1",
    ...config,
  };
}

function renderPreviewMarkup(
  overrides: Partial<McpMergedPreviewProps> = {},
): string {
  const props: McpMergedPreviewProps = {
    activeAgent: "claude",
    onActiveAgentChange: () => {},
    previewText: '{"mcpServers":{"context7":{}}}',
    claudeHostConfig: presentClaudeHostConfig,
    codexHostConfig: presentCodexHostConfig,
    opencodeHostConfig: missingOpencodeHostConfig,
    scope: "global",
    workspaceProjects: [],
    selectedWorkspaceProject: undefined,
    onWorkspaceProjectChange: () => {},
    ...overrides,
  };

  return renderToStaticMarkup(createElement(McpMergedPreview, props));
}

const configs: McpServerConfig[] = [
  createConfig({
    name: "context7",
    displayName: "Context7",
    type: "stdio",
    command: "npx",
    args: ["-y", "context7"],
    enabledClaude: true,
    enabledCodex: true,
    enabledGemini: false,
    enabledOpencode: true,
    scope: "global",
  }),
  createConfig({
    name: "docs",
    displayName: "Docs",
    type: "http",
    url: "https://example.com/mcp",
    enabledClaude: false,
    enabledCodex: true,
    enabledGemini: false,
    enabledOpencode: true,
    scope: "global",
  }),
  createConfig({
    name: "context7",
    displayName: "Workspace Context7",
    type: "stdio",
    command: "bunx",
    args: ["workspace-context7"],
    enabledClaude: true,
    enabledCodex: false,
    enabledGemini: false,
    enabledOpencode: true,
    scope: "workspace",
    projectFullName: "owner/repo-a",
  }),
  createConfig({
    name: "search",
    displayName: "Search",
    type: "stdio",
    command: "npx",
    args: ["search"],
    enabledClaude: true,
    enabledCodex: true,
    enabledGemini: false,
    enabledOpencode: true,
    scope: "workspace",
    projectFullName: "owner/repo-a",
  }),
  createConfig({
    name: "zeta",
    displayName: "Zeta",
    type: "stdio",
    command: "npx",
    args: ["zeta"],
    enabledClaude: true,
    enabledCodex: true,
    enabledGemini: false,
    enabledOpencode: true,
    scope: "workspace",
    projectFullName: "owner/repo-b",
  }),
];

describe("getWorkspacePreviewProjects", () => {
  it("returns sorted workspace projects", () => {
    expect(getWorkspacePreviewProjects(configs)).toEqual([
      "owner/repo-a",
      "owner/repo-b",
    ]);
  });
});

describe("deriveEffectiveMcpConfigs", () => {
  it("returns built-ins plus enabled global configs for global scope", () => {
    expect(
      deriveEffectiveMcpConfigs(configs, "global", "claude", undefined, {
        includeBuiltins: true,
      }).map((config) => config.name),
    ).toEqual(["context7"]);

    expect(
      deriveEffectiveMcpConfigs(configs, "global", "codex", undefined, {
        includeBuiltins: true,
      }).map((config) => config.name),
    ).toEqual(["context7", "docs"]);

    expect(
      deriveEffectiveMcpConfigs(configs, "global", "opencode", undefined, {
        includeBuiltins: true,
      }).map((config) => config.name),
    ).toEqual(["context7", "docs"]);
  });

  it("applies workspace overrides on top of global configs", () => {
    const workspaceClaudeConfigs = deriveEffectiveMcpConfigs(
      configs,
      "workspace",
      "claude",
      "owner/repo-a",
      { includeBuiltins: true },
    );

    expect(workspaceClaudeConfigs.map((config) => config.name)).toEqual([
      "context7",
      "search",
    ]);
    expect(workspaceClaudeConfigs[0]).toEqual({
      name: "context7",
      type: "stdio",
      command: "bunx",
      args: ["workspace-context7"],
    });
  });

  it("falls back cleanly when no workspace project is selected", () => {
    expect(
      deriveEffectiveMcpConfigs(configs, "workspace", "claude", undefined, {
        includeBuiltins: true,
      }).map((config) => config.name),
    ).toEqual(["context7"]);
  });

  it("normalizes configs for preview builders", () => {
    const [remoteConfig] = deriveEffectiveMcpConfigs(configs, "global", "codex").filter(
      (config) => config.name === "docs",
    );

    expect(remoteConfig).toEqual({
      name: "docs",
      type: "http",
      url: "https://example.com/mcp",
    });
  });
});

describe("McpMergedPreview", () => {
  it("renders workspace-specific Claude preview details", () => {
    const markup = renderPreviewMarkup({
      activeAgent: "claude",
      scope: "workspace",
      workspaceProjectFullName: "owner/repo-a",
      workspaceProjects: ["owner/repo-a", "owner/repo-b"],
      selectedWorkspaceProject: "owner/repo-a",
    });

    expect(markup).toContain("Merged preview");
    expect(markup).toContain("Workspace repo");
    expect(markup).toContain("Workspace preview for owner/repo-a layered over global MCP settings.");
    expect(markup).toContain("Using local ~/.claude.json as the base host config.");
    expect(markup).toContain("Sensitive values are redacted in this preview.");
    expect(markup).toContain("Claude effective config");
    expect(markup).toContain("owner/repo-b");
  });

  it("renders Codex fallback text when the host config is missing", () => {
    const markup = renderPreviewMarkup({
      activeAgent: "codex",
      previewText: '[mcp_servers.context7]\ncommand = "npx"\n',
      codexHostConfig: {
        ...missingHostConfig,
        path: "/Users/test/.codex/config.toml",
      },
    });

    expect(markup).toContain("Codex effective config");
    expect(markup).toContain(
      "Local ~/.codex/config.toml was not found, so this preview starts from an empty host config.",
    );
    expect(markup).toContain('[mcp_servers.context7]');
  });

  it("renders OpenCode fallback text when the host config is missing", () => {
    const markup = renderPreviewMarkup({
      activeAgent: "opencode",
      previewText: '{"context7":{"type":"local"}}',
    });

    expect(markup).toContain("OpenCode effective config");
    expect(markup).toContain(
      "Local ~/.config/opencode/opencode.json was not found, so this preview starts from an empty host config.",
    );
    expect(markup).toContain("context7");
  });

  it("renders web-mode effective preview copy", () => {
    const markup = renderPreviewMarkup({
      activeAgent: "claude",
      webMode: true,
    });

    expect(markup).toContain("Effective preview");
    expect(markup).toContain("This preview shows only the MCP config cmux will upload for each agent in web mode.");
    expect(markup).toContain("It does not fetch or merge any local agent config files.");
    expect(markup).toContain("Local agent config files are not fetched or merged in web mode.");
    expect(markup).not.toContain("Using local ~/.claude.json as the base host config.");
    expect(markup).toContain("Claude previews also include the built-in observed live web-mode MCP entries.");
    expect(markup).toContain("context7 and devsh-memory are included.");
  });

  it("does not render the workspace picker outside multi-project workspace previews", () => {
    expect(renderPreviewMarkup()).not.toContain("Workspace repo");

    expect(
      renderPreviewMarkup({
        scope: "workspace",
        workspaceProjectFullName: "owner/repo-a",
        workspaceProjects: ["owner/repo-a"],
        selectedWorkspaceProject: "owner/repo-a",
      }),
    ).not.toContain("Workspace repo");
  });
});

describe("host config test fixtures", () => {
  it("models a missing host config result", () => {
    expect(missingHostConfig.ok).toBe(false);
    expect(missingHostConfig.error).toBe("ENOENT");
  });
});
