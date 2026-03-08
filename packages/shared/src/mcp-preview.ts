import {
  normalizeMcpServerConfig,
  type McpServerConfig,
} from "./mcp-server-config";
import {
  buildClaudeMcpServers,
  buildCodexMcpToml,
  buildOpencodeMcpConfig,
} from "./mcp-injection";

const FILTERED_CODEX_CONFIG_KEYS = ["model", "model_reasoning_effort"] as const;
const CODEX_NOTIFY_LINE = 'notify = ["/root/lifecycle/codex-notify.sh"]';
const CODEX_SANDBOX_MODE_LINE = 'sandbox_mode = "danger-full-access"';
const CODEX_APPROVAL_POLICY_LINE = 'approval_policy = "never"';
const CODEX_DISABLE_RESPONSE_STORAGE_LINE = "disable_response_storage = true";
const MANAGED_MEMORY_SERVER_NAME = "devsh-memory";
const WEB_PREVIEW_AGENT_BUILTINS = {
  claude: [
    normalizeMcpServerConfig({
      name: "context7",
      type: "stdio",
      command: "bunx",
      args: ["-y", "@upstash/context7-mcp", "--api-key", "[REDACTED]"],
    }),
  ],
  codex: [],
  opencode: [],
} satisfies Record<"claude" | "codex" | "opencode", McpServerConfig[]>;
const MIGRATION_TARGET_MODEL = "gpt-5.3-codex";
const REDACTED_VALUE = "[REDACTED]";
const REDACTED_BEARER_VALUE = "Bearer [REDACTED]";
const SENSITIVE_KEY_SEGMENTS = new Set([
  "accesskey",
  "accesstoken",
  "apikey",
  "auth",
  "authorization",
  "bearer",
  "clientsecret",
  "cookie",
  "password",
  "refreshtoken",
  "secret",
  "session",
  "token",
]);
const MODELS_TO_MIGRATE = [
  "gpt-5.2-codex",
  "gpt-5.1-codex-max",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5",
  "gpt-5-codex",
  "gpt-5-codex-mini",
] as const;

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

export type BuildMergedPreviewOptions = {
  hostConfigText?: string;
  mcpServerConfigs: McpServerConfig[];
  agentName?: string;
};

export type WebPreviewAgent = "claude" | "codex" | "opencode";
export type WebPreviewScope = "global" | "workspace";

type PreviewSourceConfigBase = {
  name: string;
  scope: WebPreviewScope;
  projectFullName?: string;
  enabledClaude: boolean;
  enabledCodex: boolean;
  enabledOpencode: boolean;
};

const WEB_PREVIEW_AGENTS = ["claude", "codex", "opencode"] as const;
const WEB_PREVIEW_AGENT_ENABLED_FIELDS = {
  claude: "enabledClaude",
  codex: "enabledCodex",
  opencode: "enabledOpencode",
} satisfies Record<
  WebPreviewAgent,
  keyof Pick<PreviewSourceConfigBase, "enabledClaude" | "enabledCodex" | "enabledOpencode">
>;

function cloneMcpServerConfig(config: McpServerConfig): McpServerConfig {
  if (config.type === "stdio") {
    return {
      ...config,
      args: [...config.args],
      ...(config.envVars ? { envVars: { ...config.envVars } } : {}),
    };
  }

  return {
    ...config,
    ...(config.headers ? { headers: { ...config.headers } } : {}),
    ...(config.envVars ? { envVars: { ...config.envVars } } : {}),
  };
}

function dedupeConfigsByName<T extends { name: string }>(configs: T[]): T[] {
  const deduped = new Map<string, T>();

  for (const config of configs) {
    deduped.delete(config.name);
    deduped.set(config.name, config);
  }

  return Array.from(deduped.values());
}

