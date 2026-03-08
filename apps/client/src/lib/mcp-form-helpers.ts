import type { Doc } from "@cmux/convex/dataModel";
import {
  buildEmptyMcpFormState,
  buildMcpTransportPayload,
  formatMcpEnvVarsText,
  formatMcpHeadersText,
  getScopedMcpProjectFullName,
  isValidMcpProjectFullName,
  parseMcpArgsText,
  parseMcpEnvVarsText,
  parseMcpHeadersText,
  type McpFormState,
  type McpServerPreset,
  type McpTransportType,
} from "@cmux/shared";

export type Scope = "global" | "workspace";
export type AgentKey = "claude" | "codex" | "gemini" | "opencode";
export type McpServerConfig = Doc<"mcpServerConfigs">;

export type FormState = McpFormState;

export type ParsedJsonConfig = {
  transportType: McpTransportType;
  command: string;
  argsText: string;
  url: string;
  headersText: string;
  envVarsText: string;
  error?: string;
};

export type AgentField = keyof Pick<
  McpServerConfig,
  "enabledClaude" | "enabledCodex" | "enabledGemini" | "enabledOpencode"
>;

export type AgentOption = {
  key: AgentKey;
  label: string;
  field: AgentField;
};

export const VALID_MCP_NAME_REGEX = /^[A-Za-z0-9_-]+$/;
export const EXISTING_SECRET_PLACEHOLDER = "<existing-secret>";
export const MCP_INPUT_CLASS_NAME =
  "mt-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
export const MCP_TEXTAREA_CLASS_NAME =
  "mt-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm text-neutral-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
export const MCP_MONO_TEXTAREA_CLASS_NAME = `${MCP_TEXTAREA_CLASS_NAME} font-mono`;

export const AGENT_OPTIONS: AgentOption[] = [
  { key: "claude", label: "Claude", field: "enabledClaude" },
  { key: "codex", label: "Codex", field: "enabledCodex" },
  { key: "gemini", label: "Gemini", field: "enabledGemini" },
  { key: "opencode", label: "OpenCode", field: "enabledOpencode" },
];

export const EMPTY_AGENT_COUNTS: Record<AgentKey, number> = {
  claude: 0,
  codex: 0,
  gemini: 0,
  opencode: 0,
};

export const MCP_TRANSPORT_OPTIONS: Array<{
  value: McpTransportType;
  label: string;
}> = [
  { value: "stdio", label: "stdio" },
  { value: "http", label: "http" },
  { value: "sse", label: "sse" },
];

const JSON_CONFIG_FIELDS = new Set<keyof FormState>([
  "transportType",
  "command",
  "argsText",
  "url",
  "headersText",
  "envVarsText",
]);

const MCP_TRANSPORT_COPY: Record<
  McpTransportType,
  {
    placeholder: string;
    description: string;
    subtitle: string;
    summary: string;
  }
> = {
  stdio: {
    placeholder:
      '{\n  "type": "stdio",\n  "command": "npx",\n  "args": ["-y", "@my/mcp-server@latest"]\n}',
    description: "Edit the raw MCP stdio configuration as JSON.",
    subtitle: "Supported keys: type, command, args, env.",
    summary: "stdio uses command, arguments, and environment variables.",
  },
  http: {
    placeholder:
      '{\n  "type": "http",\n  "url": "https://example.com/mcp",\n  "headers": {\n    "Authorization": "Bearer token"\n  }\n}',
    description: "Edit the raw MCP http configuration as JSON.",
    subtitle: "Supported keys: type, url, headers, env.",
    summary: "HTTP uses a URL with optional headers and environment variables.",
  },
  sse: {
    placeholder:
      '{\n  "type": "sse",\n  "url": "https://example.com/sse",\n  "headers": {\n    "Authorization": "Bearer token"\n  }\n}',
    description: "Edit the raw MCP sse configuration as JSON.",
    subtitle: "Supported keys: type, url, headers, env.",
    summary: "SSE uses a URL with optional headers and environment variables.",
  },
};

export function shouldRebuildJsonConfig(field: keyof FormState): boolean {
  return JSON_CONFIG_FIELDS.has(field);
}

export function getScopeOptions(counts?: Record<Scope, number>) {
  return [
    {
      value: "global",
      label: counts ? `Global (${counts.global})` : "Global",
    },
    {
      value: "workspace",
      label: counts ? `Workspace (${counts.workspace})` : "Workspace",
    },
  ] satisfies Array<{ value: Scope; label: string }>;
}

export const DEFAULT_SCOPE_OPTIONS = getScopeOptions();

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function buildEmptyForm(scope: Scope): FormState {
  return buildEmptyMcpFormState(scope);
}

export function formatEnvVarsText(
  envVars: Record<string, string> | undefined,
  includeExistingSecretPlaceholder = false,
): string {
  return formatMcpEnvVarsText(envVars, includeExistingSecretPlaceholder);
}

export function formatHeadersText(headers: Record<string, string> | undefined): string {
  return formatMcpHeadersText(headers);
}

