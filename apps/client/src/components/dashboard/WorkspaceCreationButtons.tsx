import type { SelectOption } from "@/components/ui/searchable-select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { useSocket } from "@/contexts/socket/use-socket";
import { api } from "@cmux/convex/api";
import type { CreateLocalWorkspaceResponse } from "@cmux/shared";
import { useMutation } from "convex/react";
import { Server as ServerIcon, Plus, FolderOpen } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";

type WorkspaceCreationButtonsProps = {
  teamSlugOrId: string;
  projectOptions: SelectOption[];
};

export function WorkspaceCreationButtons({
  teamSlugOrId,
  projectOptions,
}: WorkspaceCreationButtonsProps) {
  const { socket } = useSocket();
  const { addTaskToExpand } = useExpandTasks();
  const navigate = useNavigate();
  const [isCreatingLocal, setIsCreatingLocal] = useState(false);
  const [showLocalPicker, setShowLocalPicker] = useState(false);
  const [showCloudPicker, setShowCloudPicker] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string[]>([]);
  const [selectedEnvironment, setSelectedEnvironment] = useState<string[]>([]);

  const reserveLocalWorkspace = useMutation(api.localWorkspaces.reserve);

  const handleCreateLocalWorkspace = useCallback(async () => {
    if (!socket) {
      toast.error("Socket not connected");
      return;
    }

    if (selectedRepo.length === 0) {
      toast.error("Please select a repository");
      return;
    }

    const projectFullName = selectedRepo[0];
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
              setShowLocalPicker(false);
              setSelectedRepo([]);
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
    selectedRepo,
    teamSlugOrId,
    reserveLocalWorkspace,
    addTaskToExpand,
  ]);

  const handleCreateCloudWorkspace = useCallback(() => {
    if (selectedEnvironment.length === 0) {
      toast.error("Please select an environment");
      return;
    }

    const environmentId = selectedEnvironment[0].replace(/^env:/, "");
    // Navigate to dashboard with environment preselected
    navigate({
      to: "/$teamSlugOrId/dashboard",
      params: { teamSlugOrId },
      search: { environmentId },
    });
    setShowCloudPicker(false);
    setSelectedEnvironment([]);
  }, [selectedEnvironment, navigate, teamSlugOrId]);

  // Filter options for local (repos only) and cloud (environments only)
  const repoOptions = projectOptions.filter((opt) => {
    if (typeof opt === "string") return false;
    return opt.iconKey === "github" && !opt.heading;
  });
  const environmentOptions = projectOptions.filter((opt) => {
    if (typeof opt === "string") return false;
    return opt.iconKey === "environment" && !opt.heading;
  });

  return (
    <div className="flex items-center gap-2 mb-6">
      {/* Local Workspace Button */}
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setShowLocalPicker(!showLocalPicker)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              <span>New Local Workspace</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Create a new local workspace from a repository
          </TooltipContent>
        </Tooltip>

        {showLocalPicker && (
          <div className="flex items-center gap-2">
            <div className="min-w-[300px]">
              <SearchableSelect
                options={repoOptions}
                value={selectedRepo}
                onChange={setSelectedRepo}
                placeholder="Select repository..."
                singleSelect={true}
                disabled={isCreatingLocal}
              />
            </div>
            <button
              onClick={handleCreateLocalWorkspace}
              disabled={selectedRepo.length === 0 || isCreatingLocal}
              className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-4 h-4" />
              {isCreatingLocal ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => {
                setShowLocalPicker(false);
                setSelectedRepo([]);
              }}
              className="px-3 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Cloud Workspace Button */}
      {environmentOptions.length > 0 && (
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowCloudPicker(!showCloudPicker)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
              >
                <ServerIcon className="w-4 h-4" />
                <span>New Cloud Workspace</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Create a new cloud workspace from an environment
            </TooltipContent>
          </Tooltip>

          {showCloudPicker && (
            <div className="flex items-center gap-2">
              <div className="min-w-[300px]">
                <SearchableSelect
                  options={environmentOptions}
                  value={selectedEnvironment}
                  onChange={setSelectedEnvironment}
                  placeholder="Select environment..."
                  singleSelect={true}
                />
              </div>
              <button
                onClick={handleCreateCloudWorkspace}
                disabled={selectedEnvironment.length === 0}
                className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create
              </button>
              <button
                onClick={() => {
                  setShowCloudPicker(false);
                  setSelectedEnvironment([]);
                }}
                className="px-3 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
