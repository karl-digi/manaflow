"use node";

// NOTE: This action requires the Node.js runtime directive because it imports the Stack
// server app, which has dependencies that are not compatible with Convex v8 environments.
// Once Stack Auth adds v8 environment support, the "use node" directive can be removed.

import { v } from "convex/values";
import { stackServerAppJs } from "../_shared/stackServerAppJs";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

export const syncTeamMembershipsFromStack = internalAction({
  args: { teamId: v.string() },
  handler: async (ctx, { teamId }) => {
    try {
      const team = await stackServerAppJs.getTeam(teamId);
      if (!team) {
        console.warn(
          "[stack_webhook] Team not found in Stack during membership sync",
          {
            teamId,
          },
        );
        return;
      }

      const members = await team.listUsers();
      // Use Promise.allSettled to ensure all members are processed even if some fail
      const results = await Promise.allSettled(
        members.map((member) =>
          ctx.runMutation(internal.stack.ensureMembership, {
            teamId,
            userId: member.id,
          }),
        ),
      );

      // Log any failures but don't throw - partial success is better than none
      const failures = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected"
      );
      if (failures.length > 0) {
        console.error(
          "[stack_webhook] Some membership syncs failed",
          {
            teamId,
            totalMembers: members.length,
            failureCount: failures.length,
            errors: failures.map((f) => f.reason),
          },
        );
      }
    } catch (error) {
      console.error("[stack_webhook] Failed to sync team memberships", {
        teamId,
        error,
      });
    }
  },
});
