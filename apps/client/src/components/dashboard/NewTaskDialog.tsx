import { TaskComposerCard } from "@/components/dashboard/TaskComposerCard";
import { useTaskComposer } from "@/components/dashboard/useTaskComposer";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useCallback } from "react";

interface NewTaskDialogProps {
  teamSlugOrId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewTaskDialog({
  teamSlugOrId,
  open,
  onOpenChange,
}: NewTaskDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[1000] bg-neutral-900/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-0 z-[1001] flex items-center justify-center p-4">
          {open ? (
            <TaskComposerDialogBody
              teamSlugOrId={teamSlugOrId}
              onClose={() => onOpenChange(false)}
            />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface TaskComposerDialogBodyProps {
  teamSlugOrId: string;
  onClose: () => void;
}

function TaskComposerDialogBody({
  teamSlugOrId,
  onClose,
}: TaskComposerDialogBodyProps) {
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
  } = useTaskComposer({ teamSlugOrId });

  const handleStartTask = useCallback(async () => {
    const started = await startTask();
    if (started) {
      onClose();
    }
  }, [onClose, startTask]);

  const handleSubmit = useCallback(() => {
    if (selectedProject[0] && taskDescription.trim()) {
      void handleStartTask();
    }
  }, [handleStartTask, selectedProject, taskDescription]);

  return (
    <div className="w-full max-w-3xl rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-start justify-between">
        <div>
          <Dialog.Title className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            Start a new task
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Describe the work, pick a repo or environment, and choose the agents that should help.
          </Dialog.Description>
        </div>
        <Dialog.Close asChild>
          <button
            type="button"
            className="rounded-full p-1 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </Dialog.Close>
      </div>

      <div className="mt-6">
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
            void handleStartTask();
          }}
        />
      </div>
    </div>
  );
}
