import { SettingSection } from "@/components/settings/SettingSection";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useSocket } from "@/contexts/socket/use-socket";
import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useConvex } from "convex/react";
import { FolderGit2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";

interface WorktreesSectionProps {
  teamSlugOrId: string;
}

export function WorktreesSection({
  teamSlugOrId,
}: WorktreesSectionProps) {
  const convex = useConvex();
  const { socket } = useSocket();
  const [showAddMappingForm, setShowAddMappingForm] = useState(false);
  const [newProjectFullName, setNewProjectFullName] = useState("");
  const [newLocalRepoPath, setNewLocalRepoPath] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmWorktree, setDeleteConfirmWorktree] = useState<Doc<"worktreeRegistry"> | null>(null);

  // Query source repo mappings
  const { data: sourceRepoMappings, refetch: refetchMappings } = useQuery(
    convexQuery(api.sourceRepoMappings.list, { teamSlugOrId })
  );

  // Query worktree registry
  const { data: worktreeRegistry, refetch: refetchRegistry } = useQuery(
    convexQuery(api.worktreeRegistry.list, { teamSlugOrId })
  );

  // Query local workspaces (tasks with worktreePath) - used to enrich worktree data
  const { data: localWorkspaces, refetch: refetchLocalWorkspaces } = useQuery(
    convexQuery(api.worktreeRegistry.listLocalWorkspaces, { teamSlugOrId })
  );

  // Merge worktree registry with task data for unified display
  type EnrichedWorktree = Doc<"worktreeRegistry"> & {
    tasks: Array<{
      taskId: Id<"tasks">;
      text?: string;
    }>;
  };

  const enrichedWorktrees = useMemo((): EnrichedWorktree[] => {
    if (!worktreeRegistry) return [];

    return worktreeRegistry.map((worktree) => {
      // Find tasks that match this worktree path
      const matchingTasks = (localWorkspaces || [])
        .filter((ws) => ws.worktreePath === worktree.worktreePath)
        .map((ws) => ({
          taskId: ws.taskId,
          text: ws.displayTitle,
        }));

      return {
        ...worktree,
        tasks: matchingTasks,
      };
    });
  }, [worktreeRegistry, localWorkspaces]);

  // Auto-validate and clean up stale local workspaces when data loads
  const validateAndCleanupStaleWorkspaces = useCallback(() => {
    if (!socket || !localWorkspaces || localWorkspaces.length === 0) return;

    // Collect all worktree paths to validate
    const pathsToValidate = localWorkspaces
      .filter((ws) => ws.worktreePath)
      .map((ws) => ws.worktreePath as string);

    if (pathsToValidate.length === 0) return;

    socket.emit(
      "validate-worktrees",
      { teamSlugOrId, worktreePaths: pathsToValidate },
      async (response) => {
        if (response.success && response.invalidPaths.length > 0) {
          // Auto-cleanup stale entries
          const staleWorkspaces = localWorkspaces.filter(
            (ws) => ws.worktreePath && response.invalidPaths.includes(ws.worktreePath)
          );

          for (const ws of staleWorkspaces) {
            socket.emit(
              "cleanup-stale-workspace",
              { teamSlugOrId, taskId: ws.taskId },
              () => {
                // Silent cleanup
              }
            );
          }

          // Refetch after cleanup
          if (staleWorkspaces.length > 0) {
            setTimeout(() => {
              void refetchLocalWorkspaces();
            }, 500);
          }
        }
      }
    );
  }, [socket, localWorkspaces, teamSlugOrId, refetchLocalWorkspaces]);

  // Run validation when local workspaces data changes
  useEffect(() => {
    validateAndCleanupStaleWorkspaces();
  }, [validateAndCleanupStaleWorkspaces]);

  // Auto-validate and clean up stale worktree registry entries
  const validateAndCleanupStaleRegistry = useCallback(() => {
    if (!socket || !worktreeRegistry || worktreeRegistry.length === 0) return;

    const pathsToValidate = worktreeRegistry.map((wt) => wt.worktreePath);

    socket.emit(
      "validate-worktrees",
      { teamSlugOrId, worktreePaths: pathsToValidate },
      (response) => {
        if (response.success && response.invalidPaths.length > 0) {
          // Auto-cleanup stale registry entries
          for (const invalidPath of response.invalidPaths) {
            socket.emit(
              "delete-worktree",
              { teamSlugOrId, worktreePath: invalidPath },
              () => {
                // Silent cleanup - delete-worktree removes from registry even if path doesn't exist
              }
            );
          }

          // Refetch after cleanup
          setTimeout(() => {
            void refetchRegistry();
          }, 500);
        }
      }
    );
  }, [socket, worktreeRegistry, teamSlugOrId, refetchRegistry]);

  // Run registry validation when data changes
  useEffect(() => {
    validateAndCleanupStaleRegistry();
  }, [validateAndCleanupStaleRegistry]);

  // Mutation to add source repo mapping
  const addSourceRepoMutation = useMutation({
    mutationFn: async ({
      projectFullName,
      localRepoPath,
    }: {
      projectFullName: string;
      localRepoPath: string;
    }) => {
      await convex.mutation(api.sourceRepoMappings.upsert, {
        teamSlugOrId,
        projectFullName,
        localRepoPath,
      });
    },
    onSuccess: () => {
      void refetchMappings();
      toast.success("Source repo mapping added");
      setShowAddMappingForm(false);
      setNewProjectFullName("");
      setNewLocalRepoPath("");
    },
    onError: (error) => {
      console.error("Failed to add source repo mapping:", error);
      toast.error("Failed to add source repo mapping");
    },
  });

  // Mutation to remove source repo mapping
  const removeSourceRepoMutation = useMutation({
    mutationFn: async (projectFullName: string) => {
      await convex.mutation(api.sourceRepoMappings.remove, {
        teamSlugOrId,
        projectFullName,
      });
    },
    onSuccess: () => {
      void refetchMappings();
      toast.success("Source repo mapping removed");
    },
    onError: (error) => {
      console.error("Failed to remove source repo mapping:", error);
      toast.error("Failed to remove source repo mapping");
    },
  });

  const handleAddMapping = () => {
    const trimmedProject = newProjectFullName.trim();
    const trimmedPath = newLocalRepoPath.trim();

    if (!trimmedProject) {
      toast.error("Please enter a repository name (e.g., owner/repo)");
      return;
    }
    if (!trimmedPath) {
      toast.error("Please enter a local path");
      return;
    }
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmedProject)) {
      toast.error("Invalid repository format. Use owner/repo format.");
      return;
    }

    addSourceRepoMutation.mutate({
      projectFullName: trimmedProject,
      localRepoPath: trimmedPath,
    });
  };

  // Scan for worktrees on filesystem
  const handleScanWorktrees = () => {
    if (!socket) {
      toast.error("Not connected to local server");
      return;
    }
    setIsScanning(true);
    socket.emit("scan-worktrees", { teamSlugOrId }, (response) => {
      setIsScanning(false);
      if (response.success) {
        if (response.registered > 0) {
          toast.success(
            `Found ${response.found} worktrees, registered ${response.registered} new`
          );
          void refetchRegistry();
        } else if (response.found > 0) {
          toast.info(`Found ${response.found} worktrees, all already registered`);
        } else {
          toast.info("No worktrees found in ~/.cmux/worktrees/");
        }
      } else {
        toast.error(response.error || "Failed to scan worktrees");
      }
    });
  };

  // Delete worktree from filesystem and registry
  const handleDeleteWorktree = (worktree: Doc<"worktreeRegistry">) => {
    setDeleteConfirmWorktree(worktree);
  };

  const confirmDeleteWorktree = () => {
    if (!deleteConfirmWorktree) return;

    if (!socket) {
      toast.error("Not connected to local server");
      setDeleteConfirmWorktree(null);
      return;
    }

    setIsDeleting(true);
    socket.emit(
      "delete-worktree",
      { teamSlugOrId, worktreePath: deleteConfirmWorktree.worktreePath },
      (response) => {
        setIsDeleting(false);
        setDeleteConfirmWorktree(null);
        if (response.success) {
          toast.success("Worktree deleted");
          void refetchRegistry();
          void refetchLocalWorkspaces();
        } else {
          toast.error(response.error || "Failed to delete worktree");
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteConfirmWorktree !== null}
        onOpenChange={(open: boolean) => !open && setDeleteConfirmWorktree(null)}
        title="Delete Worktree"
        description={
          deleteConfirmWorktree
            ? `Are you sure you want to delete this worktree? This will permanently remove the folder from your filesystem.\n\n${deleteConfirmWorktree.worktreePath}`
            : "Are you sure you want to delete this worktree?"
        }
        confirmLabel={isDeleting ? "Deleting..." : "Delete"}
        cancelLabel="Cancel"
        onConfirm={confirmDeleteWorktree}
      />

      <SettingSection
        title="Source Repo Mappings"
        description="Map GitHub repositories to local filesystem paths. Mappings are auto-detected from common locations (~/code, ~/Desktop/code, etc.) but you can add custom mappings here."
      >
        {/* Add mapping form */}
        {showAddMappingForm ? (
          <div className="border-b border-neutral-200 px-4 py-4 dark:border-neutral-800">
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="projectFullName"
                  className="mb-1 block text-xs font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Repository (owner/repo)
                </label>
                <input
                  id="projectFullName"
                  type="text"
                  value={newProjectFullName}
                  onChange={(e) => setNewProjectFullName(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500"
                  placeholder="karlorz/testing-repo-1"
                  autoComplete="off"
                />
              </div>
              <div>
                <label
                  htmlFor="localRepoPath"
                  className="mb-1 block text-xs font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Local path
                </label>
                <input
                  id="localRepoPath"
                  type="text"
                  value={newLocalRepoPath}
                  onChange={(e) => setNewLocalRepoPath(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500"
                  placeholder="/Users/karlchow/code/testing-repo-1"
                  autoComplete="off"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleAddMapping}
                  disabled={addSourceRepoMutation.isPending}
                >
                  {addSourceRepoMutation.isPending ? "Adding..." : "Add Mapping"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowAddMappingForm(false);
                    setNewProjectFullName("");
                    setNewLocalRepoPath("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddMappingForm(true)}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Add Mapping
            </Button>
          </div>
        )}

        {/* Existing mappings list */}
        {sourceRepoMappings && sourceRepoMappings.length > 0 ? (
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {sourceRepoMappings.map((mapping: Doc<"sourceRepoMappings">) => (
              <div
                key={mapping._id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {mapping.projectFullName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {mapping.localRepoPath}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    removeSourceRepoMutation.mutate(mapping.projectFullName)
                  }
                  disabled={removeSourceRepoMutation.isPending}
                  className="ml-2 text-neutral-500 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          !showAddMappingForm && (
            <div className="px-4 py-8 text-center">
              <FolderGit2 className="mx-auto h-8 w-8 text-neutral-400" />
              <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
                No source repo mappings yet
              </p>
              <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                Mappings are auto-detected when you start tasks. Add custom mappings here if needed.
              </p>
            </div>
          )
        )}
      </SettingSection>

      <SettingSection
        title="Worktrees"
        description="Active worktrees created by cmux"
        headerAction={
          <Button
            variant="outline"
            size="sm"
            onClick={handleScanWorktrees}
            disabled={isScanning || !socket}
            className="gap-1.5"
          >
            <RefreshCw
              className={`h-4 w-4 ${isScanning ? "animate-spin" : ""}`}
            />
            {isScanning ? "Scanning..." : "Scan"}
          </Button>
        }
      >
        {enrichedWorktrees.length > 0 ? (
          <div className="space-y-6 px-4 py-4">
            {/* Group worktrees by source repo */}
            {Object.entries(
              enrichedWorktrees.reduce(
                (acc, worktree) => {
                  const source = worktree.sourceRepoPath || "Unknown";
                  if (!acc[source]) acc[source] = [];
                  acc[source].push(worktree);
                  return acc;
                },
                {} as Record<string, EnrichedWorktree[]>
              )
            ).map(([sourceRepo, worktrees]) => (
              <div key={sourceRepo}>
                <p className="mb-3 font-mono text-sm text-neutral-700 dark:text-neutral-300">
                  {sourceRepo}
                </p>
                <div className="space-y-3">
                  {worktrees.map((worktree) => (
                    <div
                      key={worktree._id}
                      className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-sm text-neutral-900 dark:text-neutral-100">
                            {worktree.worktreePath}
                          </p>
                          {worktree.branchName && worktree.branchName !== "unknown" && (
                            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                              Branch: <span className="font-medium">{worktree.branchName}</span>
                            </p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteWorktree(worktree)}
                          className="ml-4 flex-shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950 dark:hover:text-red-300"
                        >
                          Delete
                        </Button>
                      </div>
                      {/* Show linked tasks - full width below header */}
                      {worktree.tasks.length > 0 ? (
                        <div className="mt-3 space-y-1">
                          {worktree.tasks.map((task) => (
                            <Link
                              key={task.taskId}
                              to="/$teamSlugOrId/task/$taskId"
                              params={{ teamSlugOrId, taskId: task.taskId }}
                              search={{ runId: undefined }}
                              className="block w-full truncate rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                            >
                              {task.text || "Task"}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
                          No linked tasks
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center">
            <FolderGit2 className="mx-auto h-8 w-8 text-neutral-400" />
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
              No active worktrees
            </p>
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              Worktrees will appear here when you start local tasks
            </p>
          </div>
        )}
      </SettingSection>
    </div>
  );
}
