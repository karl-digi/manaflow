import {
  deriveEffectiveMcpPreviewConfigs,
  deriveEffectiveMcpPreviewConfigsByAgent,
  getWorkspacePreviewProjectNames,
  normalizeMcpServerConfig,
  type McpServerConfig as PreviewMcpServerConfig,
  type WebPreviewAgent,
} from "@cmux/shared";
import type { McpServerConfig as StoredMcpServerConfig, Scope } from "@/lib/mcp-form-helpers";

export type McpPreviewAgent = WebPreviewAgent;

function normalizePreviewConfig(
  config: StoredMcpServerConfig,
): PreviewMcpServerConfig {
  return normalizeMcpServerConfig({
    name: config.name,
    type: config.type,
    command: config.command,
    args: config.args,
    url: config.url,
    ...(config.headers ? { headers: config.headers } : {}),
    ...(config.envVars ? { envVars: config.envVars } : {}),
  });
}

export function getWorkspacePreviewProjects(
  configs: StoredMcpServerConfig[],
): string[] {
  return getWorkspacePreviewProjectNames(configs);
}

export function deriveEffectiveMcpConfigsByAgent(
  configs: StoredMcpServerConfig[],
  scope: Scope,
  workspaceProjectFullName?: string,
  options?: {
    includeBuiltins?: boolean;
  },
): Record<McpPreviewAgent, PreviewMcpServerConfig[]> {
  return deriveEffectiveMcpPreviewConfigsByAgent(configs, scope, normalizePreviewConfig, {
    workspaceProjectFullName,
    includeBuiltins: options?.includeBuiltins,
  });
}

export function deriveEffectiveMcpConfigs(
  configs: StoredMcpServerConfig[],
  scope: Scope,
  agent: McpPreviewAgent,
  workspaceProjectFullName?: string,
  options?: {
    includeBuiltins?: boolean;
  },
): PreviewMcpServerConfig[] {
  return deriveEffectiveMcpPreviewConfigs(
    configs,
    scope,
    agent,
    normalizePreviewConfig,
    {
      workspaceProjectFullName,
      includeBuiltins: options?.includeBuiltins,
    },
  );
}
