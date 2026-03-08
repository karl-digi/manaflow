import { parseGithubRepoUrl } from "./utils/parse-github-repo-url";
import type { McpTransportType } from "./mcp-server-config";

export type McpFormScope = "global" | "workspace";

export type McpFormState = {
  name: string;
  displayName: string;
  transportType: McpTransportType;
  command: string;
  argsText: string;
  url: string;
  headersText: string;
  envVarsText: string;
  description: string;
  enabledClaude: boolean;
  enabledCodex: boolean;
  enabledGemini: boolean;
  enabledOpencode: boolean;
  scope: McpFormScope;
  projectFullName: string;
};

export type ParsedMcpKeyValueText = {
  entries?: Record<string, string>;
  hasChanges: boolean;
  error?: string;
};

export type McpTransportPayload =
  | {
      type: "stdio";
      command: string;
      args: string[];
    }
  | {
      type: "http" | "sse";
      url: string;
      headers?: Record<string, string>;
    };

export const EXISTING_SECRET_PLACEHOLDER = "<existing-secret>";

export function buildEmptyMcpFormState(scope: McpFormScope): McpFormState {
  return {
    name: "",
    displayName: "",
    transportType: "stdio",
    command: "",
    argsText: "",
    url: "",
    headersText: "",
    envVarsText: "",
    description: "",
    enabledClaude: true,
    enabledCodex: true,
    enabledGemini: true,
    enabledOpencode: true,
    scope,
    projectFullName: "",
  };
}

export function formatMcpEnvVarsText(
  envVars: Record<string, string> | undefined,
  includeExistingSecretPlaceholder = false,
): string {
  if (!envVars) {
    return "";
  }

  return Object.keys(envVars)
    .map((key) =>
      `${key}=${includeExistingSecretPlaceholder ? EXISTING_SECRET_PLACEHOLDER : envVars[key]}`,
    )
    .join("\n");
}

export function formatMcpHeadersText(
  headers: Record<string, string> | undefined,
  separator = ": ",
): string {
  if (!headers) {
    return "";
  }

  return Object.entries(headers)
    .map(([key, value]) => `${key}${separator}${value}`)
    .join("\n");
}

export function parseMcpArgsText(value: string): string[] {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseMcpKeyValueText(
  value: string,
  options: {
    placeholderValue?: string;
    label: string;
    allowColonSeparator?: boolean;
    trimValue?: boolean;
  },
): ParsedMcpKeyValueText {
  const lines = value.split("\n").filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { hasChanges: false };
  }

  const entries: Array<[string, string]> = [];
  let hasChanges = false;

  for (const line of lines) {
    const trimmedLine = line.trimStart();
    const equalsIndex = trimmedLine.indexOf("=");
    const colonIndex = options.allowColonSeparator ? trimmedLine.indexOf(":") : -1;
    const separatorIndex = colonIndex > 0 && (equalsIndex < 0 || colonIndex < equalsIndex)
      ? colonIndex
      : equalsIndex;

    if (separatorIndex <= 0) {
      return {
        hasChanges: false,
        error: options.allowColonSeparator
          ? `${options.label} must use KEY: value or KEY=value format, one per line.`
          : `${options.label} must use KEY=value format, one per line.`,
      };
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1);
    const parsedValue = options.trimValue === false ? rawValue : rawValue.trim();

    if (!key) {
      return {
        hasChanges: false,
        error: options.allowColonSeparator
          ? `${options.label} must include a key before ':' or '='.`
          : `${options.label} must include a non-empty key before '='.`,
      };
    }

    if (options.placeholderValue && parsedValue === options.placeholderValue) {
      continue;
    }

    hasChanges = true;
    entries.push([key, parsedValue]);
  }

  if (!hasChanges || entries.length === 0) {
    return { hasChanges: false };
  }

  return { entries: Object.fromEntries(entries), hasChanges: true };
}

export function parseMcpEnvVarsText(
  value: string,
  options?: { placeholderValue?: string; trimValue?: boolean },
): ParsedMcpKeyValueText {
  return parseMcpKeyValueText(value, {
    placeholderValue: options?.placeholderValue,
    label: "Environment variables",
    trimValue: options?.trimValue,
  });
}

export function parseMcpHeadersText(
  value: string,
  options?: { trimValue?: boolean },
): ParsedMcpKeyValueText {
  return parseMcpKeyValueText(value, {
    label: "Headers",
    allowColonSeparator: true,
    trimValue: options?.trimValue,
  });
}

export function isValidMcpProjectFullName(value: string): boolean {
  return parseGithubRepoUrl(value)?.fullName === value.trim();
}

export function getScopedMcpProjectFullName(
  scope: McpFormScope,
  projectFullName: string,
): string | undefined {
  return scope === "workspace" ? projectFullName.trim() : undefined;
}

export function buildMcpTransportPayload(
  input: Pick<McpFormState, "transportType" | "command" | "argsText" | "url" | "headersText">,
  options?: { trimHeaderValues?: boolean },
): McpTransportPayload {
  if (input.transportType === "stdio") {
    return {
      type: "stdio",
      command: input.command.trim(),
      args: parseMcpArgsText(input.argsText),
    };
  }

  const parsedHeaders = parseMcpHeadersText(input.headersText, {
    trimValue: options?.trimHeaderValues,
  });

  return {
    type: input.transportType,
    url: input.url.trim(),
    ...(parsedHeaders.entries ? { headers: parsedHeaders.entries } : {}),
  };
}
