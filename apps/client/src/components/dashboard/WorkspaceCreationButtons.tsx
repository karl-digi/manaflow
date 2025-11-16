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

  const SHOW_WORKSPACE_BUTTONS = true;

  if (!SHOW_WORKSPACE_BUTTONS) {
    return null;
  }

  return (
    <div className="mb-6">
      <div className="flex items-start justify-center gap-3">
        {/* Local Workspace Card */}
        <div
          className={`flex-1 max-w-md rounded-xl border transition-all ${
            canCreateLocal
              ? "border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800/50 hover:border-neutral-300 dark:hover:border-neutral-600 hover:shadow-sm"
              : "border-neutral-200/50 dark:border-neutral-800/50 bg-neutral-50/50 dark:bg-neutral-900/30"
          }`}
        >
          <div className="p-4">
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                  canCreateLocal
                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                    : "bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-600"
                }`}
              >
                <FolderOpen className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3
                  className={`text-sm font-semibold mb-1 ${
                    canCreateLocal
                      ? "text-neutral-900 dark:text-neutral-100"
                      : "text-neutral-500 dark:text-neutral-600"
                  }`}
                >
                  Local Workspace
                </h3>
                <p
                  className={`text-xs leading-relaxed mb-3 ${
                    canCreateLocal
                      ? "text-neutral-600 dark:text-neutral-400"
                      : "text-neutral-500 dark:text-neutral-600"
                  }`}
                >
                  Run on your own machine with full control. Best for testing,
                  debugging, or working with existing local environments.
                </p>
                <button
                  onClick={handleCreateLocalWorkspace}
                  disabled={!canCreateLocal || isCreatingLocal}
                  className={`flex items-center justify-center gap-2 w-full px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                    canCreateLocal
                      ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow active:scale-[0.98]"
                      : "bg-neutral-200 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-600 cursor-not-allowed"
                  }`}
                >
                  {isCreatingLocal ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FolderOpen className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isCreatingLocal ? "Creating..." : "Add Local Workspace"}
                  </span>
                </button>
                {!canCreateLocal && (
                  <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-600">
                    {!selectedProject.length
                      ? "Select a repository first"
                      : "Switch to repository mode"}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Cloud Workspace Card */}
        <div
          className={`flex-1 max-w-md rounded-xl border transition-all ${
            canCreateCloud
              ? "border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800/50 hover:border-neutral-300 dark:hover:border-neutral-600 hover:shadow-sm"
              : "border-neutral-200/50 dark:border-neutral-800/50 bg-neutral-50/50 dark:bg-neutral-900/30"
          }`}
        >
          <div className="p-4">
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                  canCreateCloud
                    ? "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
                    : "bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-600"
                }`}
              >
                <ServerIcon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3
                  className={`text-sm font-semibold mb-1 ${
                    canCreateCloud
                      ? "text-neutral-900 dark:text-neutral-100"
                      : "text-neutral-500 dark:text-neutral-600"
                  }`}
                >
                  Cloud Workspace
                </h3>
                <p
                  className={`text-xs leading-relaxed mb-3 ${
                    canCreateCloud
                      ? "text-neutral-600 dark:text-neutral-400"
                      : "text-neutral-500 dark:text-neutral-600"
                  }`}
                >
                  Instant setup with pre-configured environments. Perfect for
                  consistent development with pre-installed packages and
                  scripts.
                </p>
                <button
                  onClick={handleCreateCloudWorkspace}
                  disabled={!canCreateCloud || isCreatingCloud}
                  className={`flex items-center justify-center gap-2 w-full px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                    canCreateCloud
                      ? "bg-purple-600 hover:bg-purple-700 text-white shadow-sm hover:shadow active:scale-[0.98]"
                      : "bg-neutral-200 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-600 cursor-not-allowed"
                  }`}
                >
                  {isCreatingCloud ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ServerIcon className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isCreatingCloud ? "Creating..." : "Add Cloud Workspace"}
                  </span>
                </button>
                {!canCreateCloud && (
                  <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-600">
                    {!selectedProject.length
                      ? "Select an environment first"
                      : "Switch to environment mode"}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
