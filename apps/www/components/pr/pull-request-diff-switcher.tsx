
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { PullRequestDiffViewer } from "@/components/pr/pull-request-diff-viewer";
import type { GithubPullRequestFile } from "@/lib/github/fetch-pull-request";
import { MonacoGitDiffViewer } from "@cmux/shared/components/diff-viewer";
import type { ReplaceDiffEntry } from "@cmux/shared/diff-types";

export type DiffViewMode = "heatmap" | "monaco";

type PullRequestDiffSwitcherProps = {
  files: GithubPullRequestFile[];
  fileCount: number;
  additions: number;
  deletions: number;
  teamSlugOrId: string;
  repoFullName: string;
  pullNumber: number;
  commitRef?: string;
};

type UseMonacoDiffEntriesResult = {
  status: "idle" | "loading" | "success" | "error";
  diffs: ReplaceDiffEntry[];
  error: Error | null;
  isFetching: boolean;
  refetch: () => void;
};

type UseMonacoDiffEntriesArgs = {
  teamSlugOrId: string;
  repoFullName: string;
  pullNumber: number;
  commitRef?: string;
};

type GithubPrsCodeResponse = {
  files: GithubPrsCodeFileEntry[];
};

type GithubPrsCodeFileEntry = {
  filename: string;
  status: string;
  previous_filename?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
  contents?: GithubFileContent | null;
  baseContents?: GithubFileContent | null;
  truncated?: boolean;
  truncatedBase?: boolean;
  size?: number;
  sizeBase?: number;
};

type GithubFileContent = {
  encoding: string;
  content: string;
};

export function PullRequestDiffSwitcher({
  files,
  fileCount,
  additions,
  deletions,
  teamSlugOrId,
  repoFullName,
  pullNumber,
  commitRef,
}: PullRequestDiffSwitcherProps) {
  const [viewMode, setViewMode] = useState<DiffViewMode>("heatmap");

  const monaco = useMonacoDiffEntries({
    teamSlugOrId,
    repoFullName,
    pullNumber,
    commitRef,
  });

  const handleViewModeChange = useCallback(
    (mode: DiffViewMode) => {
      setViewMode(mode);
      if (mode === "monaco" && !monaco.isFetching && monaco.status !== "success") {
        monaco.refetch();
      }
    },
    [monaco],
  );

  useEffect(() => {
    if (viewMode === "monaco" && monaco.status === "idle" && !monaco.isFetching) {
      monaco.refetch();
    }
  }, [viewMode, monaco]);

  return (
    <section className="flex flex-col gap-4">
      <PullRequestDiffSummary
        fileCount={fileCount}
        additions={additions}
        deletions={deletions}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        isMonacoLoading={
          viewMode === "monaco" &&
          (monaco.status === "loading" || monaco.isFetching) &&
          monaco.diffs.length === 0
        }
      />
      {viewMode === "monaco" ? (
        <PullRequestMonacoDiffViewer state={monaco} onRetry={monaco.refetch} />
      ) : (
        <PullRequestDiffViewer
          files={files}
          teamSlugOrId={teamSlugOrId}
          repoFullName={repoFullName}
          prNumber={pullNumber}
          commitRef={commitRef}
        />
      )}
    </section>
  );
}

function PullRequestDiffSummary({
  fileCount,
  additions,
  deletions,
  viewMode,
  onViewModeChange,
  isMonacoLoading,
}: {
  fileCount: number;
  additions: number;
  deletions: number;
  viewMode: DiffViewMode;
  onViewModeChange: (mode: DiffViewMode) => void;
  isMonacoLoading: boolean;
}) {
  const heatmapActive = viewMode === "heatmap";
  const monacoActive = viewMode === "monaco";

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-neutral-900">Files changed</h2>
        <p className="text-sm text-neutral-600">
          {fileCount} file{fileCount === 1 ? "" : "s"}, {additions} additions, {deletions} deletions
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={heatmapActive ? "default" : "outline"}
          onClick={() => onViewModeChange("heatmap")}
        >
          Heatmap view
        </Button>
        <Button
          size="sm"
          variant={monacoActive ? "default" : "outline"}
          onClick={() => onViewModeChange("monaco")}
          disabled={isMonacoLoading && monacoActive}
        >
          {isMonacoLoading && monacoActive ? "Loading…" : "Monaco view"}
        </Button>
      </div>
    </header>
  );
}

