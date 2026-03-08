import { isRemoteMcpServerConfig, type McpServerConfig } from "./mcp-server-config";

type JsonStdioMcpServer = {
  type?: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
};

type JsonRemoteMcpServer = {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
};

type JsonMcpServer = JsonStdioMcpServer | JsonRemoteMcpServer;

type OpencodeLocalMcpServer = {
  type: "local";
  command: string[];
  enabled: true;
  environment?: Record<string, string>;
};

type OpencodeRemoteMcpServer = {
  type: "remote";
  url: string;
  headers?: Record<string, string>;
  enabled: true;
  environment?: Record<string, string>;
};

type OpencodeMcpServer = OpencodeLocalMcpServer | OpencodeRemoteMcpServer;

const MANAGED_MEMORY_SERVER_NAME = "devsh-memory";

function getManagedMemoryArgs(agentName?: string): string[] {
  return agentName
    ? ["npx", "-y", "devsh-memory-mcp@latest", "--agent", agentName]
    : ["npx", "-y", "devsh-memory-mcp@latest"];
}

function normalizeStringRecord(
  record?: Record<string, string>,
): Record<string, string> | undefined {
  if (!record) {
    return undefined;
  }

  const entries = Object.entries(record);
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function getUniqueConfigs(configs: McpServerConfig[]): McpServerConfig[] {
  const uniqueConfigs = new Map<string, McpServerConfig>();

  for (const config of configs) {
    uniqueConfigs.delete(config.name);
    uniqueConfigs.set(config.name, config);
  }

  return Array.from(uniqueConfigs.values());
}

function buildJsonMcpServers(
  configs: McpServerConfig[],
): Record<string, JsonMcpServer> {
  return getUniqueConfigs(configs).reduce<Record<string, JsonMcpServer>>(
    (servers, config) => {
      const env = normalizeStringRecord(config.envVars);

      if (isRemoteMcpServerConfig(config)) {
        const headers = normalizeStringRecord(config.headers);
        servers[config.name] = {
          type: config.type,
          url: config.url,
          ...(headers ? { headers } : {}),
          ...(env ? { env } : {}),
        };
        return servers;
      }

      servers[config.name] = {
        command: config.command,
        args: [...config.args],
        ...(env ? { env } : {}),
      };

      return servers;
    },
    {},
  );
}

function formatTomlKeySegment(key: string): string {
  return /^[A-Za-z0-9_]+$/.test(key) ? key : JSON.stringify(key);
}

function formatTomlString(value: string): string {
  return JSON.stringify(value);
}

function formatTomlStringArray(values: string[]): string {
  return `[${values.map((value) => formatTomlString(value)).join(",")}]`;
}

export function buildClaudeMcpServers(
  configs: McpServerConfig[],
): Record<string, JsonMcpServer> {
  return buildJsonMcpServers(configs);
}

export function buildGeminiMcpServers(
  configs: McpServerConfig[],
): Record<string, JsonMcpServer> {
  return buildJsonMcpServers(configs);
}

export function buildCodexMcpToml(configs: McpServerConfig[]): string {
  return getUniqueConfigs(configs)
    .map((config) => {
      const key = formatTomlKeySegment(config.name);
      const lines = [`[mcp_servers.${key}]`, `type = ${formatTomlString(config.type)}`];

      if (isRemoteMcpServerConfig(config)) {
        lines.push(`url = ${formatTomlString(config.url)}`);
      } else {
        lines.push(`command = ${formatTomlString(config.command)}`);
        lines.push(`args = ${formatTomlStringArray(config.args)}`);
      }

      const headers = isRemoteMcpServerConfig(config)
        ? normalizeStringRecord(config.headers)
        : undefined;
      const env = normalizeStringRecord(config.envVars);

      const sections = [lines.join("\n")];

      if (headers) {
        const headerLines = Object.entries(headers).map(
          ([headerKey, headerValue]) =>
            `${formatTomlKeySegment(headerKey)} = ${formatTomlString(headerValue)}`,
        );
        sections.push(
          [`[mcp_servers.${key}.headers]`, ...headerLines].join("\n"),
        );
      }

      if (env) {
        const envLines = Object.entries(env).map(
          ([envKey, envValue]) =>
            `${formatTomlKeySegment(envKey)} = ${formatTomlString(envValue)}`,
        );
        sections.push([`[mcp_servers.${key}.env]`, ...envLines].join("\n"));
      }

      return sections.join("\n\n");
    })
    .join("\n\n");
}

export function buildOpencodeMcpConfig(
  configs: McpServerConfig[],
  agentName?: string,
): Record<string, OpencodeMcpServer> {
  const servers = getUniqueConfigs(configs).reduce<Record<string, OpencodeMcpServer>>(
    (acc, config) => {
      const environment = normalizeStringRecord(config.envVars);

      if (isRemoteMcpServerConfig(config)) {
        const headers = normalizeStringRecord(config.headers);
        acc[config.name] = {
          type: "remote",
          url: config.url,
          enabled: true,
          ...(headers ? { headers } : {}),
          ...(environment ? { environment } : {}),
        };
        return acc;
      }

      acc[config.name] = {
        type: "local",
        command: [config.command, ...config.args],
        enabled: true,
        ...(environment ? { environment } : {}),
      };
      return acc;
    },
    {},
  );

  servers[MANAGED_MEMORY_SERVER_NAME] = {
    type: "local",
    command: getManagedMemoryArgs(agentName),
    enabled: true,
  };

  return servers;
}
