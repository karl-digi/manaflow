import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { useSocket } from "@/contexts/socket/use-socket";
import { useTheme } from "@/components/theme/use-theme";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import type {
  CreateLocalWorkspaceResponse,
  CreateCloudWorkspaceResponse,
} from "@cmux/shared";
import { useMutation } from "convex/react";
import { Server as ServerIcon, FolderOpen, Loader2, Info } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

type WorkspaceCreationButtonsProps = {
  teamSlugOrId: string;
  selectedProject: string[];
  isEnvSelected: boolean;
};

export function WorkspaceCreationButtons({
  teamSlugOrId,
  selectedProject,
  isEnvSelected,
}: WorkspaceCreationButtonsProps) {
  const { socket } = useSocket();
  const { addTaskToExpand } = useExpandTasks();
  const { theme } = useTheme();
  const [isCreatingLocal, setIsCreatingLocal] = useState(false);
  const [isCreatingCloud, setIsCreatingCloud] = useState(false);

  const reserveLocalWorkspace = useMutation(api.localWorkspaces.reserve);
  const createTask = useMutation(api.tasks.create);

  const handleCreateLocalWorkspace = useCallback(async () => {
    if (!socket) {
      toast.error("Socket not connected");
      return;
    }

    if (selectedProject.length === 0) {
      toast.error("Please select a repository first");
      return;
    }

    if (isEnvSelected) {
      toast.error("Local workspaces require a repository, not an environment");
      return;
    }

    const projectFullName = selectedProject[0];
    const repoUrl = `https://github.com/${projectFullName}.git`;

    setIsCreatingLocal(true);

    try {
      const reservation = await reserveLocalWorkspace({
        teamSlugOrId,
        projectFullName,
        repoUrl,
      });

      if (!reservation) {
        throw new Error("Unable to reserve workspace name");
      }

      addTaskToExpand(reservation.taskId);

      await new Promise<void>((resolve) => {
        socket.emit(
          "create-local-workspace",
          {
            teamSlugOrId,
            projectFullName,
            repoUrl,
            taskId: reservation.taskId,
            taskRunId: reservation.taskRunId,
            workspaceName: reservation.workspaceName,
            descriptor: reservation.descriptor,
          },
          async (response: CreateLocalWorkspaceResponse) => {
            if (response.success) {
              toast.success(
                `Local workspace "${reservation.workspaceName}" created successfully`
              );
            } else {
              toast.error(
                response.error || "Failed to create local workspace"
              );
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error("Error creating local workspace:", error);
      toast.error("Failed to create local workspace");
    } finally {
      setIsCreatingLocal(false);
    }
  }, [
    socket,
    selectedProject,
    isEnvSelected,
    teamSlugOrId,
    reserveLocalWorkspace,
    addTaskToExpand,
  ]);

  const handleCreateCloudWorkspace = useCallback(async () => {
    if (!socket) {
      toast.error("Socket not connected");
      return;
    }

    if (selectedProject.length === 0) {
      toast.error("Please select an environment first");
      return;
    }

    if (!isEnvSelected) {
      toast.error("Cloud workspaces require an environment, not a repository");
      return;
    }

    const projectFullName = selectedProject[0];
    const environmentId = projectFullName.replace(
      /^env:/,
      ""
    ) as Id<"environments">;

    // Extract environment name from the selectedProject (format is "env:id:name")
    const environmentName = projectFullName.split(":")[2] || "Unknown Environment";

    setIsCreatingCloud(true);

    try {
      // Create task in Convex with environment name
      const taskId = await createTask({
        teamSlugOrId,
        text: `Cloud Workspace: ${environmentName}`,
        projectFullName: undefined, // No repo for cloud environment workspaces
        baseBranch: undefined, // No branch for environments
        environmentId,
        isCloudWorkspace: true,
      });

      // Hint the sidebar to auto-expand this task once it appears
      addTaskToExpand(taskId);

      await new Promise<void>((resolve) => {
        socket.emit(
          "create-cloud-workspace",
          {
            teamSlugOrId,
            environmentId,
            taskId,
            theme,
          },
          async (response: CreateCloudWorkspaceResponse) => {
            if (response.success) {
              toast.success("Cloud workspace created successfully");
            } else {
              toast.error(
                response.error || "Failed to create cloud workspace"
              );
            }
            resolve();
          }
        );
      });

      console.log("Cloud workspace created:", taskId);
    } catch (error) {
      console.error("Error creating cloud workspace:", error);
      toast.error("Failed to create cloud workspace");
    } finally {
      setIsCreatingCloud(false);
    }
  }, [
    socket,
    selectedProject,
    isEnvSelected,
    teamSlugOrId,
    createTask,
    addTaskToExpand,
    theme,
  ]);

  const canCreateLocal = selectedProject.length > 0 && !isEnvSelected;
  const canCreateCloud = selectedProject.length > 0 && isEnvSelected;

  const SHOW_WORKSPACE_BUTTONS = true;

  if (!SHOW_WORKSPACE_BUTTONS) {
    return null;
  }

  // Don't show the buttons if no project is selected
  if (selectedProject.length === 0) {
    return null;
  }

  return (
    <div className="mb-4">
      {/* Info banner explaining workspace benefits */}
      <div className="mb-3 flex items-start gap-2 rounded-lg border border-blue-200/60 dark:border-blue-500/40 bg-blue-50/80 dark:bg-blue-500/10 px-3 py-2.5">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500 dark:text-blue-400" />
        <div className="flex-1 text-xs text-blue-900 dark:text-blue-100">
          <p className="font-medium mb-1">Create a dedicated workspace</p>
          <p className="text-blue-900/80 dark:text-blue-200/80">
            <span className="font-medium">Cloud:</span> Fully isolated environment in the cloud with pre-configured setup scripts. {" "}
            <span className="font-medium">Local:</span> Runs on your machine using Docker for faster iteration.
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleCreateCloudWorkspace}
              disabled={!canCreateCloud || isCreatingCloud}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors rounded-lg bg-blue-600 hover:bg-blue-700 text-white border border-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 dark:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
            >
              {isCreatingCloud ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ServerIcon className="w-4 h-4" />
              )}
              <span>Add Cloud Workspace</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {!selectedProject.length
              ? "Select an environment first"
              : !isEnvSelected
                ? "Switch to environment mode to create cloud workspaces"
                : "Create an isolated cloud workspace with your environment configuration"}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleCreateLocalWorkspace}
              disabled={!canCreateLocal || isCreatingLocal}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors rounded-lg bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 border border-neutral-300 dark:border-neutral-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCreatingLocal ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FolderOpen className="w-4 h-4" />
              )}
              <span>Add Local Workspace</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {!selectedProject.length
              ? "Select a repository first"
              : isEnvSelected
                ? "Switch to repository mode to create local workspaces"
                : "Create a local Docker-based workspace from your repository"}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
