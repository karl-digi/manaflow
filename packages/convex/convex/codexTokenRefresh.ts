"use node";

/**
 * Codex OAuth Token Auto-Refresh (Action)
 *
 * Centralizes token refresh server-side so that only one entity ever consumes
 * the refresh token. Sandboxes always get fresh access tokens via the apiKeys table.
 *
 * Cron runs every 15 minutes to proactively refresh tokens expiring within 24 hours.
 * Uses exponential backoff for failures: min(5min * 2^(failureCount-1), 6 hours).
 */

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  parseCodexAuthJson,
  getCodexTokenExpiresAtMs,
  isCodexTokenExpiring,
  CODEX_OAUTH_TOKEN_ENDPOINT,
  CODEX_OAUTH_CLIENT_ID,
  CODEX_OAUTH_SCOPE,
  CodexAuthJsonEnvelopeSchema,
} from "@cmux/shared/providers/openai/codex-token";

const LEAD_TIME_MS = 24 * 60 * 60 * 1000; // 24 hours

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
};

/**
 * Check if an HTTP status code represents a transient error worth retrying.
 * Retries: 5xx server errors, 429 rate limit, network errors
 * No retry: 4xx client errors (invalid_grant, invalid_client, etc.)
 */
function isTransientError(status: number): boolean {
  return status >= 500 || status === 429;
}

async function refreshTokenWithRetry(
  refreshToken: string,
  maxRetries: number = 3
): Promise<TokenResponse> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const params = new URLSearchParams({
        client_id: CODEX_OAUTH_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: CODEX_OAUTH_SCOPE,
      });

      const response = await fetch(CODEX_OAUTH_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      if (!response.ok) {
        const status = response.status;
        const errorText = await response.text();

        // Don't retry permanent OAuth errors (4xx except 429)
        if (!isTransientError(status)) {
          throw new Error(
            `Permanent OAuth error ${status}: ${errorText}`
          );
        }

        // Transient error - will be retried
        throw new Error(
          `Transient error ${status}: ${errorText}`
        );
      }

      return (await response.json()) as TokenResponse;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry permanent errors
      if (lastError.message.startsWith("Permanent OAuth error")) {
        throw lastError;
      }

      console.warn(
        `[CodexTokenRefresh] Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`
      );

      if (attempt < maxRetries) {
        // Linear backoff: 1s, 2s, 3s
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  throw lastError ?? new Error("Refresh failed after retries");
}

/**
 * Refresh all expiring Codex OAuth tokens.
 * Called by cron job every 15 minutes.
 */
export const refreshExpiring = internalAction({
  args: {},
  handler: async (ctx) => {
    const expiringKeys = await ctx.runQuery(
      internal.codexTokenRefreshQueries.getExpiringCodexKeys,
    );

    if (expiringKeys.length === 0) return;

    console.log(
      `[CodexTokenRefresh] Found ${expiringKeys.length} expiring Codex token(s)`
    );

    for (const key of expiringKeys) {
      const auth = parseCodexAuthJson(key.value);
      if (!auth) {
        console.error(
          `[CodexTokenRefresh] Failed to parse CODEX_AUTH_JSON for key ${key._id}`
        );
        await ctx.runMutation(
          internal.codexTokenRefreshQueries.recordRefreshFailure,
          {
            keyId: key._id,
            errorMessage: "Failed to parse CODEX_AUTH_JSON",
          }
        );
        continue;
      }

      // If tokenExpiresAt was null, just populate it without refreshing
      // (unless the token is actually expiring)
      if (key.tokenExpiresAt == null && !isCodexTokenExpiring(auth, LEAD_TIME_MS)) {
        const expiresAtMs = getCodexTokenExpiresAtMs(auth);
        if (expiresAtMs != null) {
          await ctx.runMutation(
            internal.codexTokenRefreshQueries.updateRefreshedToken,
            {
              keyId: key._id,
              newValue: key.value,
              tokenExpiresAt: expiresAtMs,
              isActualRefresh: false, // Bootstrap only - no OAuth refresh performed
            }
          );
        }
        continue;
      }

      // Attempt refresh
      try {
        const tokenResponse = await refreshTokenWithRetry(auth.refresh_token, 3);

        // Build updated auth JSON, preserving original envelope structure
        const originalParsed = JSON.parse(key.value);
        const isEnvelopeFormat = CodexAuthJsonEnvelopeSchema.safeParse(originalParsed).success;
        const newExpiresAt = (Math.floor(Date.now() / 1000) + tokenResponse.expires_in) * 1000;

        let newValue: string;
        if (isEnvelopeFormat) {
          // Preserve envelope structure (real ~/.codex/auth.json format)
          const updatedEnvelope = {
            ...originalParsed,
            last_refresh: new Date().toISOString(),
            tokens: {
              ...originalParsed.tokens,
              access_token: tokenResponse.access_token,
              refresh_token: tokenResponse.refresh_token,
              id_token: tokenResponse.id_token,
            },
          };
          newValue = JSON.stringify(updatedEnvelope);
        } else {
          // Flattened format (legacy/internal)
          const updatedAuth = {
            ...auth,
            access_token: tokenResponse.access_token,
            refresh_token: tokenResponse.refresh_token,
            id_token: tokenResponse.id_token,
            expired: Math.floor(Date.now() / 1000) + tokenResponse.expires_in,
            last_refresh: Math.floor(Date.now() / 1000),
          };
          newValue = JSON.stringify(updatedAuth);
        }

        await ctx.runMutation(
          internal.codexTokenRefreshQueries.updateRefreshedToken,
          {
            keyId: key._id,
            newValue,
            tokenExpiresAt: newExpiresAt,
          }
        );

        console.log(
          `[CodexTokenRefresh] Refreshed token for key ${key._id}, ` +
            `new expiry: ${new Date(newExpiresAt).toISOString()}`
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        console.error(
          `[CodexTokenRefresh] Failed to refresh token for key ${key._id}: ${errorMessage}`
        );
        await ctx.runMutation(
          internal.codexTokenRefreshQueries.recordRefreshFailure,
          {
            keyId: key._id,
            errorMessage,
          }
        );
      }
    }
  },
});
