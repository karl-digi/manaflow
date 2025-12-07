import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

/**
 * Stack Auth webhook endpoint
 * Configure this URL in Stack Auth dashboard: https://your-convex-url.convex.site/stack-auth-webhook
 *
 * For production, you should verify the webhook signature using Svix.
 * See: https://docs.svix.com/receiving/verifying-payloads/how
 */
http.route({
  path: "/stack-auth-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { type, data } = body as {
        type: string;
        data: {
          id: string;
          display_name?: string | null;
          primary_email?: string | null;
          primary_email_verified?: boolean;
          profile_image_url?: string | null;
          selected_team?: {
            id: string;
            display_name?: string;
            profile_image_url?: string | null;
          } | null;
          has_password?: boolean;
          signed_up_at_millis?: number;
          last_active_at_millis?: number;
          client_metadata?: unknown;
          client_read_only_metadata?: unknown;
          server_metadata?: unknown;
        };
      };

      if (type === "user.created" || type === "user.updated") {
        await ctx.runMutation(internal.users.upsertFromWebhook, {
          userId: data.id,
          primaryEmail: data.primary_email ?? undefined,
          primaryEmailVerified: data.primary_email_verified,
          displayName: data.display_name ?? undefined,
          profileImageUrl: data.profile_image_url ?? undefined,
          selectedTeamId: data.selected_team?.id,
          selectedTeamDisplayName: data.selected_team?.display_name,
          selectedTeamProfileImageUrl:
            data.selected_team?.profile_image_url ?? undefined,
          hasPassword: data.has_password,
          signedUpAtMillis: data.signed_up_at_millis,
          lastActiveAtMillis: data.last_active_at_millis,
          clientMetadata: data.client_metadata,
          clientReadOnlyMetadata: data.client_read_only_metadata,
          serverMetadata: data.server_metadata,
        });

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (type === "user.deleted") {
        await ctx.runMutation(internal.users.deleteFromWebhook, {
          userId: data.id,
        });

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Unknown event type - acknowledge but don't process
      return new Response(
        JSON.stringify({ success: true, message: "Event type not handled" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      console.error("Stack Auth webhook error:", error);
      return new Response(
        JSON.stringify({ success: false, error: "Internal server error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }),
});

export default http;