function PullRequestMonacoDiffViewer({
  state,
  onRetry,
}: {
  state: UseMonacoDiffEntriesResult;
  onRetry: () => void;
}) {
  if (
    state.status === "idle" ||
    (state.status === "loading" && state.diffs.length === 0)
  ) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-600 shadow-sm">
        Loading Monaco diff…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="space-y-3 text-sm text-neutral-600">
          <p className="font-medium text-neutral-800">
            Unable to load Monaco diff view.
          </p>
          <p>{state.error?.message ?? "An unknown error occurred."}</p>
          <div>
            <Button size="sm" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (state.diffs.length === 0) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-600 shadow-sm">
        No file changes available for Monaco view.
      </div>
    );
  }

  const showRefreshingBanner = state.status === "loading" && state.diffs.length > 0;

  return (
    <div className="space-y-3">
      {showRefreshingBanner ? (
        <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-2 text-xs text-neutral-500 shadow-sm">
          Refreshing Monaco diff…
        </div>
      ) : null}
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        <MonacoGitDiffViewer diffs={state.diffs} theme="light" />
      </div>
    </div>
  );
}

function useMonacoDiffEntries({
  teamSlugOrId,
  repoFullName,
  pullNumber,
  commitRef,
}: UseMonacoDiffEntriesArgs): UseMonacoDiffEntriesResult {
  const requestKey = useMemo(
    () => `${teamSlugOrId}:${repoFullName}:${pullNumber}:${commitRef ?? ''}`,
    [teamSlugOrId, repoFullName, pullNumber, commitRef],
  );

  const [state, setState] = useState({
    status: "idle" as UseMonacoDiffEntriesResult["status"],
    diffs: [] as ReplaceDiffEntry[],
    error: null as Error | null,
    key: requestKey,
  });
  const [isFetching, setIsFetching] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setState((previous) =>
      previous.key === requestKey
        ? previous
        : { status: "idle", diffs: [], error: null, key: requestKey },
    );
  }, [requestKey]);

  const fetchDiffs = useCallback(
    async (signal?: AbortSignal) => {
      const parsed = parseRepoFullName(repoFullName);
      if (!parsed) {
        throw new Error("Invalid repository name");
      }
      const params = new URLSearchParams({
        team: teamSlugOrId,
        owner: parsed.owner,
        repo: parsed.repo,
        number: String(pullNumber),
        includeContents: "true",
      });
      const response = await fetch(
        `/api/integrations/github/prs/code?${params.toString()}`,
        {
          credentials: "include",
          signal,
        },
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to load Monaco diff data");
      }
      const payload = (await response.json()) as GithubPrsCodeResponse;
      return transformGithubFiles(payload.files);
    },
    [repoFullName, teamSlugOrId, pullNumber],
  );

  const refetch = useCallback(() => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsFetching(true);
    setState((previous) => ({ ...previous, status: "loading", error: null }));

    fetchDiffs(controller.signal)
      .then((diffs) => {
        setState({ status: "success", diffs, error: null, key: requestKey });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setState((previous) => ({
          status: "error",
          diffs: previous.key === requestKey ? previous.diffs : [],
          error: error instanceof Error
            ? error
            : new Error("Failed to load Monaco diff data"),
          key: requestKey,
        }));
      })
      .finally(() => {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        setIsFetching(false);
      });
  }, [fetchDiffs, requestKey]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return {
    status: state.status,
    diffs: state.diffs,
    error: state.error,
    isFetching,
    refetch,
  };
}

function transformGithubFiles(files: GithubPrsCodeFileEntry[]): ReplaceDiffEntry[] {
  return files.map((file) => {
    const status = normalizeGithubStatus(file.status);
    const baseContent = decodeBase64Content(file.baseContents);
    const headContent = decodeBase64Content(file.contents);

    const baseTruncated = file.truncatedBase === true;
    const headTruncated = file.truncated === true;

    const expectsBase = status !== "added";
    const expectsHead = status !== "deleted" && status !== "renamed";

    const missingBase = expectsBase && baseContent === null;
    const missingHead = expectsHead && headContent === null;

    const contentOmitted =
      status === "renamed"
        ? false
        : baseTruncated || headTruncated || missingBase || missingHead;

    const isBinary =
      status === "modified" &&
      !file.patch &&
      baseContent === null &&
      headContent === null;

    return {
      filePath: file.filename,
      oldPath: file.previous_filename ?? undefined,
      status,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      patch: file.patch ?? undefined,
      oldContent: baseContent ?? "",
      newContent: headContent ?? "",
      isBinary,
      contentOmitted,
      oldSize: file.sizeBase,
      newSize: file.size,
    };
  });
}

function decodeBase64Content(content?: GithubFileContent | null): string | null {
  if (!content || content.encoding !== "base64" || typeof content.content !== "string") {
    return null;
  }

  try {
    if (typeof window === "undefined") {
      return Buffer.from(content.content, "base64").toString("utf-8");
    }
    const binary = window.atob(content.content);
    const length = binary.length;
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function normalizeGithubStatus(status: string): ReplaceDiffEntry["status"] {
  switch (status) {
    case "added":
      return "added";
    case "removed":
    case "deleted":
      return "deleted";
    case "renamed":
      return "renamed";
    default:
      return "modified";
  }
}

function parseRepoFullName(fullName: string): { owner: string; repo: string } | null {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) {
    return null;
  }
  return { owner, repo };
}
