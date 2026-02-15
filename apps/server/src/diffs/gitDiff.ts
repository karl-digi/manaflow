import type { ReplaceDiffEntry } from "@cmux/shared/diff-types";

import { gitDiff as nativeGitDiff } from "../native/git";
import { getGitHubOAuthToken } from "../utils/getGitHubToken";
import { serverLogger } from "../utils/fileLogger";

export interface GitDiffRequest {
  headRef: string;
  baseRef?: string;
  repoFullName?: string;
  repoUrl?: string;
  teamSlugOrId?: string;
  originPathOverride?: string;
  includeContents?: boolean;
  maxBytes?: number;
  lastKnownBaseSha?: string;
  lastKnownMergeCommitSha?: string;
  /**
   * GitHub OAuth token for authenticating private repo access.
   * Used transiently for clone/fetch - never persisted to disk or logged.
   */
  authToken?: string;
  /**
   * When true, bypasses SWR fetch window and forces fresh git fetch.
   */
  forceRefresh?: boolean;
}

export async function getGitDiff(
  request: GitDiffRequest
): Promise<ReplaceDiffEntry[]> {
  const headRef = request.headRef.trim();
  if (!headRef) {
    return [];
  }

  const baseRef = request.baseRef?.trim();

  // Determine the authToken to use for private repo access
  // Pass it to the native module which handles authentication without embedding in URLs
  let effectiveAuthToken = request.authToken;

  // If we have repoFullName but no originPathOverride and no explicit authToken,
  // try to fetch GitHub OAuth credentials for private repo access.
  if (
    request.repoFullName &&
    !request.originPathOverride &&
    !effectiveAuthToken
  ) {
    try {
      effectiveAuthToken = (await getGitHubOAuthToken()) ?? undefined;
    } catch (error) {
      // Non-fatal: if token fetch fails, fall back to unauthenticated access
      // This will work for public repos
      serverLogger.warn(
        `[getGitDiff] Failed to get GitHub OAuth token for ${request.repoFullName}: ${String(error)}`
      );
    }
  }

  return await nativeGitDiff({
    headRef,
    baseRef: baseRef ? baseRef : undefined,
    repoFullName: request.repoFullName,
    repoUrl: request.repoUrl,
    teamSlugOrId: request.teamSlugOrId,
    originPathOverride: request.originPathOverride,
    includeContents: request.includeContents,
    maxBytes: request.maxBytes,
    lastKnownBaseSha: request.lastKnownBaseSha,
    lastKnownMergeCommitSha: request.lastKnownMergeCommitSha,
    authToken: effectiveAuthToken,
    forceRefresh: request.forceRefresh,
  });
}
