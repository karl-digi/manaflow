import { useUser } from "@stackframe/react";
import * as Sentry from "@sentry/react";
import { useEffect } from "react";

/**
 * Component that syncs Stack Auth user state to Sentry user context
 * Must be rendered inside StackProvider
 */
export function SentryUserContext() {
  const user = useUser({ or: "return-null" });

  useEffect(() => {
    if (user) {
      // Set user context in Sentry
      Sentry.setUser({
        id: user.id,
        email: user.primaryEmail ?? undefined,
      });

      // Set team as a tag if available
      if (user.selectedTeam?.id) {
        Sentry.setTag("teamId", user.selectedTeam.id);
      } else {
        // Clear team tag if no team selected
        Sentry.setTag("teamId", undefined);
      }
    } else {
      // User logged out - clear Sentry context
      Sentry.setUser(null);
      Sentry.setTag("teamId", undefined);
    }
  }, [user, user?.id, user?.primaryEmail, user?.selectedTeam?.id]);

  // This component doesn't render anything
  return null;
}