export function getTransportType(config: Pick<McpServerConfig, "type">): McpTransportType {
  return config.type ?? "stdio";
}

export function buildFormFromConfig(config: McpServerConfig): FormState {
  const transportType = getTransportType(config);

  return {
    name: config.name,
    displayName: config.displayName,
    transportType,
    command: transportType === "stdio" ? (config.command ?? "") : "",
    argsText: transportType === "stdio" ? (config.args ?? []).join("\n") : "",
    url: transportType === "stdio" ? "" : (config.url ?? ""),
    headersText: transportType === "stdio" ? "" : formatHeadersText(config.headers),
    envVarsText: formatEnvVarsText(config.envVars, true),
    description: config.description ?? "",
    enabledClaude: config.enabledClaude,
    enabledCodex: config.enabledCodex,
    enabledGemini: config.enabledGemini,
    enabledOpencode: config.enabledOpencode,
    scope: config.scope,
    projectFullName: config.projectFullName ?? "",
  };
}

export function parseArgsText(value: string): string[] {
  return parseMcpArgsText(value);
}

export function getJsonConfigUiCopy(transportType: McpTransportType) {
  return MCP_TRANSPORT_COPY[transportType];
}

export function parseHeadersText(value: string): {
  headers?: Record<string, string>;
  error?: string;
} {
  const parsed = parseMcpHeadersText(value);
  return {
    headers: parsed.entries,
    error: parsed.error,
  };
}

export type McpJsonConfig =
  | {
      type?: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | {
      type: "http" | "sse";
      url: string;
      headers?: Record<string, string>;
      env?: Record<string, string>;
    };

export function buildJsonConfigText(
  input: Pick<
    FormState,
    "transportType" | "command" | "argsText" | "url" | "headersText" | "envVarsText"
  >,
): string {
  const parsedEnvVars = parseEnvVarsText(input.envVarsText);

  if (input.transportType === "http" || input.transportType === "sse") {
    const parsedHeaders = parseHeadersText(input.headersText);
    const config: McpJsonConfig = {
      type: input.transportType,
      url: input.url.trim(),
    };

    if (parsedHeaders.headers && Object.keys(parsedHeaders.headers).length > 0) {
      config.headers = parsedHeaders.headers;
    }

    if (parsedEnvVars.hasChanges && parsedEnvVars.envVars) {
      config.env = parsedEnvVars.envVars;
    }

    return JSON.stringify(config, null, 2);
  }

  const config: McpJsonConfig = {
    type: "stdio",
    command: input.command.trim(),
  };

  const args = parseArgsText(input.argsText);
  if (args.length > 0) {
    config.args = args;
  }

  if (parsedEnvVars.hasChanges && parsedEnvVars.envVars) {
    config.env = parsedEnvVars.envVars;
  }

  return JSON.stringify(config, null, 2);
}

export function parseJsonConfigText(value: string): ParsedJsonConfig {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        transportType: "stdio",
        command: "",
        argsText: "",
        url: "",
        headersText: "",
        envVarsText: "",
        error: "JSON configuration must be an object.",
      };
    }

    const config = parsed as Record<string, unknown>;
    const transportType =
      config.type === "http" || config.type === "sse" || config.type === "stdio"
        ? config.type
        : "stdio";

    let envVarsText = "";
    if (config.env !== undefined) {
      if (
        typeof config.env !== "object" ||
        config.env === null ||
        Array.isArray(config.env) ||
        Object.values(config.env).some((entry) => typeof entry !== "string")
      ) {
        return {
          transportType,
          command: "",
          argsText: "",
          url: "",
          headersText: "",
          envVarsText: "",
          error: "JSON configuration env must be an object of string values.",
        };
      }
      envVarsText = formatEnvVarsText(config.env as Record<string, string>);
    }

    if (transportType === "http" || transportType === "sse") {
      if (typeof config.url !== "string" || config.url.trim().length === 0) {
        return {
          transportType,
          command: "",
          argsText: "",
          url: "",
          headersText: "",
          envVarsText,
          error: "JSON configuration requires a non-empty url string.",
        };
      }

      let headersText = "";
      if (config.headers !== undefined) {
        if (
          typeof config.headers !== "object" ||
          config.headers === null ||
          Array.isArray(config.headers) ||
          Object.values(config.headers).some((entry) => typeof entry !== "string")
        ) {
          return {
            transportType,
            command: "",
            argsText: "",
            url: "",
            headersText: "",
            envVarsText,
            error: "JSON configuration headers must be an object of string values.",
          };
        }
        headersText = formatHeadersText(config.headers as Record<string, string>);
      }

      return {
        transportType,
        command: "",
        argsText: "",
        url: config.url,
        headersText,
        envVarsText,
      };
    }

    if (typeof config.command !== "string" || config.command.trim().length === 0) {
      return {
        transportType: "stdio",
        command: "",
        argsText: "",
        url: "",
        headersText: "",
        envVarsText,
        error: "JSON configuration requires a non-empty command string.",
      };
    }

    let argsText = "";
    if (config.args !== undefined) {
      if (!Array.isArray(config.args) || config.args.some((entry) => typeof entry !== "string")) {
        return {
          transportType: "stdio",
          command: "",
          argsText: "",
          url: "",
          headersText: "",
          envVarsText,
          error: "JSON configuration args must be an array of strings.",
        };
      }
      argsText = config.args.join("\n");
    }

    return {
      transportType: "stdio",
      command: config.command,
      argsText,
      url: "",
      headersText: "",
      envVarsText,
    };
  } catch (error) {
    console.error(error);
    return {
      transportType: "stdio",
      command: "",
      argsText: "",
      url: "",
      headersText: "",
      envVarsText: "",
      error: "JSON configuration must be valid JSON.",
    };
  }
}

