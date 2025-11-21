import * as Sentry from "@sentry/node";
import { decodeJwt } from "jose";

// Initialize Sentry for the server
export function initSentry() {
  Sentry.init({
    dsn: "https://96214f39aa409867381a22a79ff3e6a4@o4507547940749312.ingest.us.sentry.io/4510308518854656",

    // Adjust sample rate based on environment
    tracesSampleRate: 1.0,

    // Enable performance monitoring
    integrations: [
      Sentry.httpIntegration(),
      Sentry.expressIntegration(),
    ],
  });
}

/**
 * Extracts user and team information from Stack Auth JWT token
 * and sets it in Sentry context
 */
export function setSentryContextFromAuthToken(authToken: string | null | undefined): void {
  if (!authToken) {
    Sentry.setUser(null);
    Sentry.setTag("teamId", undefined);
    return;
  }

  try {
    const decoded = decodeJwt(authToken);

    if (decoded) {
      // Set user information from JWT claims
      const userId = decoded.sub;
      const email = decoded.email as string | undefined;

      if (userId) {
        Sentry.setUser({
          id: userId,
          email: email ?? undefined,
        });
      }

      // Check for team information in JWT claims
      // Stack Auth may include team info in different claim formats
      const teamId = (decoded.team_id || decoded.selected_team_id) as string | undefined;
      if (teamId) {
        Sentry.setTag("teamId", teamId);
      }
    }
  } catch (error) {
    // Don't block execution if we can't parse the token
    console.error("Failed to extract user context from auth token:", error);
  }
}

/**
 * Extracts user and team information from Stack Auth JSON header
 * and sets it in Sentry context
 */
export function setSentryContextFromAuthJson(authJson: string | null | undefined): void {
  if (!authJson) {
    Sentry.setUser(null);
    Sentry.setTag("teamId", undefined);
    return;
  }

  try {
    const parsed = JSON.parse(authJson);

    if (parsed) {
      // Extract user information
      const userId = parsed.user_id || parsed.userId;
      const email = parsed.email || parsed.primaryEmail;

      if (userId) {
        Sentry.setUser({
          id: userId,
          email: email ?? undefined,
        });
      }

      // Extract team information
      const teamId = parsed.team_id || parsed.teamId || parsed.selected_team_id || parsed.selectedTeamId;
      if (teamId) {
        Sentry.setTag("teamId", teamId);
      }
    }
  } catch (error) {
    // Don't block execution if we can't parse the JSON
    console.error("Failed to extract user context from auth JSON:", error);
  }
}

export { Sentry };
