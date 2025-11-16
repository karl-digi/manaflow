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
import { Server as ServerIcon, FolderOpen, Loader2 } from "lucide-react";
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

  const localHelperText = !selectedProject.length
    ? "Pick a repository to spin up a local workspace on your machine."
    : isEnvSelected
      ? "Local workspaces use your repo. Switch to a repository to enable."
      : "Runs on your laptop with your dev tools and credentials.";

  const cloudHelperText = !selectedProject.length
    ? "Select an environment to launch a cloud workspace."
    : !isEnvSelected
      ? "Cloud workspaces use environments. Switch to an environment to enable."
      : "Runs in cmux with preconfigured environments and secrets.";

  return (
    <div className="mb-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-xs font-semibold tracking-wide text-neutral-600 dark:text-neutral-300 uppercase">
          Workspaces
        </div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          Choose cloud for shareable, preconfigured runs or local to use your
          laptop and local repos.
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-blue-100/70 dark:border-blue-400/20 bg-blue-50/70 dark:bg-blue-950/40 p-4 shadow-[0_10px_30px_-20px_rgba(59,130,246,0.7)]">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white dark:bg-blue-900/60 text-blue-600 dark:text-blue-100 shadow-sm">
              <ServerIcon className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Cloud Workspace
              </div>
              <div className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
                For reproducible, shareable runs that use managed compute and
                your saved environment configuration.
              </div>
              <ul className="list-disc pl-4 text-xs text-neutral-600 dark:text-neutral-200 space-y-1">
                <li>Preloaded with environment variables, tools, and secrets.</li>
                <li>Runs even when your laptop is offline; easy to share.</li>
                <li>Great for persistent automations or maintenance tasks.</li>
              </ul>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-xs text-neutral-600 dark:text-neutral-300">
              {cloudHelperText}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleCreateCloudWorkspace}
                  disabled={!canCreateCloud || isCreatingCloud}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white px-3 py-1.5 text-xs font-semibold shadow-sm transition hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isCreatingCloud ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ServerIcon className="w-3.5 h-3.5" />
                  )}
                  <span>Add Cloud Workspace</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {!selectedProject.length
                  ? "Select an environment first"
                  : !isEnvSelected
                    ? "Switch to environment mode (not repository)"
                    : "Create workspace from selected environment"}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="rounded-2xl border border-amber-100/70 dark:border-amber-400/20 bg-amber-50/70 dark:bg-amber-950/30 p-4 shadow-[0_10px_30px_-20px_rgba(245,158,11,0.7)]">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white dark:bg-amber-900/50 text-amber-700 dark:text-amber-50 shadow-sm">
              <FolderOpen className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Local Workspace
              </div>
              <div className="text-xs text-neutral-700 dark:text-neutral-200 leading-relaxed">
                Use when you want to pair the agent with your checked-out repo,
                local tools, and fast iteration on your machine.
              </div>
              <ul className="list-disc pl-4 text-xs text-neutral-700 dark:text-neutral-200 space-y-1">
                <li>Reads and writes directly to your local repository.</li>
                <li>Ideal for debugging with your editor and local services.</li>
                <li>Low latency and uses your hardware resources.</li>
              </ul>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-xs text-neutral-700 dark:text-neutral-200">
              {localHelperText}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleCreateLocalWorkspace}
                  disabled={!canCreateLocal || isCreatingLocal}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-500 text-white px-3 py-1.5 text-xs font-semibold shadow-sm transition hover:bg-amber-400 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isCreatingLocal ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FolderOpen className="w-3.5 h-3.5" />
                  )}
                  <span>Add Local Workspace</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {!selectedProject.length
                  ? "Select a repository first"
                  : isEnvSelected
                    ? "Switch to repository mode (not environment)"
                    : "Create workspace from selected repository"}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}