export function parseEnvVarsText(value: string): {
  envVars?: Record<string, string>;
  hasChanges: boolean;
  error?: string;
} {
  const parsed = parseMcpEnvVarsText(value, {
    placeholderValue: EXISTING_SECRET_PLACEHOLDER,
    trimValue: false,
  });

  return {
    envVars: parsed.entries,
    hasChanges: parsed.hasChanges,
    error: parsed.error,
  };
}

export function isValidProjectFullName(value: string): boolean {
  return isValidMcpProjectFullName(value);
}

export function getScopedProjectFullName(
  scope: Scope,
  projectFullName: string,
): string | undefined {
  return getScopedMcpProjectFullName(scope, projectFullName);
}

export function buildEnabledAgentState(
  config: Pick<McpServerConfig, AgentField>,
  field: AgentField,
  nextValue: boolean,
): Pick<McpServerConfig, AgentField> {
  const nextState = {
    enabledClaude: config.enabledClaude,
    enabledCodex: config.enabledCodex,
    enabledGemini: config.enabledGemini,
    enabledOpencode: config.enabledOpencode,
  };

  nextState[field] = nextValue;
  return nextState;
}

export function countEnabledAgents(
  configs: Array<Pick<McpServerConfig, AgentField>>,
): Record<AgentKey, number> {
  const nextCounts = { ...EMPTY_AGENT_COUNTS };

  for (const config of configs) {
    for (const agent of AGENT_OPTIONS) {
      if (config[agent.field]) {
        nextCounts[agent.key] += 1;
      }
    }
  }

  return nextCounts;
}

export function matchesTarget(
  config: McpServerConfig,
  scope: Scope,
  projectFullName: string,
): boolean {
  if (config.scope !== scope) {
    return false;
  }

  if (scope === "global") {
    return true;
  }

  return (config.projectFullName ?? "") === projectFullName.trim();
}

export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateForm(form: FormState): string | null {
  if (!form.name.trim()) {
    return "Name is required.";
  }
  if (!VALID_MCP_NAME_REGEX.test(form.name.trim())) {
    return "Name can only contain letters, numbers, hyphens, and underscores.";
  }
  if (!form.displayName.trim()) {
    return "Display name is required.";
  }
  if (form.transportType === "stdio") {
    if (!form.command.trim()) {
      return "Command is required.";
    }
  } else if (!validateUrl(form.url)) {
    return "A valid http or https URL is required.";
  }
  if (!AGENT_OPTIONS.some((agent) => form[agent.field])) {
    return "Enable at least one agent.";
  }
  if (
    form.scope === "workspace" &&
    !isValidProjectFullName(form.projectFullName)
  ) {
    return "Workspace scope requires a repository in owner/repo format.";
  }

  const parsedHeaders = parseHeadersText(form.headersText);
  if (parsedHeaders.error) {
    return parsedHeaders.error;
  }

  const parsedEnvVars = parseEnvVarsText(form.envVarsText);
  if (parsedEnvVars.error) {
    return parsedEnvVars.error;
  }

  return null;
}

export function getTransportPayload(
  input: Pick<
    FormState,
    "transportType" | "command" | "argsText" | "url" | "headersText"
  >,
) {
  return buildMcpTransportPayload(input);
}

export function formatMcpServerTarget(config: Pick<McpServerConfig, "type" | "command" | "args" | "url">): string {
  const transportType = getTransportType(config);

  if (transportType !== "stdio") {
    return config.url ?? "";
  }

  return (config.args ?? []).length > 0
    ? `${config.command ?? ""} ${(config.args ?? []).join(" ")}`
    : (config.command ?? "");
}

export function getPresetPayload(
  preset: McpServerPreset,
  scope: Scope,
  projectFullName: string,
) {
  if (scope === "workspace" && !isValidProjectFullName(projectFullName)) {
    throw new Error("Workspace scope requires a repository in owner/repo format.");
  }

  return {
    name: preset.name,
    displayName: preset.displayName,
    type: preset.type,
    command: preset.command,
    args: preset.args,
    description: preset.description,
    tags: preset.tags,
    enabledClaude: preset.supportedAgents.claude,
    enabledCodex: preset.supportedAgents.codex,
    enabledGemini: preset.supportedAgents.gemini,
    enabledOpencode: preset.supportedAgents.opencode,
    scope,
    projectFullName: scope === "workspace" ? projectFullName.trim() : undefined,
  };
}
