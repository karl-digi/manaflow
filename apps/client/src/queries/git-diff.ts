import { waitForConnectedSocket } from "@/contexts/socket/socket-boot";
import { isElectron } from "@/lib/electron";
import { normalizeGitRef } from "@/lib/refWithOrigin";
import { WWW_ORIGIN } from "@/lib/wwwOrigin";
import { cachedGetUser } from "@/lib/cachedGetUser";
import { stackClientApp } from "@/lib/stack";
import type { ReplaceDiffEntry } from "@cmux/shared";
import { queryOptions } from "@tanstack/react-query";

export interface GitDiffQuery {
  repoFullName?: string;
  repoUrl?: string;
  originPathOverride?: string;
  headRef: string;
  baseRef?: string;
  includeContents?: boolean;
  maxBytes?: number;
  lastKnownBaseSha?: string;
  lastKnownMergeCommitSha?: string;
  /** Required for web mode HTTP fallback */
  teamSlugOrId?: string;
}

/**
 * Fetch diffs via HTTP API (for web mode when socket is not available)
 */
async function fetchDiffsViaHttp({
  repoFullName,
  headRef,
  baseRef,
  teamSlugOrId,
  includeContents = true,
  maxBytes,
}: {
  repoFullName: string;
  headRef: string;
  baseRef: string;
  teamSlugOrId: string;
  includeContents?: boolean;
  maxBytes?: number;
}): Promise<ReplaceDiffEntry[]> {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repoFullName: ${repoFullName}`);
  }

  const user = await cachedGetUser(stackClientApp);
  if (!user) {
    throw new Error("User not authenticated");
  }

  const authHeaders = await user.getAuthHeaders();

  const url = new URL("/api/integrations/github/compare", WWW_ORIGIN);
  url.searchParams.set("team", teamSlugOrId);
  url.searchParams.set("owner", owner);
  url.searchParams.set("repo", repo);
  url.searchParams.set("base", baseRef);
  url.searchParams.set("head", headRef);
  url.searchParams.set("includeContents", String(includeContents));
  if (maxBytes) {
    url.searchParams.set("maxFileBytes", String(maxBytes));
  }

  const response = await fetch(url.toString(), {
    headers: authHeaders,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch diffs: ${response.status} ${text}`);
  }

  const data = await response.json();

  // Convert the HTTP response format to ReplaceDiffEntry[]
  return (data.diffs ?? []).map((d: {
    filePath: string;
    oldPath?: string;
    status: string;
    additions: number;
    deletions: number;
    isBinary: boolean;
    patch?: string;
    oldContent?: string;
    newContent?: string;
  }) => ({
    filePath: d.filePath,
    oldPath: d.oldPath,
    status: d.status,
    additions: d.additions,
    deletions: d.deletions,
    isBinary: d.isBinary,
    patch: d.patch,
    oldContent: d.oldContent,
    newContent: d.newContent,
  }));
}

/**
 * Fetch diffs via socket (for Electron mode)
 */
async function fetchDiffsViaSocket({
  repoFullName,
  repoUrl,
  originPathOverride,
  headRef,
  baseRef,
  includeContents,
  maxBytes,
  lastKnownBaseSha,
  lastKnownMergeCommitSha,
}: {
  repoFullName?: string;
  repoUrl?: string;
  originPathOverride?: string;
  headRef: string;
  baseRef?: string;
  includeContents?: boolean;
  maxBytes?: number;
  lastKnownBaseSha?: string;
  lastKnownMergeCommitSha?: string;
}): Promise<ReplaceDiffEntry[]> {
  const socket = await waitForConnectedSocket();
  return await new Promise<ReplaceDiffEntry[]>((resolve, reject) => {
    socket.emit(
      "git-diff",
      {
        repoFullName,
        repoUrl,
        originPathOverride,
        headRef,
        baseRef: baseRef || undefined,
        includeContents,
        maxBytes,
        lastKnownBaseSha,
        lastKnownMergeCommitSha,
      },
      (
        resp:
          | { ok: true; diffs: ReplaceDiffEntry[] }
          | { ok: false; error: string; diffs?: [] }
      ) => {
        if (resp.ok) {
          resolve(resp.diffs);
        } else {
          reject(new Error(resp.error || "Failed to load repository diffs"));
        }
      }
    );
  });
}

export function gitDiffQueryOptions({
  repoFullName,
  repoUrl,
  originPathOverride,
  headRef,
  baseRef,
  includeContents = true,
  maxBytes,
  lastKnownBaseSha,
  lastKnownMergeCommitSha,
  teamSlugOrId,
}: GitDiffQuery) {
  const repoKey = repoFullName ?? repoUrl ?? originPathOverride ?? "";

  const canonicalHeadRef = normalizeGitRef(headRef) || headRef?.trim() || "";
  const canonicalBaseRef = normalizeGitRef(baseRef) || baseRef?.trim() || "";

  return queryOptions({
    queryKey: [
      "git-diff",
      repoKey,
      canonicalHeadRef,
      canonicalBaseRef,
      includeContents ? "with-contents" : "no-contents",
      maxBytes ?? "",
      lastKnownBaseSha ?? "",
      lastKnownMergeCommitSha ?? "",
    ],
    queryFn: async () => {
      // In web mode (non-Electron), use HTTP API if we have required params
      if (!isElectron && repoFullName && teamSlugOrId && canonicalBaseRef) {
        return fetchDiffsViaHttp({
          repoFullName,
          headRef: canonicalHeadRef,
          baseRef: canonicalBaseRef,
          teamSlugOrId,
          includeContents,
          maxBytes,
        });
      }

      // Otherwise use socket (Electron mode or fallback)
      return fetchDiffsViaSocket({
        repoFullName,
        repoUrl,
        originPathOverride,
        headRef: canonicalHeadRef,
        baseRef: canonicalBaseRef || undefined,
        includeContents,
        maxBytes,
        lastKnownBaseSha,
        lastKnownMergeCommitSha,
      });
    },
    staleTime: 10_000,
    enabled: Boolean(canonicalHeadRef) && Boolean(repoKey.trim()),
  });
}