function getScopedPreviewConfigs<T extends PreviewSourceConfigBase>(
  configs: T[],
  scope: WebPreviewScope,
  workspaceProjectFullName?: string,
): T[] {
  const globalConfigs = dedupeConfigsByName(
    configs.filter((config) => config.scope === "global"),
  );

  if (scope !== "workspace" || !workspaceProjectFullName) {
    return globalConfigs;
  }

  const workspaceConfigs = dedupeConfigsByName(
    configs.filter(
      (config) =>
        config.scope === "workspace" &&
        config.projectFullName === workspaceProjectFullName,
    ),
  );

  const mergedConfigs = new Map<string, T>();
  for (const config of globalConfigs) {
    mergedConfigs.set(config.name, config);
  }
  for (const config of workspaceConfigs) {
    mergedConfigs.set(config.name, config);
  }

  return Array.from(mergedConfigs.values());
}

export function getWebPreviewBuiltinMcpServers(agent: WebPreviewAgent): McpServerConfig[] {
  return WEB_PREVIEW_AGENT_BUILTINS[agent].map(cloneMcpServerConfig);
}

export function getWorkspacePreviewProjectNames<
  T extends { scope: WebPreviewScope; projectFullName?: string },
>(configs: T[]): string[] {
  return Array.from(
    new Set(
      configs
        .filter(
          (config): config is T & { projectFullName: string } =>
            config.scope === "workspace" && typeof config.projectFullName === "string",
        )
        .map((config) => config.projectFullName),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

export function formatPreviewNameList(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }

  const leadingNames = names.slice(0, -1);
  const trailingName = names[names.length - 1];
  return `${leadingNames.join(", ")} and ${trailingName}`;
}

export function getMcpPreviewScopeDescription(
  scope: WebPreviewScope,
  workspaceProjectFullName?: string,
): string {
  if (scope === "workspace" && workspaceProjectFullName) {
    return `Workspace preview for ${workspaceProjectFullName} layered over global MCP settings.`;
  }

  if (scope === "workspace") {
    return "Workspace preview layered over global MCP settings.";
  }

  return "Global MCP settings preview.";
}

export function getWebPreviewInjectedServerNames(
  agent: WebPreviewAgent,
  options?: { includeBuiltins?: boolean },
): string[] {
  const includeBuiltins = options?.includeBuiltins ?? false;
  const injectedServerNames = [MANAGED_MEMORY_SERVER_NAME];

  if (!includeBuiltins) {
    return injectedServerNames;
  }

  return [
    ...new Set([
      ...WEB_PREVIEW_AGENT_BUILTINS[agent].map((config) => config.name),
      ...injectedServerNames,
    ]),
  ];
}

export function getWebPreviewInjectedServersDescription(
  agent: WebPreviewAgent,
  options?: { includeBuiltins?: boolean },
): string {
  const names = getWebPreviewInjectedServerNames(agent, options);
  const formattedNames = formatPreviewNameList(names);

  return names.length === 1
    ? `${formattedNames} is included.`
    : `${formattedNames} are included.`;
}

export function deriveEffectiveMcpPreviewConfigsByAgent<T extends PreviewSourceConfigBase>(
  configs: T[],
  scope: WebPreviewScope,
  normalizeConfig: (config: T) => McpServerConfig,
  options?: {
    workspaceProjectFullName?: string;
    includeBuiltins?: boolean;
  },
): Record<WebPreviewAgent, McpServerConfig[]> {
  const includeBuiltins = options?.includeBuiltins ?? false;
  const scopedConfigs = getScopedPreviewConfigs(
    configs,
    scope,
    options?.workspaceProjectFullName,
  );
  const previewConfigsByAgent = {
    claude: new Map<string, McpServerConfig>(),
    codex: new Map<string, McpServerConfig>(),
    opencode: new Map<string, McpServerConfig>(),
  } satisfies Record<WebPreviewAgent, Map<string, McpServerConfig>>;

  if (includeBuiltins) {
    for (const agent of WEB_PREVIEW_AGENTS) {
      for (const config of getWebPreviewBuiltinMcpServers(agent)) {
        previewConfigsByAgent[agent].set(config.name, config);
      }
    }
  }

  for (const config of scopedConfigs) {
    const enabledAgents = WEB_PREVIEW_AGENTS.filter(
      (agent) => config[WEB_PREVIEW_AGENT_ENABLED_FIELDS[agent]],
    );
    if (enabledAgents.length === 0) {
      continue;
    }

    const normalizedConfig = normalizeConfig(config);
    for (const agent of enabledAgents) {
      previewConfigsByAgent[agent].set(normalizedConfig.name, normalizedConfig);
    }
  }

  return {
    claude: Array.from(previewConfigsByAgent.claude.values()),
    codex: Array.from(previewConfigsByAgent.codex.values()),
    opencode: Array.from(previewConfigsByAgent.opencode.values()),
  };
}

export function deriveEffectiveMcpPreviewConfigs<T extends PreviewSourceConfigBase>(
  configs: T[],
  scope: WebPreviewScope,
  agent: WebPreviewAgent,
  normalizeConfig: (config: T) => McpServerConfig,
  options?: {
    workspaceProjectFullName?: string;
    includeBuiltins?: boolean;
  },
): McpServerConfig[] {
  const includeBuiltins = options?.includeBuiltins ?? false;
  const scopedConfigs = getScopedPreviewConfigs(
    configs,
    scope,
    options?.workspaceProjectFullName,
  );
  const previewConfigs = new Map<string, McpServerConfig>();

  if (includeBuiltins) {
    for (const config of getWebPreviewBuiltinMcpServers(agent)) {
      previewConfigs.set(config.name, config);
    }
  }

  for (const config of scopedConfigs) {
    if (!config[WEB_PREVIEW_AGENT_ENABLED_FIELDS[agent]]) {
      continue;
    }

    const normalizedConfig = normalizeConfig(config);
    previewConfigs.set(normalizedConfig.name, normalizedConfig);
  }

  return Array.from(previewConfigs.values());
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(values: JsonValue[]): values is string[] {
  return values.every((value) => typeof value === "string");
}

function getManagedMemoryArgs(agentName?: string): string[] {
  return agentName
    ? ["-y", "devsh-memory-mcp@latest", "--agent", agentName]
    : ["-y", "devsh-memory-mcp@latest"];
}

function getManagedClaudeMemoryServer(agentName?: string): JsonObject {
  return {
    command: "npx",
    args: getManagedMemoryArgs(agentName),
  };
}

function getManagedCodexMemoryBlock(agentName?: string): string {
  return `[mcp_servers.${MANAGED_MEMORY_SERVER_NAME}]
type = "stdio"
command = "npx"
args = ${JSON.stringify(getManagedMemoryArgs(agentName))}`;
}

function parseHostJsonConfig(hostConfigText?: string): JsonObject {
  if (!hostConfigText?.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(hostConfigText) as unknown;
    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getExistingOpencodeMcpServers(config: JsonObject): JsonObject {
  const mcpServers = config.mcp;
  return isJsonObject(mcpServers) ? mcpServers : {};
}

function getExistingClaudeMcpServers(config: JsonObject): JsonObject {
  const mcpServers = config.mcpServers;
  return isJsonObject(mcpServers) ? mcpServers : {};
}

const MCP_SERVER_SECTION_NAME_RE =
  /^\[mcp_servers(?:\.([^\]."]+)|\."([^"]+)")(?:\.[^\]]+)?\]$/;

function getHostCodexMcpServerNames(toml: string): string[] {
  const names = new Set<string>();

  for (const line of toml.split("\n")) {
    const trimmedLine = line.trim();
    const match = trimmedLine.match(MCP_SERVER_SECTION_NAME_RE);
    const name = match?.[1] ?? match?.[2];
    if (name) {
      names.add(name);
    }
  }

  return Array.from(names);
}

function normalizeSensitiveKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_SEGMENTS.has(normalizeSensitiveKey(key));
}

function redactSensitiveString(value: string): string {
  if (/^Bearer\s+/i.test(value)) {
    return REDACTED_BEARER_VALUE;
  }

  const authorizationHeaderMatch = value.match(/^(Authorization\s*:\s*Bearer)\s+.+$/i);
  if (authorizationHeaderMatch) {
    return `${authorizationHeaderMatch[1]} [REDACTED]`;
  }

  return REDACTED_VALUE;
}

function isSensitiveFlag(flag: string): boolean {
  const normalizedFlag = flag.replace(/^-+/, "");
  return isSensitiveKey(normalizedFlag);
}

function redactArgsArray(args: string[]): string[] {
  return args.map((arg, index) => {
    const previousArg = index > 0 ? args[index - 1] : undefined;
    if (previousArg && /^-/.test(previousArg) && isSensitiveFlag(previousArg)) {
      return redactSensitiveString(arg);
    }

    const inlineAssignmentMatch = arg.match(/^(-{1,2}[^=]+)=(.*)$/);
    if (inlineAssignmentMatch) {
      const inlineFlag = inlineAssignmentMatch[1];
      const inlineValue = inlineAssignmentMatch[2];
      if (inlineFlag && inlineValue !== undefined && isSensitiveFlag(inlineFlag)) {
        return `${inlineFlag}=${redactSensitiveString(inlineValue)}`;
      }
    }

    if (/^Bearer\s+/i.test(arg) || /^Authorization\s*:\s*Bearer\s+/i.test(arg)) {
      return redactSensitiveString(arg);
    }

    return arg;
  });
}

function redactJsonValue(
  value: JsonValue,
  path: string[] = [],
  forceRedactStrings = false,
): JsonValue {
  if (typeof value === "string") {
    return forceRedactStrings ? redactSensitiveString(value) : value;
  }

  if (Array.isArray(value)) {
    const currentKey = path[path.length - 1];
    if ((currentKey === "args" || currentKey === "command") && isStringArray(value)) {
      return redactArgsArray(value);
    }

    return value.map((item, index) =>
      redactJsonValue(item, [...path, String(index)], forceRedactStrings),
    );
  }

  if (!isJsonObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, childValue]) => {
      const nextForceRedactStrings =
        forceRedactStrings ||
        key === "env" ||
        key === "environment" ||
        key === "headers" ||
        isSensitiveKey(key);
      return [key, redactJsonValue(childValue, [...path, key], nextForceRedactStrings)];
    }),
  );
}

function redactJsonObject(value: JsonObject): JsonObject {
  const redactedValue = redactJsonValue(value);
  return isJsonObject(redactedValue) ? redactedValue : {};
}

function generateModelMigrations(): string {
  const migrations = MODELS_TO_MIGRATE.map(
    (model) => `"${model}" = "${MIGRATION_TARGET_MODEL}"`,
  ).join("\n");
  return `\n[notice.model_migrations]\n${migrations}\n`;
}

function stripModelMigrations(toml: string): string {
  return toml.replace(/\[notice\.model_migrations\][\s\S]*?(?=\n\[|$)/g, "");
}

function stripManagedMemoryMcpBlock(toml: string): string {
  let result = toml.replace(
    /\n?\[mcp_servers(?:\.devsh-memory|\."devsh-memory")\.[^\]]+\][\s\S]*?(?=\n\[|$)/g,
    "",
  );
  result = result.replace(
    /\n?\[mcp_servers(?:\.devsh-memory|\."devsh-memory")\][\s\S]*?(?=\n\[|$)/g,
    "",
  );
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

function extractMcpServerSections(toml: string): string {
  const blocks: string[] = [];
  let currentBlock: string[] = [];
  let keepCurrentBlock = false;

  for (const line of toml.split("\n")) {
    const trimmedLine = line.trim();
    const isSectionHeader = trimmedLine.startsWith("[") && trimmedLine.endsWith("]");

    if (isSectionHeader) {
      if (keepCurrentBlock && currentBlock.length > 0) {
        blocks.push(currentBlock.join("\n").trimEnd());
      }

      keepCurrentBlock = trimmedLine.startsWith("[mcp_servers");
      currentBlock = keepCurrentBlock ? [line] : [];
      continue;
    }

    if (keepCurrentBlock) {
      currentBlock.push(line);
    }
  }

  if (keepCurrentBlock && currentBlock.length > 0) {
    blocks.push(currentBlock.join("\n").trimEnd());
  }

  return blocks.join("\n\n").trim();
}

function parseTomlValue(value: string): string | string[] | null {
  const trimmedValue = value.trim();

  try {
    const parsedValue = JSON.parse(trimmedValue) as unknown;
    if (typeof parsedValue === "string") {
      return parsedValue;
    }

    return Array.isArray(parsedValue) && parsedValue.every((item) => typeof item === "string")
      ? parsedValue
      : null;
  } catch {
    return null;
  }
}

function redactTomlValue(value: string): string {
  const parsedValue = parseTomlValue(value);
  if (typeof parsedValue === "string") {
    return JSON.stringify(redactSensitiveString(parsedValue));
  }

  return JSON.stringify(REDACTED_VALUE);
}

function redactCodexPreviewToml(toml: string): string {
  let isSensitiveTable = false;

  return toml
    .split("\n")
    .map((line) => {
      const trimmedLine = line.trim();
      const isSectionHeader = trimmedLine.startsWith("[") && trimmedLine.endsWith("]");

      if (isSectionHeader) {
        isSensitiveTable = trimmedLine.includes(".headers]") || trimmedLine.includes(".env]");
        return line;
      }

      const keyValueMatch = line.match(/^(\s*([^=\s]+)\s*=\s*)(.*)$/);
      if (!keyValueMatch) {
        return line;
      }

      const prefix = keyValueMatch[1];
      const rawKey = keyValueMatch[2];
      const rawValue = keyValueMatch[3];
      if (!prefix || !rawKey || rawValue === undefined) {
        return line;
      }

      const normalizedKey = rawKey.replace(/^['"]|['"]$/g, "");

      if (normalizedKey === "args") {
        const parsedArgs = parseTomlValue(rawValue);
        if (Array.isArray(parsedArgs)) {
          return `${prefix}${JSON.stringify(redactArgsArray(parsedArgs))}`;
        }
      }

      if (isSensitiveTable || isSensitiveKey(normalizedKey)) {
        return `${prefix}${redactTomlValue(rawValue)}`;
      }

      return line;
    })
    .join("\n")
    .trim();
}

export function buildMergedClaudeConfig(
  options: BuildMergedPreviewOptions,
): JsonObject {
  const existingConfig = parseHostJsonConfig(options.hostConfigText);
  const existingMcpServers = getExistingClaudeMcpServers(existingConfig);

  return {
    ...existingConfig,
    mcpServers: {
      ...buildClaudeMcpServers(options.mcpServerConfigs),
      ...existingMcpServers,
      [MANAGED_MEMORY_SERVER_NAME]: getManagedClaudeMemoryServer(options.agentName),
    },
  };
}

export function buildMergedClaudePreview(
  options: BuildMergedPreviewOptions,
): string {
  const mergedConfig = buildMergedClaudeConfig(options);
  const previewConfig = {
    mcpServers: redactJsonObject(getExistingClaudeMcpServers(mergedConfig)),
  };

  return JSON.stringify(previewConfig, null, 2);
}

export function stripFilteredConfigKeys(toml: string): string {
  let result = toml;
  for (const key of FILTERED_CODEX_CONFIG_KEYS) {
    result = result.replace(new RegExp(`^${key}\\s*=\\s*.*$`, "gm"), "");
  }
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

export function ensureCodexDefaults(toml: string): string {
  const hasNotify = /(^|\n)\s*notify\s*=/.test(toml);
  const hasSandboxMode = /(^|\n)\s*sandbox_mode\s*=/.test(toml);
  const hasApprovalPolicy = /(^|\n)\s*approval_policy\s*=/.test(toml);
  const hasDisableResponseStorage = /(^|\n)\s*disable_response_storage\s*=/.test(toml);
  const hasLegacyAskForApproval = /(^|\n)\s*ask_for_approval\s*=/.test(toml);

  let result = toml;
  if (hasApprovalPolicy) {
    result = result.replace(
      /(^|\n)\s*approval_policy\s*=\s*.*/g,
      `$1${CODEX_APPROVAL_POLICY_LINE}`,
    );
  }
  if (hasLegacyAskForApproval) {
    result = result.replace(/(^|\n)\s*ask_for_approval\s*=\s*.*/g, "");
  }

  const hasAllDefaults =
    hasNotify &&
    hasSandboxMode &&
    hasDisableResponseStorage &&
    (hasApprovalPolicy || hasLegacyAskForApproval);

  if (hasAllDefaults) {
    if (hasLegacyAskForApproval && !hasApprovalPolicy) {
      return `${CODEX_APPROVAL_POLICY_LINE}\n${result.trim()}`;
    }
    return result;
  }

  const defaults: string[] = [];
  if (!hasNotify) {
    defaults.push(CODEX_NOTIFY_LINE);
  }
  if (!hasSandboxMode) {
    defaults.push(CODEX_SANDBOX_MODE_LINE);
  }
  if (!hasApprovalPolicy && !hasLegacyAskForApproval) {
    defaults.push(CODEX_APPROVAL_POLICY_LINE);
  }
  if (!hasDisableResponseStorage) {
    defaults.push(CODEX_DISABLE_RESPONSE_STORAGE_LINE);
  }

  return result ? `${defaults.join("\n")}\n${result}` : defaults.join("\n");
}

export function stripMcpServerBlocksByName(toml: string, names: string[]): string {
  let result = toml;
  for (const name of names) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(
        `\\n?\\[mcp_servers(?:\\.${escapedName}|\\."${escapedName}")\\.[^\\]]+\\][\\s\\S]*?(?=\\n\\[|$)`,
        "g",
      ),
      "",
    );
    result = result.replace(
      new RegExp(
        `\\n?\\[mcp_servers(?:\\.${escapedName}|\\."${escapedName}")\\][\\s\\S]*?(?=\\n\\[|$)`,
        "g",
      ),
      "",
    );
  }
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

export function ensureManagedMemoryMcpServerConfig(
  toml: string,
  agentName?: string,
): string {
  const normalizedToml = stripManagedMemoryMcpBlock(toml);
  const managedMemoryBlock = getManagedCodexMemoryBlock(agentName);

  if (!normalizedToml) {
    return `${managedMemoryBlock}\n`;
  }

  return `${normalizedToml}\n\n${managedMemoryBlock}\n`;
}

export function buildMergedCodexConfigToml(
  options: BuildMergedPreviewOptions,
): string {
  const filteredToml = stripFilteredConfigKeys(options.hostConfigText ?? "");
  let toml = ensureCodexDefaults(filteredToml);
  toml = stripModelMigrations(toml) + generateModelMigrations();
  toml = ensureManagedMemoryMcpServerConfig(toml, options.agentName);

  const managedConfigs = options.mcpServerConfigs.filter(
    (config) => config.name !== MANAGED_MEMORY_SERVER_NAME,
  );
  const hostMcpServerNames = new Set(getHostCodexMcpServerNames(options.hostConfigText ?? ""));
  toml = stripMcpServerBlocksByName(
    toml,
    managedConfigs
      .map((config) => config.name)
      .filter((name) => !hostMcpServerNames.has(name)),
  );
  const cloudManagedConfigs = managedConfigs.filter(
    (config) => !hostMcpServerNames.has(config.name),
  );
  if (cloudManagedConfigs.length === 0) {
    return toml;
  }

  const cloudMcpToml = buildCodexMcpToml(cloudManagedConfigs);
  if (!cloudMcpToml) {
    return toml;
  }

  return `${toml.trimEnd()}\n\n${cloudMcpToml}\n`;
}

export function buildMergedCodexPreview(
  options: BuildMergedPreviewOptions,
): string {
  const mergedToml = buildMergedCodexConfigToml(options);
  const mcpSections = extractMcpServerSections(mergedToml);
  return redactCodexPreviewToml(mcpSections);
}

export function buildMergedOpencodePreview(
  options: BuildMergedPreviewOptions,
): string {
  const existingConfig = parseHostJsonConfig(options.hostConfigText);
  const existingMcpServers = getExistingOpencodeMcpServers(existingConfig);
  const mergedConfig = {
    ...existingConfig,
    mcp: {
      ...buildOpencodeMcpConfig(options.mcpServerConfigs, options.agentName),
      ...existingMcpServers,
    },
  } satisfies JsonObject;
  const previewConfig = {
    mcp: redactJsonObject(getExistingOpencodeMcpServers(mergedConfig)),
  };

  return JSON.stringify(previewConfig, null, 2);
}

export function previewOpencodeMcpServers(
  configs: McpServerConfig[],
  agentName?: string,
): Record<string, unknown> {
  return buildOpencodeMcpConfig(configs, agentName);
}
