import * as Sentry from "@sentry/nextjs";
import { stackServerApp } from "@/lib/utils/stack";

/**
 * Sets Sentry user context from Stack Auth user
 * Should be called on server-side requests where user authentication is available
 */
export async function setSentryUserContext(req: Request): Promise<void> {
  try {
    const user = await stackServerApp.getUser({
      tokenStore: req,
      or: "return-null",
    });

    if (user) {
      Sentry.setUser({
        id: user.id,
        email: user.primaryEmail ?? undefined,
      });

      // Set team as a tag if the user has a selected team
      if (user.selectedTeam?.id) {
        Sentry.setTag("teamId", user.selectedTeam.id);
      }
    } else {
      // No user authenticated - clear any previous user context
      Sentry.setUser(null);
    }
  } catch (error) {
    // Don't throw - just log and continue
    console.error("Failed to set Sentry user context:", error);
  }
}

/**
 * Sets Sentry user context from already-fetched Stack Auth user object
 * Useful when you already have the user object and don't need to fetch it again
 */
export function setSentryUserContextFromUser(user: {
  id: string;
  primaryEmail?: string | null;
  selectedTeam?: { id: string } | null;
}): void {
  try {
    Sentry.setUser({
      id: user.id,
      email: user.primaryEmail ?? undefined,
    });

    if (user.selectedTeam?.id) {
      Sentry.setTag("teamId", user.selectedTeam.id);
    }
  } catch (error) {
    console.error("Failed to set Sentry user context:", error);
  }
}
