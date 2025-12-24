import { toProxyWorkspaceUrl } from "./toProxyWorkspaceUrl";

type VSCodeProvider = "docker" | "morph" | "other" | "daytona" | undefined;

/**
 * Get the workspace URL with appropriate serve-web handling based on provider.
 *
 * - For Docker workspaces (provider === "docker"): Uses Docker-forwarded port directly
 * - For local workspaces (provider === "other"): Rewrites to local serve-web
 * - For Morph workspaces (provider === "morph"): Uses Morph URL directly (no rewriting needed)
 *
 * IMPORTANT: For local workspaces, if localServeWebBaseUrl is not yet available,
 * we return null to avoid flashing. The caller should wait for the serve-web
 * URL to be available before rendering the iframe.
 */
export function getWorkspaceUrl(
  rawWorkspaceUrl: string | null | undefined,
  provider: VSCodeProvider,
  localServeWebBaseUrl: string | null | undefined
): string | null {
  if (!rawWorkspaceUrl) {
    return null;
  }

  // Only use local serve-web for truly local workspaces (provider === "other")
  // Docker and Morph workspaces should use their URLs directly
  const shouldUseLocalServeWeb = provider === "other";

  // For local workspaces, wait for serve-web URL to be available
  // This prevents flashing when the URL changes from placeholder to actual
  if (shouldUseLocalServeWeb && !localServeWebBaseUrl) {
    return null;
  }

  const preferredOrigin = shouldUseLocalServeWeb ? localServeWebBaseUrl : null;

  return toProxyWorkspaceUrl(rawWorkspaceUrl, preferredOrigin);
}
