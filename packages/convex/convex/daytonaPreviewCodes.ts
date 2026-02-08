/**
 * Daytona preview codes - secure preview URL management.
 * These codes allow users to access preview URLs without exposing the Daytona token.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Get a preview code by its code string
 */
export const getByCode = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const record = await ctx.db
      .query("daytonaPreviewCodes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();

    if (!record) {
      return null;
    }

    return {
      targetUrl: record.targetUrl,
      token: record.token,
      port: record.port,
      daytonaId: record.daytonaId,
    };
  },
});

/**
 * Get or create a preview code for a sandbox/port combination.
 * Reuses existing codes to avoid creating duplicates.
 */
export const getOrCreate = internalMutation({
  args: {
    daytonaId: v.string(),
    targetUrl: v.string(),
    token: v.string(),
    port: v.number(),
    userId: v.string(),
  },
  handler: async (ctx, { daytonaId, targetUrl, token, port, userId }) => {
    // Check for existing code for this sandbox/port
    const existing = await ctx.db
      .query("daytonaPreviewCodes")
      .withIndex("by_daytonaId_port", (q) =>
        q.eq("daytonaId", daytonaId).eq("port", port)
      )
      .first();

    if (existing) {
      // Update the token if it changed (tokens can refresh)
      if (existing.token !== token || existing.targetUrl !== targetUrl) {
        await ctx.db.patch(existing._id, {
          token,
          targetUrl,
        });
      }
      return existing.code;
    }

    // Generate a new short code (12 chars, URL-safe)
    const code = generateCode();

    await ctx.db.insert("daytonaPreviewCodes", {
      code,
      daytonaId,
      targetUrl,
      token,
      port,
      userId,
      createdAt: Date.now(),
    });

    return code;
  },
});

/**
 * Generate a URL-safe random code
 */
function generateCode(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 12; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
