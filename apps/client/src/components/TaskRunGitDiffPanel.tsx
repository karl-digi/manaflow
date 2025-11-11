import { useMemo, useState, useCallback } from "react";
import { useQueries } from "@tanstack/react-query";
import { MonacoGitDiffViewer } from "./monaco/monaco-git-diff-viewer";
import { gitDiffQueryOptions } from "@/queries/git-diff";
import { normalizeGitRef } from "@/lib/refWithOrigin";
import type { TaskRunWithChildren } from "@/types/task";
import type { Doc } from "@cmux/convex/dataModel";
import { useSocket } from "@/contexts/socket/use-socket";
import { FolderOpen } from "lucide-react";
import { toast } from "sonner";
import type { CreateLocalWorkspaceResponse } from "@cmux/shared";

export interface TaskRunGitDiffPanelProps {
  task: Doc<"tasks"> | null | undefined;
  selectedRun: TaskRunWithChildren | null | undefined;
  teamSlugOrId: string;
}

export function TaskRunGitDiffPanel({ task, selectedRun, teamSlugOrId }: TaskRunGitDiffPanelProps) {
  const { socket } = useSocket();
  const [isOpeningWorkspace, setIsOpeningWorkspace] = useState(false);

  const normalizedBaseBranch = useMemo(() => {
    const candidate = task?.baseBranch;
    if (candidate && candidate.trim()) {
      return normalizeGitRef(candidate);
    }
    return normalizeGitRef("main");
  }, [task?.baseBranch]);

  const normalizedHeadBranch = useMemo(
    () => normalizeGitRef(selectedRun?.newBranch),
    [selectedRun?.newBranch],
  );

  const environmentRepos = useMemo<string[]>(() => {
    const repos = selectedRun?.environment?.selectedRepos ?? [];
    const trimmed = repos
      .map((repo: string | undefined) => repo?.trim())
      .filter((repo): repo is string => Boolean(repo));
    return Array.from(new Set(trimmed));
  }, [selectedRun]);

  const repoFullNames = useMemo(() => {
    const names = new Set<string>();
    if (task?.projectFullName?.trim()) {
      names.add(task.projectFullName.trim());
    }
    for (const repo of environmentRepos) {
      names.add(repo);
    }
    return Array.from(names);
  }, [task?.projectFullName, environmentRepos]);

  const diffQueries = useQueries({
    queries: repoFullNames.map((repoFullName) => ({
      ...gitDiffQueryOptions({
        repoFullName,
        baseRef: normalizedBaseBranch || undefined,
        headRef: normalizedHeadBranch ?? "",
      }),
      enabled:
        Boolean(repoFullName?.trim()) && Boolean(normalizedHeadBranch?.trim()),
    })),
  });

  const allDiffs = useMemo(() => {
    return diffQueries.flatMap((query) => query.data ?? []);
  }, [diffQueries]);

  const isLoading = diffQueries.some((query) => query.isLoading);
  const hasError = diffQueries.some((query) => query.isError);

  const handleOpenLocalWorkspace = useCallback(async () => {
    if (!socket || !task?.projectFullName || !normalizedHeadBranch) {
      toast.error("Cannot open workspace", {
        description: "Missing required information",
      });
      return;
    }

    setIsOpeningWorkspace(true);

    try {
      await new Promise<void>((resolve, reject) => {
        socket.emit(
          "create-local-workspace",
          {
            teamSlugOrId,
            projectFullName: task.projectFullName,
            branch: normalizedHeadBranch,
            taskId: task._id,
            taskRunId: selectedRun?._id,
          },
          (response: CreateLocalWorkspaceResponse) => {
            if (response.success) {
              toast.success("Local workspace opened", {
                description: response.workspacePath
                  ? `Workspace at ${response.workspacePath}`
                  : "Workspace opened successfully",
              });
              resolve();
            } else {
              toast.error("Failed to open workspace", {
                description: response.error || "Unknown error",
              });
              reject(new Error(response.error || "Unknown error"));
            }
          }
        );
      });
    } catch (error) {
      console.error("Error opening local workspace:", error);
    } finally {
      setIsOpeningWorkspace(false);
    }
  }, [socket, task, normalizedHeadBranch, teamSlugOrId, selectedRun]);

  if (!selectedRun || !normalizedHeadBranch) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Select a run to view git diffs
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Loading diffs...
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        Failed to load diffs
      </div>
    );
  }

  if (allDiffs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
        No changes found
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 flex flex-col">
      <div className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 flex items-center justify-end">
        <button
          type="button"
          onClick={handleOpenLocalWorkspace}
          disabled={!task?.projectFullName || !normalizedHeadBranch || isOpeningWorkspace}
          className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-200 bg-white dark:bg-neutral-950 hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          aria-label="Open local workspace"
        >
          <FolderOpen className="h-4 w-4" />
          {isOpeningWorkspace ? "Opening..." : "Open Local Workspace"}
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <MonacoGitDiffViewer diffs={allDiffs} />
      </div>
    </div>
  );
}
