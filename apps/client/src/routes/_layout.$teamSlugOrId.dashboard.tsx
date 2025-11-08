import { TaskComposerCard } from "@/components/dashboard/TaskComposerCard";
import { TaskList } from "@/components/dashboard/TaskList";
import { useTaskComposer } from "@/components/dashboard/useTaskComposer";
import { WorkspaceCreationButtons } from "@/components/dashboard/WorkspaceCreationButtons";
import { FloatingPane } from "@/components/floating-pane";
import { TitleBar } from "@/components/TitleBar";
import { clearEnvironmentDraft } from "@/state/environment-draft-store";
import type { MorphSnapshotId } from "@cmux/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Info } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/_layout/$teamSlugOrId/dashboard")({
  component: DashboardComponent,
});

type EnvironmentNewSearchParams = {
  step: "select" | "configure" | undefined;
  selectedRepos: string[] | undefined;
  instanceId: string | undefined;
  connectionLogin: string | undefined;
  repoSearch: string | undefined;
  snapshotId: MorphSnapshotId | undefined;
};

function DashboardComponent() {
  const { teamSlugOrId } = Route.useParams();
  const searchParams = Route.useSearch() as { environmentId?: string };

  const {
    editorApiRef,
    taskDescription,
    onTaskDescriptionChange,
    lexicalRepoUrl,
    lexicalEnvironmentId,
    lexicalBranch,
    projectOptions,
    selectedProject,
    onProjectChange,
    onProjectSearchPaste,
    branchOptions,
    selectedBranch,
    onBranchChange,
    selectedAgents,
    onAgentChange,
    isCloudMode,
    onCloudModeToggle,
    isLoadingProjects,
    isLoadingBranches,
    providerStatus,
    canSubmit,
    startTask,
    cloudToggleDisabled,
    branchDisabled,
    selectedRepoFullName,
    selectedRepoInfo,
    isEnvSelected,
  } = useTaskComposer({
    teamSlugOrId,
    initialEnvironmentId: searchParams?.environmentId,
  });

  const [hasDismissedCloudRepoOnboarding, setHasDismissedCloudRepoOnboarding] =
    useState(false);

  useEffect(() => {
    setHasDismissedCloudRepoOnboarding(false);
  }, [selectedRepoFullName]);

  const shouldShowCloudRepoOnboarding = useMemo(
    () =>
      !!selectedRepoFullName &&
      isCloudMode &&
      !isEnvSelected &&
      !hasDismissedCloudRepoOnboarding,
    [
      hasDismissedCloudRepoOnboarding,
      isCloudMode,
      isEnvSelected,
      selectedRepoFullName,
    ]
  );

  const createEnvironmentSearch = useMemo<
    EnvironmentNewSearchParams | undefined
  >(
    () =>
      selectedRepoFullName
        ? {
            step: "select",
            selectedRepos: [selectedRepoFullName],
            instanceId: undefined,
            connectionLogin:
              selectedRepoInfo?.org ?? selectedRepoInfo?.ownerLogin ?? undefined,
            repoSearch: undefined,
            snapshotId: undefined,
          }
        : undefined,
    [selectedRepoFullName, selectedRepoInfo]
  );

  const handleStartEnvironmentSetup = useCallback(() => {
    clearEnvironmentDraft(teamSlugOrId);
  }, [teamSlugOrId]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isEditor =
        activeElement?.getAttribute("data-cmux-input") === "true";
      const isCommentInput = activeElement?.id === "cmux-comments-root";
      if (
        !isEditor &&
        (activeElement?.tagName === "INPUT" ||
          activeElement?.tagName === "TEXTAREA" ||
          activeElement?.getAttribute("contenteditable") === "true" ||
          activeElement?.closest('[contenteditable="true"]') ||
          isCommentInput)
      ) {
        return;
      }

      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.key === "Tab" ||
        e.key === "Escape" ||
        e.key === "Enter" ||
        e.key.startsWith("F") ||
        e.key.startsWith("Arrow") ||
        e.key === "Home" ||
        e.key === "End" ||
        e.key === "PageUp" ||
        e.key === "PageDown" ||
        e.key === "Delete" ||
        e.key === "Backspace" ||
        e.key === "CapsLock" ||
        e.key === "Control" ||
        e.key === "Shift" ||
        e.key === "Alt" ||
        e.key === "Meta" ||
        e.key === "ContextMenu"
      ) {
        return;
      }

      if (e.key.length === 1) {
        e.preventDefault();
        if (editorApiRef.current?.focus) {
          editorApiRef.current.focus();
          if (editorApiRef.current.insertText) {
            editorApiRef.current.insertText(e.key);
          }
        }
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      document.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [editorApiRef]);

  const handleSubmit = useCallback(() => {
    if (selectedProject[0] && taskDescription.trim()) {
      void startTask();
    }
  }, [selectedProject, startTask, taskDescription]);

  return (
    <FloatingPane header={<TitleBar title="cmux" />}>
      <div className="flex flex-col grow overflow-y-auto">
        <div className="flex-1 flex justify-center px-4 pt-60 pb-4">
          <div className="w-full max-w-4xl min-w-0">
            <WorkspaceCreationButtons
              teamSlugOrId={teamSlugOrId}
              selectedProject={selectedProject}
              isEnvSelected={isEnvSelected}
            />

            <TaskComposerCard
              editorApiRef={editorApiRef}
              onTaskDescriptionChange={onTaskDescriptionChange}
              onSubmit={handleSubmit}
              lexicalRepoUrl={lexicalRepoUrl}
              lexicalEnvironmentId={lexicalEnvironmentId}
              lexicalBranch={lexicalBranch}
              projectOptions={projectOptions}
              selectedProject={selectedProject}
              onProjectChange={onProjectChange}
              onProjectSearchPaste={onProjectSearchPaste}
              branchOptions={branchOptions}
              selectedBranch={selectedBranch}
              onBranchChange={onBranchChange}
              selectedAgents={selectedAgents}
              onAgentChange={onAgentChange}
              isCloudMode={isCloudMode}
              onCloudModeToggle={onCloudModeToggle}
              isLoadingProjects={isLoadingProjects}
              isLoadingBranches={isLoadingBranches}
              teamSlugOrId={teamSlugOrId}
              cloudToggleDisabled={cloudToggleDisabled}
              branchDisabled={branchDisabled}
              providerStatus={providerStatus}
              canSubmit={canSubmit}
              onStartTask={() => {
                void startTask();
              }}
            />

            {shouldShowCloudRepoOnboarding && createEnvironmentSearch ? (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-blue-200/60 dark:border-blue-500/40 bg-blue-50/80 dark:bg-blue-500/10 px-3 py-2 text-sm text-blue-900 dark:text-blue-100">
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500 dark:text-blue-300" />
                <div className="flex flex-col gap-1">
                  <p className="font-medium text-blue-900 dark:text-blue-100">
                    Set up an environment for {selectedRepoFullName}
                  </p>
                  <p className="text-xs text-blue-900/80 dark:text-blue-200/80">
                    Environments let you preconfigure development and maintenance scripts, pre-install packages, and environment variables so cloud workspaces are ready to go the moment they start.
                  </p>
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setHasDismissedCloudRepoOnboarding(true)}
                      className="inline-flex items-center rounded-md border border-blue-200/60 bg-white/80 px-2 py-1 text-xs font-medium text-blue-900/70 hover:bg-white dark:border-blue-500/30 dark:bg-blue-500/5 dark:text-blue-100/80 dark:hover:bg-blue-500/15"
                    >
                      Dismiss
                    </button>
                    <Link
                      to="/$teamSlugOrId/environments/new"
                      params={{ teamSlugOrId }}
                      search={createEnvironmentSearch}
                      onClick={handleStartEnvironmentSetup}
                      className="inline-flex items-center rounded-md border border-blue-500/60 bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-900 dark:text-blue-100 hover:bg-blue-500/20"
                    >
                      Create environment
                    </Link>
                  </div>
                </div>
              </div>
            ) : null}

            <TaskList teamSlugOrId={teamSlugOrId} />
          </div>
        </div>
      </div>
    </FloatingPane>
  );
}
