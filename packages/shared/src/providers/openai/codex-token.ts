import { z } from "zod";

/**
 * Codex OAuth token utilities.
 *
 * Centralizes parsing, validation, and expiry checks for Codex CLI OAuth tokens
 * (stored as CODEX_AUTH_JSON in the apiKeys table).
 *
 * The token endpoint and client_id are sourced from OpenAI's auth flow:
 * https://auth.openai.com/oauth/token
 */

// OAuth constants for Codex CLI
export const CODEX_OAUTH_TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_OAUTH_SCOPE = "openid profile email";

/**
 * Zod schema for token fields (can be at top level or nested under "tokens").
 */
const CodexTokenFields = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  id_token: z.string().optional(),
  account_id: z.string().optional(),
});

/**
 * Zod schema matching Codex CLI's auth.json structure.
 *
 * Supports two formats:
 * 1. Nested format (real ~/.codex/auth.json): tokens under "tokens" key
 * 2. Flattened format: tokens at top level (legacy/internal)
 *
 * Fields from CLIProxyAPI CodexTokenStorage:
 * - access_token, refresh_token, id_token: OAuth2 tokens
 * - account_id, email: OpenAI account info
 * - expired: epoch seconds when access_token expires
 * - last_refresh: epoch seconds of last token refresh
 * - type: auth provider type (always "codex")
 */
export const CodexAuthJsonSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  id_token: z.string().optional(),
  account_id: z.string().optional(),
  email: z.string().optional(),
  expired: z.number().optional(),
  last_refresh: z.number().optional(),
  type: z.string().optional(),
});

/**
 * Schema for the full auth.json envelope (nested tokens format).
 */
export const CodexAuthJsonEnvelopeSchema = z.object({
  auth_mode: z.string().optional(),
  last_refresh: z.string().optional(),
  tokens: CodexTokenFields,
  OPENAI_API_KEY: z.string().nullable().optional(),
});

export type CodexAuthJson = z.infer<typeof CodexAuthJsonSchema>;
export type CodexAuthJsonEnvelope = z.infer<typeof CodexAuthJsonEnvelopeSchema>;

/**
 * Extract the exp claim from a JWT access token.
 * Returns epoch seconds or null if extraction fails.
 */
function extractJwtExp(accessToken: string): number | null {
  try {
    const parts = accessToken.split(".");
    if (parts.length !== 3) return null;
    // Base64url decode the payload (handle URL-safe base64)
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(payload);
    const parsed = JSON.parse(decoded);
    return typeof parsed.exp === "number" ? parsed.exp : null;
  } catch {
    return null;
  }
}

/**
 * Parse and validate a raw CODEX_AUTH_JSON string.
 * Supports both nested format (real auth.json) and flattened format.
 * Returns the typed object on success, null on invalid input.
 */
export function parseCodexAuthJson(raw: string): CodexAuthJson | null {
  try {
    const parsed = JSON.parse(raw);

    // Try nested format first (real ~/.codex/auth.json)
    const envelopeResult = CodexAuthJsonEnvelopeSchema.safeParse(parsed);
    if (envelopeResult.success) {
      const { tokens } = envelopeResult.data;
      // Extract expiry from JWT exp claim since envelope format doesn't have expired field
      const expired = extractJwtExp(tokens.access_token);
      return {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        id_token: tokens.id_token,
        account_id: tokens.account_id,
        expired: expired ?? undefined,
      };
    }

    // Fallback to flattened format
    const result = CodexAuthJsonSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Check if a Codex OAuth token is expired.
 * The `expired` field is epoch seconds when the access_token expires.
 * Returns true if expired or if no expiry info is available.
 */
export function isCodexTokenExpired(auth: CodexAuthJson): boolean {
  if (auth.expired == null) return false;
  return Date.now() >= auth.expired * 1000;
}

/**
 * Check if a Codex OAuth token will expire within the given lead time.
 * Default lead time: 24 hours (86_400_000 ms).
 */
export function isCodexTokenExpiring(
  auth: CodexAuthJson,
  leadTimeMs: number = 24 * 60 * 60 * 1000
): boolean {
  if (auth.expired == null) return false;
  return Date.now() + leadTimeMs >= auth.expired * 1000;
}

/**
 * Get the expiry time in epoch milliseconds from auth JSON.
 * Returns null if no expiry info is available.
 */
export function getCodexTokenExpiresAtMs(auth: CodexAuthJson): number | null {
  if (auth.expired == null) return null;
  return auth.expired * 1000;
}
