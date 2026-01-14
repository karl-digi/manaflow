/**
 * Handles the GitHub OAuth + App installation flow.
 *
 * Problem: When a user clicks "Add repos from GitHub", we need to:
 * 1. Ensure GitHub OAuth is connected (for private repo access)
 * 2. Then open the GitHub App installation popup
 *
 * But OAuth requires a full page redirect, breaking the flow.
 *
 * Solution: Store the pending action in sessionStorage before OAuth redirect,
 * then check for it after returning and continue the flow.
 */

const PENDING_ACTION_KEY = "cmux_pending_github_action";

export interface PendingGitHubAction {
  action: "install-github-app";
  teamSlugOrId: string;
  timestamp: number;
}

/**
 * Store the intent to install GitHub App after OAuth completes.
 */
export function setPendingGitHubAction(teamSlugOrId: string): void {
  try {
    const pending: PendingGitHubAction = {
      action: "install-github-app",
      teamSlugOrId,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(PENDING_ACTION_KEY, JSON.stringify(pending));
    console.log("[GitHubOAuthFlow] Stored pending action:", pending);
  } catch (err) {
    console.error("[GitHubOAuthFlow] Failed to store pending action:", err);
  }
}

/**
 * Get and clear any pending GitHub action.
 * Returns null if no action or if action is stale (> 5 minutes old).
 */
export function consumePendingGitHubAction(): PendingGitHubAction | null {
  try {
    const raw = sessionStorage.getItem(PENDING_ACTION_KEY);
    console.log("[GitHubOAuthFlow] Consuming pending action, raw:", raw);
    if (!raw) return null;

    sessionStorage.removeItem(PENDING_ACTION_KEY);

    const pending = JSON.parse(raw) as PendingGitHubAction;

    // Ignore stale actions (> 5 minutes old)
    const MAX_AGE_MS = 5 * 60 * 1000;
    if (Date.now() - pending.timestamp > MAX_AGE_MS) {
      console.log("[GitHubOAuthFlow] Pending action too old, ignoring");
      return null;
    }

    console.log("[GitHubOAuthFlow] Returning pending action:", pending);
    return pending;
  } catch (err) {
    console.error("[GitHubOAuthFlow] Failed to consume pending action:", err);
    return null;
  }
}

/**
 * Check if there's a pending action without consuming it.
 */
export function hasPendingGitHubAction(): boolean {
  try {
    return sessionStorage.getItem(PENDING_ACTION_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Peek at the pending action without consuming it.
 * Returns null if no action or if action is stale (> 5 minutes old).
 * Use this to check if the action matches before consuming.
 */
export function getPendingGitHubAction(): PendingGitHubAction | null {
  try {
    const raw = sessionStorage.getItem(PENDING_ACTION_KEY);
    if (!raw) return null;

    const pending = JSON.parse(raw) as PendingGitHubAction;

    // Ignore stale actions (> 5 minutes old)
    const MAX_AGE_MS = 5 * 60 * 1000;
    if (Date.now() - pending.timestamp > MAX_AGE_MS) {
      // Clean up stale action
      sessionStorage.removeItem(PENDING_ACTION_KEY);
      return null;
    }

    return pending;
  } catch {
    return null;
  }
}

/**
 * Clear the pending action (use after successfully handling it).
 */
export function clearPendingGitHubAction(): void {
  try {
    sessionStorage.removeItem(PENDING_ACTION_KEY);
  } catch {
    // Ignore errors
  }
}
