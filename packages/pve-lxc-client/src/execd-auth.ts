import crypto from "node:crypto";

export const EXECD_TOKEN_ENV_KEY = "CMUX_EXECD_AUTH_TOKEN";
export const EXECD_TOKEN_DESCRIPTION_MARKER = "cmux-execd-auth-token=";
export const DEFAULT_HOOKSCRIPT_VOLUME =
  "local:snippets/cmux-lxc-execd-token-hook.sh";
export const EXECD_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function isValidExecdAuthToken(token: string): boolean {
  return EXECD_TOKEN_PATTERN.test(token);
}

export function generateExecdAuthToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function upsertRuntimeEnv(env: string, token: string): string {
  const prefix = `${EXECD_TOKEN_ENV_KEY}=`;
  const entries = env.split("\0").filter((entry) => entry && !entry.startsWith(prefix));
  if (token) {
    entries.push(`${prefix}${token}`);
  }
  return entries.join("\0");
}

export function upsertDescriptionToken(description: string, token: string): string {
  const lines = description.split("\n").filter(
    (line) => !line.trimStart().startsWith(EXECD_TOKEN_DESCRIPTION_MARKER),
  );
  lines.push(`${EXECD_TOKEN_DESCRIPTION_MARKER}${token}`);
  return lines.join("\n");
}

export function parseExecdAuthTokenFromConfig(config: {
  env?: string;
  description?: string;
  hookscript?: string;
}): string | undefined {
  if (config.env) {
    const prefix = `${EXECD_TOKEN_ENV_KEY}=`;
    for (const entry of config.env.split("\0")) {
      if (entry.startsWith(prefix)) {
        const token = entry.slice(prefix.length);
        if (isValidExecdAuthToken(token)) {
          return token;
        }
      }
    }
  }

  if (config.description) {
    for (const line of config.description.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith(EXECD_TOKEN_DESCRIPTION_MARKER)) {
        const token = trimmed.slice(EXECD_TOKEN_DESCRIPTION_MARKER.length);
        if (isValidExecdAuthToken(token)) {
          return token;
        }
      }
    }
  }

  return undefined;
}
