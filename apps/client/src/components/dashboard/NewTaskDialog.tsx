import {
  DashboardInput,
  type EditorApi,
} from "@/components/dashboard/DashboardInput";
import { DashboardInputControls } from "@/components/dashboard/DashboardInputControls";
import { DashboardInputFooter } from "@/components/dashboard/DashboardInputFooter";
import { DashboardStartTaskButton } from "@/components/dashboard/DashboardStartTaskButton";
import { CommandDialog } from "@/components/ui/command";
import type { SelectOption } from "@/components/ui/searchable-select";
import type { Id } from "@cmux/convex/dataModel";
import type { ProviderStatusResponse } from "@cmux/shared";
import { useCallback, type RefObject } from "react";

interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editorApiRef: RefObject<EditorApi | null>;
  onTaskDescriptionChange: (value: string) => void;
  onSubmit: () => void;
  lexicalRepoUrl?: string;
  lexicalEnvironmentId?: Id<"environments">;
  lexicalBranch?: string;
  projectOptions: SelectOption[];
  selectedProject: string[];
  onProjectChange: (newProjects: string[]) => void;
  onProjectSearchPaste?: (value: string) => boolean | Promise<boolean>;
  branchOptions: string[];
  selectedBranch: string[];
  onBranchChange: (newBranches: string[]) => void;
  selectedAgents: string[];
  onAgentChange: (newAgents: string[]) => void;
  isCloudMode: boolean;
  onCloudModeToggle: () => void;
  isLoadingProjects: boolean;
  isLoadingBranches: boolean;
  teamSlugOrId: string;
  cloudToggleDisabled: boolean;
  branchDisabled: boolean;
  providerStatus: ProviderStatusResponse | null;
  canSubmit: boolean;
  onStartTask: () => void;
}

export function NewTaskDialog({
  open,
  onOpenChange,
  editorApiRef,
  onTaskDescriptionChange,
  onSubmit,
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
  teamSlugOrId,
  cloudToggleDisabled,
  branchDisabled,
  providerStatus,
  canSubmit,
  onStartTask,
}: NewTaskDialogProps) {
  const handleSubmitAndClose = useCallback(() => {
    onSubmit();
    onOpenChange(false);
  }, [onSubmit, onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <div className="relative bg-white dark:bg-neutral-700/50 border border-neutral-500/15 dark:border-neutral-500/15 rounded-2xl overflow-hidden">
        <DashboardInput
          ref={editorApiRef}
          onTaskDescriptionChange={onTaskDescriptionChange}
          onSubmit={handleSubmitAndClose}
          repoUrl={lexicalRepoUrl}
          environmentId={lexicalEnvironmentId}
          branch={lexicalBranch}
          persistenceKey="dialog-task-description"
          maxHeight="300px"
        />

        <DashboardInputFooter>
          <DashboardInputControls
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
          />
          <DashboardStartTaskButton
            canSubmit={canSubmit}
            onStartTask={() => {
              onStartTask();
              onOpenChange(false);
            }}
          />
        </DashboardInputFooter>
      </div>
    </CommandDialog>
  );
}
