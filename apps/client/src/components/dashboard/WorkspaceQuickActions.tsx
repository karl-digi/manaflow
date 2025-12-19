import { env } from "@/client-env";
import { GitHubIcon } from "@/components/icons/github";
import { useTheme } from "@/components/theme/use-theme";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { useSocket } from "@/contexts/socket/use-socket";
import { isElectron } from "@/lib/electron";
import {
  rewriteLocalWorkspaceUrlIfNeeded,
  toProxyWorkspaceUrl,
} from "@/lib/toProxyWorkspaceUrl";
import { useLocalVSCodeServeWebQuery } from "@/queries/local-vscode-serve-web";
import { preloadTaskRunIframes } from "@/lib/preloadTaskRunIframes";
import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import type {
  CreateLocalWorkspaceResponse,
  CreateCloudWorkspaceResponse,
} from "@cmux/shared";
import { deriveRepoBaseName } from "@cmux/shared";
import { useMutation, useQuery } from "convex/react";
import { Cloud, FolderPlus, Loader2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useNavigate, useRouter } from "@tanstack/react-router";

type WorkspaceQuickActionsProps = {
  teamSlugOrId: string;
};

export function WorkspaceQuickActions({
  teamSlugOrId,
}: WorkspaceQuickActionsProps) {
  const { socket } = useSocket();
  const { addTaskToExpand } = useExpandTasks();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const router = useRouter();
  const localServeWeb = useLocalVSCodeServeWebQuery();

  const [isCreatingLocal, setIsCreatingLocal] = useState(false);
  const [isCreatingCloud, setIsCreatingCloud] = useState(false);
  const [selectedLocalRepo, setSelectedLocalRepo] = useState<string | null>(
    null
  );
  const [selectedCloudOption, setSelectedCloudOption] = useState<string | null>(
    null
  );
  const [showLocalDropdown, setShowLocalDropdown] = useState(false);
  const [showCloudDropdown, setShowCloudDropdown] = useState(false);

  const reserveLocalWorkspace = useMutation(api.localWorkspaces.reserve);
  const createTask = useMutation(api.tasks.create);
  const failTaskRun = useMutation(api.taskRuns.fail);

  const reposByOrg = useQuery(api.github.getReposByOrg, { teamSlugOrId });
  const environments = useQuery(api.environments.list, { teamSlugOrId });

  // Build sorted repo list
  const repoOptions = useMemo(() => {
    const repoGroups = reposByOrg ?? {};
    const uniqueRepos = new Map<string, Doc<"repos">>();

    for (const repos of Object.values(repoGroups)) {
      for (const repo of repos ?? []) {
        const existing = uniqueRepos.get(repo.fullName);
        if (!existing) {
          uniqueRepos.set(repo.fullName, repo);
          continue;
        }
        const existingActivity =
          existing.lastPushedAt ?? Number.NEGATIVE_INFINITY;
        const candidateActivity = repo.lastPushedAt ?? Number.NEGATIVE_INFINITY;
        if (candidateActivity > existingActivity) {
          uniqueRepos.set(repo.fullName, repo);
        }
      }
    }

    return Array.from(uniqueRepos.values())
      .sort((a, b) => {
        const aPushedAt = a.lastPushedAt ?? Number.NEGATIVE_INFINITY;
        const bPushedAt = b.lastPushedAt ?? Number.NEGATIVE_INFINITY;
        if (aPushedAt !== bPushedAt) {
          return bPushedAt - aPushedAt;
        }
        return a.fullName.localeCompare(b.fullName);
      })
      .map((repo) => ({
        fullName: repo.fullName,
        repoBaseName:
          deriveRepoBaseName({
            projectFullName: repo.fullName,
            repoUrl: repo.gitRemote,
          }) ?? repo.name,
      }));
  }, [reposByOrg]);

  // Build cloud workspace options (environments + repos)
  const cloudOptions = useMemo(() => {
    const options: Array<
      | { type: "environment"; id: Id<"environments">; name: string }
      | { type: "repo"; fullName: string; repoBaseName: string }
    > = [];

    // Add environments first
    if (environments) {
      for (const env of environments.sort(
        (a, b) => b.createdAt - a.createdAt
      )) {
        options.push({
          type: "environment",
          id: env._id,
          name: env.name,
        });
      }
    }

    // Add repos
    for (const repo of repoOptions) {
      options.push({
        type: "repo",
        fullName: repo.fullName,
        repoBaseName: repo.repoBaseName,
      });
    }

    return options;
  }, [environments, repoOptions]);

  const handleCreateLocalWorkspace = useCallback(
    async (projectFullName: string) => {
      if (isCreatingLocal) return;
      if (!socket) {
        toast.error("Socket not connected. Please try again.");
        return;
      }

      setIsCreatingLocal(true);
      setSelectedLocalRepo(projectFullName);
      let reservedTaskId: Id<"tasks"> | null = null;
      let reservedTaskRunId: Id<"taskRuns"> | null = null;

      try {
        const repoUrl = `https://github.com/${projectFullName}.git`;
        const reservation = await reserveLocalWorkspace({
          teamSlugOrId,
          projectFullName,
          repoUrl,
        });

        if (!reservation) {
          throw new Error("Unable to reserve workspace name");
        }

        reservedTaskId = reservation.taskId;
        reservedTaskRunId = reservation.taskRunId;
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
              try {
                if (!response?.success) {
                  const message =
                    response?.error ??
                    `Unable to create workspace for ${projectFullName}`;
                  if (reservedTaskRunId) {
                    await failTaskRun({
                      teamSlugOrId,
                      id: reservedTaskRunId,
                      errorMessage: message,
                    }).catch(() => undefined);
                  }
                  toast.error(message);
                  return;
                }

                const effectiveTaskId = response.taskId ?? reservedTaskId;
                const effectiveTaskRunId =
                  response.taskRunId ?? reservedTaskRunId;
                const effectiveWorkspaceName =
                  response.workspaceName ??
                  reservation.workspaceName ??
                  projectFullName;

                toast.success(
                  response.pending
                    ? `${effectiveWorkspaceName} is provisioning…`
                    : `${effectiveWorkspaceName} is ready`
                );

                const normalizedWorkspaceUrl = response.workspaceUrl
                  ? rewriteLocalWorkspaceUrlIfNeeded(
                      response.workspaceUrl,
                      localServeWeb.data?.baseUrl
                    )
                  : null;

                if (response.workspaceUrl && effectiveTaskRunId) {
                  const proxiedUrl = toProxyWorkspaceUrl(
                    response.workspaceUrl,
                    localServeWeb.data?.baseUrl
                  );
                  if (proxiedUrl) {
                    void preloadTaskRunIframes([
                      { url: proxiedUrl, taskRunId: effectiveTaskRunId },
                    ]).catch(() => undefined);
                  }
                }

                if (effectiveTaskId && effectiveTaskRunId) {
                  void router
                    .preloadRoute({
                      to: "/$teamSlugOrId/task/$taskId/run/$runId/vscode",
                      params: {
                        teamSlugOrId,
                        taskId: effectiveTaskId,
                        runId: effectiveTaskRunId,
                      },
                    })
                    .catch(() => undefined);
                  void navigate({
                    to: "/$teamSlugOrId/task/$taskId/run/$runId/vscode",
                    params: {
                      teamSlugOrId,
                      taskId: effectiveTaskId,
                      runId: effectiveTaskRunId,
                    },
                  });
                } else if (normalizedWorkspaceUrl) {
                  window.location.assign(normalizedWorkspaceUrl);
                }
              } catch (callbackError) {
                const message =
                  callbackError instanceof Error
                    ? callbackError.message
                    : String(callbackError ?? "Unknown");
                console.error("Failed to create workspace", message);
              } finally {
                resolve();
              }
            }
          );
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? "Unknown");
        if (reservedTaskRunId) {
          await failTaskRun({
            teamSlugOrId,
            id: reservedTaskRunId,
            errorMessage: message,
          }).catch(() => undefined);
        }
        console.error("Failed to create workspace", message);
        toast.error("Failed to create local workspace");
      } finally {
        setIsCreatingLocal(false);
        setSelectedLocalRepo(null);
        setShowLocalDropdown(false);
      }
    },
    [
      addTaskToExpand,
      failTaskRun,
      isCreatingLocal,
      localServeWeb.data?.baseUrl,
      navigate,
      reserveLocalWorkspace,
      router,
      socket,
      teamSlugOrId,
    ]
  );

  const handleCreateCloudWorkspaceFromEnvironment = useCallback(
    async (environmentId: Id<"environments">) => {
      if (isCreatingCloud) return;
      if (!socket) {
        toast.error("Socket not connected. Please try again.");
        return;
      }

      setIsCreatingCloud(true);
      setSelectedCloudOption(`env:${environmentId}`);

      try {
        const environment = environments?.find(
          (env) => env._id === environmentId
        );
        const environmentName = environment?.name ?? "Unknown Environment";

        const { taskId } = await createTask({
          teamSlugOrId,
          text: `Cloud Workspace: ${environmentName}`,
          projectFullName: undefined,
          baseBranch: undefined,
          environmentId,
          isCloudWorkspace: true,
        });

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
              try {
                if (response.success) {
                  toast.success("Cloud workspace created successfully");
                } else {
                  toast.error(
                    response.error || "Failed to create cloud workspace"
                  );
                }
              } catch (callbackError) {
                console.error("Failed to create cloud workspace", callbackError);
              } finally {
                resolve();
              }
            }
          );
        });
      } catch (error) {
        console.error("Error creating cloud workspace:", error);
        toast.error("Failed to create cloud workspace");
      } finally {
        setIsCreatingCloud(false);
        setSelectedCloudOption(null);
        setShowCloudDropdown(false);
      }
    },
    [
      addTaskToExpand,
      createTask,
      environments,
      isCreatingCloud,
      socket,
      teamSlugOrId,
      theme,
    ]
  );

  const handleCreateCloudWorkspaceFromRepo = useCallback(
    async (projectFullName: string) => {
      if (isCreatingCloud) return;
      if (!socket) {
        toast.error("Socket not connected. Please try again.");
        return;
      }

      setIsCreatingCloud(true);
      setSelectedCloudOption(`repo:${projectFullName}`);

      try {
        const repoUrl = `https://github.com/${projectFullName}.git`;

        const { taskId } = await createTask({
          teamSlugOrId,
          text: `Cloud Workspace: ${projectFullName}`,
          projectFullName,
          baseBranch: undefined,
          environmentId: undefined,
          isCloudWorkspace: true,
        });

        addTaskToExpand(taskId);

        await new Promise<void>((resolve) => {
          socket.emit(
            "create-cloud-workspace",
            {
              teamSlugOrId,
              projectFullName,
              repoUrl,
              taskId,
              theme,
            },
            async (response: CreateCloudWorkspaceResponse) => {
              try {
                if (response.success) {
                  toast.success("Cloud workspace created successfully");
                } else {
                  toast.error(
                    response.error || "Failed to create cloud workspace"
                  );
                }
              } catch (callbackError) {
                console.error("Failed to create cloud workspace", callbackError);
              } finally {
                resolve();
              }
            }
          );
        });
      } catch (error) {
        console.error("Error creating cloud workspace:", error);
        toast.error("Failed to create cloud workspace");
      } finally {
        setIsCreatingCloud(false);
        setSelectedCloudOption(null);
        setShowCloudDropdown(false);
      }
    },
    [addTaskToExpand, createTask, isCreatingCloud, socket, teamSlugOrId, theme]
  );

  const showLocalWorkspaceOption = !env.NEXT_PUBLIC_WEB_MODE && isElectron;
  const hasRepos = repoOptions.length > 0;
  const hasCloudOptions = cloudOptions.length > 0;

  // Close dropdowns when clicking outside
  const handleBackdropClick = useCallback(() => {
    setShowLocalDropdown(false);
    setShowCloudDropdown(false);
  }, []);

  if (!hasRepos && !hasCloudOptions) {
    return null;
  }

  return (
    <>
      {/* Backdrop for closing dropdowns */}
      {(showLocalDropdown || showCloudDropdown) && (
        <div
          className="fixed inset-0 z-10"
          onClick={handleBackdropClick}
          onKeyDown={(e) => {
            if (e.key === "Escape") handleBackdropClick();
          }}
        />
      )}

      <div className="flex items-center gap-3 mb-4">
        {/* Local Workspace Button */}
        {showLocalWorkspaceOption && hasRepos && (
          <div className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    setShowLocalDropdown(!showLocalDropdown);
                    setShowCloudDropdown(false);
                  }}
                  disabled={isCreatingLocal}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all rounded-xl bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreatingLocal ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FolderPlus className="w-4 h-4" />
                  )}
                  <span>New Local Workspace</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Create a workspace running on your machine
              </TooltipContent>
            </Tooltip>

            {/* Local Workspace Dropdown */}
            {showLocalDropdown && (
              <div className="absolute top-full left-0 mt-2 w-80 max-h-64 overflow-y-auto bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-lg z-20">
                <div className="p-2">
                  <div className="px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                    Select Repository
                  </div>
                  {repoOptions.slice(0, 10).map((repo) => (
                    <button
                      key={repo.fullName}
                      onClick={() => handleCreateLocalWorkspace(repo.fullName)}
                      disabled={
                        isCreatingLocal && selectedLocalRepo === repo.fullName
                      }
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50"
                    >
                      {isCreatingLocal &&
                      selectedLocalRepo === repo.fullName ? (
                        <Loader2 className="w-4 h-4 animate-spin text-neutral-500" />
                      ) : (
                        <GitHubIcon className="w-4 h-4 text-neutral-500" />
                      )}
                      <span className="truncate text-neutral-700 dark:text-neutral-200">
                        {repo.fullName}
                      </span>
                    </button>
                  ))}
                  {repoOptions.length > 10 && (
                    <div className="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400">
                      Use ⌘K for more options
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Cloud Workspace Button */}
        {hasCloudOptions && (
          <div className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    setShowCloudDropdown(!showCloudDropdown);
                    setShowLocalDropdown(false);
                  }}
                  disabled={isCreatingCloud}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all rounded-xl bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreatingCloud ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Cloud className="w-4 h-4" />
                  )}
                  <span>New Cloud Workspace</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Create a workspace in the cloud
              </TooltipContent>
            </Tooltip>

            {/* Cloud Workspace Dropdown */}
            {showCloudDropdown && (
              <div className="absolute top-full left-0 mt-2 w-80 max-h-80 overflow-y-auto bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-lg z-20">
                <div className="p-2">
                  {/* Environments Section */}
                  {environments && environments.length > 0 && (
                    <>
                      <div className="px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                        Environments
                      </div>
                      {environments.slice(0, 5).map((env) => (
                        <button
                          key={env._id}
                          onClick={() =>
                            handleCreateCloudWorkspaceFromEnvironment(env._id)
                          }
                          disabled={
                            isCreatingCloud &&
                            selectedCloudOption === `env:${env._id}`
                          }
                          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50"
                        >
                          {isCreatingCloud &&
                          selectedCloudOption === `env:${env._id}` ? (
                            <Loader2 className="w-4 h-4 animate-spin text-neutral-500" />
                          ) : (
                            <Cloud className="w-4 h-4 text-blue-500" />
                          )}
                          <span className="truncate text-neutral-700 dark:text-neutral-200">
                            {env.name}
                          </span>
                        </button>
                      ))}
                    </>
                  )}

                  {/* Repositories Section */}
                  {repoOptions.length > 0 && (
                    <>
                      <div className="px-3 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mt-2">
                        Repositories
                      </div>
                      {repoOptions.slice(0, 5).map((repo) => (
                        <button
                          key={repo.fullName}
                          onClick={() =>
                            handleCreateCloudWorkspaceFromRepo(repo.fullName)
                          }
                          disabled={
                            isCreatingCloud &&
                            selectedCloudOption === `repo:${repo.fullName}`
                          }
                          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50"
                        >
                          {isCreatingCloud &&
                          selectedCloudOption === `repo:${repo.fullName}` ? (
                            <Loader2 className="w-4 h-4 animate-spin text-neutral-500" />
                          ) : (
                            <GitHubIcon className="w-4 h-4 text-neutral-500" />
                          )}
                          <span className="truncate text-neutral-700 dark:text-neutral-200">
                            {repo.fullName}
                          </span>
                        </button>
                      ))}
                    </>
                  )}

                  {(environments && environments.length > 5) ||
                  repoOptions.length > 5 ? (
                    <div className="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400 border-t border-neutral-200 dark:border-neutral-700 mt-2">
                      Use ⌘K for more options
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Keyboard shortcut hint */}
        <div className="text-xs text-neutral-400 dark:text-neutral-500 ml-auto">
          <kbd className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-700 rounded text-neutral-500 dark:text-neutral-400 font-mono">
            ⌘K
          </kbd>
          <span className="ml-1.5">for all options</span>
        </div>
      </div>
    </>
  );
}
