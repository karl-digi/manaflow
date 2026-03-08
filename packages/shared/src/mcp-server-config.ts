export type McpTransportType = "stdio" | "http" | "sse";

export interface McpBaseServerConfig {
  name: string;
  envVars?: Record<string, string>;
}

export interface McpStdioServerConfig extends McpBaseServerConfig {
  type: "stdio";
  command: string;
  args: string[];
}

export interface McpRemoteServerConfig extends McpBaseServerConfig {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServerConfig | McpRemoteServerConfig;

export type McpServerConfigInput = McpBaseServerConfig & {
  type?: McpTransportType;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
};

export function isRemoteMcpServerConfig(
  config: McpServerConfig,
): config is McpRemoteServerConfig {
  return config.type === "http" || config.type === "sse";
}

export function isStdioMcpServerConfig(
  config: McpServerConfig,
): config is McpStdioServerConfig {
  return config.type === "stdio";
}

export function normalizeMcpServerConfig(
  config: McpServerConfigInput,
): McpServerConfig {
  if (config.type === "http" || config.type === "sse") {
    return {
      name: config.name,
      type: config.type,
      url: config.url ?? "",
      ...(config.headers ? { headers: config.headers } : {}),
      ...(config.envVars ? { envVars: config.envVars } : {}),
    };
  }

  return {
    name: config.name,
    type: "stdio",
    command: config.command ?? "",
    args: config.args ?? [],
    ...(config.envVars ? { envVars: config.envVars } : {}),
  };
}
