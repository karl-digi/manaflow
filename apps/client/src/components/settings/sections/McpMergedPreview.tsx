import {
  getMcpPreviewScopeDescription,
  getWebPreviewInjectedServersDescription,
} from "@cmux/shared";
import { SegmentedTabs } from "@/components/mcp/McpFormSections";
import { SettingSection } from "@/components/settings/SettingSection";
import type { Scope } from "@/lib/mcp-form-helpers";
import type { HostMcpFileResult } from "@/types/electron";
import type { McpPreviewAgent } from "./mcp-preview-helpers";

const PREVIEW_AGENT_LABELS: Record<McpPreviewAgent, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
};


function getHostConfigDescription(
  agent: McpPreviewAgent,
  hostConfig: HostMcpFileResult | null,
): string {
  const fileName = agent === "claude"
    ? "~/.claude.json"
    : agent === "codex"
      ? "~/.codex/config.toml"
      : "~/.config/opencode/opencode.json";

  if (hostConfig?.ok) {
    return `Using local ${fileName} as the base host config.`;
  }

  return `Local ${fileName} was not found, so this preview starts from an empty host config.`;
}


export interface McpMergedPreviewProps {
  activeAgent: McpPreviewAgent;
  onActiveAgentChange: (agent: McpPreviewAgent) => void;
  previewText: string;
  claudeHostConfig: HostMcpFileResult | null;
  codexHostConfig: HostMcpFileResult | null;
  opencodeHostConfig?: HostMcpFileResult | null;
  scope: Scope;
  workspaceProjectFullName?: string;
  workspaceProjects?: string[];
  selectedWorkspaceProject?: string;
  onWorkspaceProjectChange?: (projectFullName: string) => void;
  webMode?: boolean;
}

export function McpMergedPreview({
  activeAgent,
  onActiveAgentChange,
  previewText,
  claudeHostConfig,
  codexHostConfig,
  opencodeHostConfig = null,
  scope,
  workspaceProjectFullName,
  workspaceProjects = [],
  selectedWorkspaceProject,
  onWorkspaceProjectChange,
  webMode = false,
}: McpMergedPreviewProps) {
  const hostConfig = activeAgent === "claude"
    ? claudeHostConfig
    : activeAgent === "codex"
      ? codexHostConfig
      : opencodeHostConfig;

  return (
    <SettingSection
      title={webMode ? "Effective preview" : "Merged preview"}
      description={webMode
        ? "This preview shows only the MCP config cmux will upload for each agent in web mode. It does not fetch or merge any local agent config files. Sensitive values are redacted, and built-in injected MCP servers are included."
        : "Desktop only. This preview combines your local host config with the MCP settings that will be uploaded into remote sandboxes."}
      headerAction={
        <SegmentedTabs
          value={activeAgent}
          onChange={onActiveAgentChange}
          options={[
            { value: "claude", label: "Claude" },
            { value: "codex", label: "Codex" },
            { value: "opencode", label: "OpenCode" },
          ]}
        />
      }
    >
      <div className="space-y-4 p-4">
        {scope === "workspace" && workspaceProjects.length > 1 ? (
          <div className="space-y-2">
            <label
              htmlFor="mcp-preview-workspace-project"
              className="text-sm font-medium text-neutral-900 dark:text-neutral-100"
            >
              Workspace repo
            </label>
            <select
              id="mcp-preview-workspace-project"
              value={selectedWorkspaceProject}
              onChange={(event) => onWorkspaceProjectChange?.(event.target.value)}
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
            >
              {workspaceProjects.map((projectFullName) => (
                <option key={projectFullName} value={projectFullName}>
                  {projectFullName}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="rounded-lg border border-neutral-200 bg-neutral-50/80 px-3 py-2 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
          <p>{getMcpPreviewScopeDescription(scope, workspaceProjectFullName)}</p>
          {webMode ? (
            <p className="mt-1">Local agent config files are not fetched or merged in web mode.</p>
          ) : <p className="mt-1">{getHostConfigDescription(activeAgent, hostConfig)}</p>}
          <p className="mt-1">Sensitive values are redacted in this preview.</p>
          {webMode && activeAgent === "claude" ? (
            <p className="mt-1">
              Claude previews also include the built-in observed live web-mode MCP entries. {getWebPreviewInjectedServersDescription(
                "claude",
                { includeBuiltins: true },
              )}
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-neutral-200 bg-neutral-950 dark:border-neutral-800">
          <div className="border-b border-neutral-800 px-3 py-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
            {PREVIEW_AGENT_LABELS[activeAgent]} effective config
          </div>
          <pre className="overflow-x-auto p-3 text-xs text-neutral-100">
            <code>{previewText}</code>
          </pre>
        </div>
      </div>
    </SettingSection>
  );
}
