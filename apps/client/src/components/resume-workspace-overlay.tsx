import { useCallback } from "react";
import clsx from "clsx";
import { Button } from "@/components/ui/button";
import type { Doc } from "@cmux/convex/dataModel";
import {
  useMorphInstancePauseQuery,
  useResumeMorphWorkspace,
} from "@/hooks/useMorphWorkspace";
import {
  usePveLxcInstanceStoppedQuery,
  useResumePveLxcWorkspace,
} from "@/hooks/usePveLxcWorkspace";
import { AlertTriangle } from "lucide-react";

interface ResumeWorkspaceOverlayProps {
  taskRun: Doc<"taskRuns">;
  teamSlugOrId: string;
  className?: string;
  onResumed?: () => void;
}

export function ResumeWorkspaceOverlay({
  taskRun,
  teamSlugOrId,
  className,
  onResumed,
}: ResumeWorkspaceOverlayProps) {
  const taskRunId = taskRun._id;
  const provider = taskRun.vscode?.provider;
  const isMorphProvider = provider === "morph";
  const isPveLxcProvider = provider === "pve-lxc";

  // Morph-specific hooks (only enabled for morph provider)
  const morphPauseQuery = useMorphInstancePauseQuery({
    taskRunId,
    teamSlugOrId,
    enabled: isMorphProvider,
  });

  const resumeMorphWorkspace = useResumeMorphWorkspace({
    taskRunId,
    teamSlugOrId,
    onSuccess: onResumed,
  });

  // PVE LXC-specific hooks (only enabled for pve-lxc provider)
  const pveLxcStoppedQuery = usePveLxcInstanceStoppedQuery({
    taskRunId,
    teamSlugOrId,
    enabled: isPveLxcProvider,
  });

  const resumePveLxcWorkspace = useResumePveLxcWorkspace({
    taskRunId,
    teamSlugOrId,
    onSuccess: onResumed,
  });

  // Unified state based on provider
  const isPaused = isMorphProvider
    ? morphPauseQuery.data?.paused === true
    : isPveLxcProvider
      ? pveLxcStoppedQuery.data?.stopped === true
      : false;

  const isDeleted = isMorphProvider
    ? morphPauseQuery.data?.stopped === true
    : isPveLxcProvider
      ? pveLxcStoppedQuery.data?.deleted === true
      : false;

  const isResuming = isMorphProvider
    ? resumeMorphWorkspace.isPending
    : isPveLxcProvider
      ? resumePveLxcWorkspace.isPending
      : false;

  const handleResume = useCallback(async () => {
    if (!taskRun || !isPaused || isDeleted) {
      return;
    }

    if (isMorphProvider) {
      await resumeMorphWorkspace.mutateAsync({
        path: { taskRunId },
        body: { teamSlugOrId },
      });
    } else if (isPveLxcProvider) {
      await resumePveLxcWorkspace.mutateAsync({
        path: { taskRunId },
        body: { teamSlugOrId },
      });
    }
  }, [
    isMorphProvider,
    isPveLxcProvider,
    resumeMorphWorkspace,
    resumePveLxcWorkspace,
    isPaused,
    isDeleted,
    taskRun,
    taskRunId,
    teamSlugOrId,
  ]);

  if (!isPaused) {
    return null;
  }

  // Show different UI for permanently stopped/deleted instances
  if (isDeleted) {
    return (
      <div
        className={clsx(
          "absolute inset-0 flex items-center justify-center bg-neutral-50/90 backdrop-blur-sm dark:bg-black/80",
          className
        )}
      >
        <div className="rounded-lg border border-neutral-200/80 bg-white/90 p-4 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900/80 max-w-sm">
          <div className="flex justify-center mb-2">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
          </div>
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
            Workspace expired
          </p>
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
            This workspace was automatically cleaned up after being inactive for
            2 weeks. Your code changes are preserved in any commits or pull
            requests you created.
          </p>
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-500">
            To continue working, create a new task with the same repository.
          </p>
        </div>
      </div>
    );
  }

  // Provider-specific labels
  const pausedLabel = isPveLxcProvider ? "Container stopped" : "Workspace paused";
  const resumeHint = isPveLxcProvider
    ? "Start your container to reconnect VS Code."
    : "Resume your VM to reconnect VS Code.";
  const buttonLabel = isPveLxcProvider ? "Start Container" : "Resume VM";
  const pendingLabel = isPveLxcProvider ? "Starting..." : "Resuming...";

  return (
    <div
      className={clsx(
        "absolute inset-0 flex items-center justify-center bg-neutral-50/90 backdrop-blur-sm dark:bg-black/80",
        className
      )}
    >
      <div className="rounded-lg border border-neutral-200/80 bg-white/90 p-4 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900/80">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
          {pausedLabel}
        </p>
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          {resumeHint}
        </p>
        <Button
          className="mt-3"
          onClick={handleResume}
          disabled={isResuming}
          variant="default"
        >
          {isResuming ? pendingLabel : buttonLabel}
        </Button>
      </div>
    </div>
  );
}
