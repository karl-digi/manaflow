/**
 * Codex OAuth Token Refresh - Queries and Mutations
 *
 * Separated from the action file because Convex only allows actions
 * in "use node" files. These run in the Convex runtime (no Node APIs).
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  parseCodexAuthJson,
  isCodexTokenExpired,
  isCodexTokenExpiring,
} from "@cmux/shared/providers/openai/codex-token";

const LEAD_TIME_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_FAILURE_COUNT = 10;
const BASE_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000; // 6 hours

function getBackoffMs(failureCount: number): number {
  return Math.min(
    BASE_BACKOFF_MS * Math.pow(2, failureCount - 1),
    MAX_BACKOFF_MS
  );
}

/**
 * Query all CODEX_AUTH_JSON keys that need refresh.
 * Filters by:
 * - tokenExpiresAt within lead time (or null, meaning needs parse)
 * - Not exceeding max failure count
 * - Not in backoff period
 */
export const getExpiringCodexKeys = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Get all CODEX_AUTH_JSON keys
    const allKeys = await ctx.db
      .query("apiKeys")
      .withIndex("by_envVar", (q) => q.eq("envVar", "CODEX_AUTH_JSON"))
      .collect();

    return allKeys.filter((key) => {
      // Skip keys that have failed too many times
      if (
        key.refreshFailureCount != null &&
        key.refreshFailureCount >= MAX_FAILURE_COUNT
      ) {
        return false;
      }

      // Skip keys in backoff period
      if (
        key.lastRefreshAttemptAt != null &&
        key.refreshFailureCount != null &&
        key.refreshFailureCount > 0
      ) {
        const backoff = getBackoffMs(key.refreshFailureCount);
        if (now < key.lastRefreshAttemptAt + backoff) {
          return false;
        }
      }

      // Include keys with no expiry info (need to parse and populate)
      if (key.tokenExpiresAt == null) {
        return true;
      }

      // Include keys expiring within lead time
      return now + LEAD_TIME_MS >= key.tokenExpiresAt;
    });
  },
});

/**
 * Update the API key with refreshed token data.
 * Resets failure tracking on success.
 *
 * @param isActualRefresh - If true, updates lastSuccessfulRefreshAt.
 *   Set to false for bootstrap paths that only populate tokenExpiresAt
 *   without performing an actual OAuth refresh.
 */
export const updateRefreshedToken = internalMutation({
  args: {
    keyId: v.id("apiKeys"),
    newValue: v.string(),
    tokenExpiresAt: v.number(),
    isActualRefresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const patch: Record<string, unknown> = {
      value: args.newValue,
      tokenExpiresAt: args.tokenExpiresAt,
      updatedAt: now,
      refreshFailureCount: 0,
      lastRefreshError: undefined,
    };

    // Only set lastSuccessfulRefreshAt for actual OAuth refreshes
    if (args.isActualRefresh !== false) {
      patch.lastSuccessfulRefreshAt = now;
    }

    await ctx.db.patch(args.keyId, patch);
  },
});

/**
 * Record a refresh failure with backoff tracking.
 */
export const recordRefreshFailure = internalMutation({
  args: {
    keyId: v.id("apiKeys"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.keyId);
    if (!key) return;

    await ctx.db.patch(args.keyId, {
      lastRefreshAttemptAt: Date.now(),
      refreshFailureCount: (key.refreshFailureCount ?? 0) + 1,
      lastRefreshError: args.errorMessage,
    });
  },
});

/**
 * Get the token status for a team+user's Codex token.
 * Used for pre-spawn and orchestration checks.
 */
export const getTokenStatus = internalQuery({
  args: {
    teamId: v.string(),
    userId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<"valid" | "expiring" | "expired" | "missing"> => {
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", args.userId)
      )
      .filter((q) => q.eq(q.field("envVar"), "CODEX_AUTH_JSON"))
      .first();

    if (!key) return "missing";

    const auth = parseCodexAuthJson(key.value);
    if (!auth) return "missing";

    if (isCodexTokenExpired(auth)) return "expired";
    if (isCodexTokenExpiring(auth, 60 * 60 * 1000)) return "expiring"; // 1 hour
    return "valid";
  },
});

/**
 * Check if OPENAI_API_KEY is set for a team+user.
 * Used as fallback when CODEX_AUTH_JSON is missing.
 */
export const hasOpenAIApiKey = internalQuery({
  args: {
    teamId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", args.userId)
      )
      .filter((q) => q.eq(q.field("envVar"), "OPENAI_API_KEY"))
      .first();

    return key !== null && key.value.trim().length > 0;
  },
});
