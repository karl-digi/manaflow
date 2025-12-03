import { v } from "convex/values";
import { mutation } from "./_generated/server";

/**
 * Join the preview waitlist for GitLab or Bitbucket support.
 * This is a public mutation (no auth required).
 */
export const join = mutation({
  args: {
    email: v.string(),
    provider: v.union(v.literal("gitlab"), v.literal("bitbucket")),
  },
  returns: v.object({
    success: v.boolean(),
    alreadyRegistered: v.boolean(),
  }),
  handler: async (ctx, args) => {
    // Check if already registered
    const existing = await ctx.db
      .query("previewWaitlist")
      .withIndex("by_email_provider", (q) =>
        q.eq("email", args.email).eq("provider", args.provider)
      )
      .first();

    if (existing) {
      return { success: true, alreadyRegistered: true };
    }

    // Insert new waitlist entry
    await ctx.db.insert("previewWaitlist", {
      email: args.email,
      provider: args.provider,
      createdAt: Date.now(),
    });

    return { success: true, alreadyRegistered: false };
  },
});
