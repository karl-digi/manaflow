import {
  DashboardInput,
  type EditorApi,
} from "@/components/dashboard/DashboardInput";
import { DashboardInputControls } from "@/components/dashboard/DashboardInputControls";
import { DashboardInputFooter } from "@/components/dashboard/DashboardInputFooter";
import { DashboardStartTaskButton } from "@/components/dashboard/DashboardStartTaskButton";
import { WorkspaceCreationButtons } from "@/components/dashboard/WorkspaceCreationButtons";
import { WorkspaceSetupPanel } from "@/components/WorkspaceSetupPanel";
import { GitHubIcon } from "@/components/icons/github";
import { useTheme } from "@/components/theme/use-theme";
import type { SelectOption } from "@/components/ui/searchable-select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { useSocket } from "@/contexts/socket/use-socket";
import { createFakeConvexId } from "@/lib/fakeConvexId";
import { attachTaskLifecycleListeners } from "@/lib/socket/taskLifecycleListeners";
import { branchesQueryOptions } from "@/queries/branches";
import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import type {
  ProviderStatusResponse,
  TaskAcknowledged,
  TaskError,
  TaskStarted,
} from "@cmux/shared";
import { AGENT_CONFIGS } from "@cmux/shared/agentConfig";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useAction, useMutation } from "convex/react";
import { Server as ServerIcon } from "lucide-react";
import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { toast } from "sonner";
import { z } from "zod";

const DEFAULT_AGENTS = [
  "claude/sonnet-4.5",
  "claude/opus-4.1",
  "codex/gpt-5-codex-high",
];
const KNOWN_AGENT_NAMES = new Set(AGENT_CONFIGS.map((agent) => agent.name));
const DEFAULT_AGENT_SELECTION = DEFAULT_AGENTS.filter((agent) =>
  KNOWN_AGENT_NAMES.has(agent),
);
const AGENT_SELECTION_SCHEMA = z.array(z.string());

const filterKnownAgents = (agents: string[]): string[] =>
  agents.filter((agent) => KNOWN_AGENT_NAMES.has(agent));

const parseStoredAgentSelection = (stored: string | null): string[] => {
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    const result = AGENT_SELECTION_SCHEMA.safeParse(parsed);
    if (!result.success) {
      console.warn("Invalid stored agent selection", result.error);
      return [];
    }

    return filterKnownAgents(result.data);
  } catch (error) {
    console.warn("Failed to parse stored agent selection", error);
    return [];
  }
};

export interface TaskCreationPanelProps {
  teamSlugOrId: string;
  className?: string;
  showWorkspaceCreationButtons?: boolean;
  showWorkspaceSetupPanel?: boolean;
  editorPersistenceKey?: string;
  maxEditorHeight?: string;
  preselectedEnvironmentId?: string;
  onTaskStarted?: () => void;
}

export function TaskCreationPanel({
  teamSlugOrId,
  className,
  showWorkspaceCreationButtons = true,
  showWorkspaceSetupPanel = true,
  editorPersistenceKey = "dashboard-task-description",
  maxEditorHeight = "300px",
  preselectedEnvironmentId,
  onTaskStarted,
}: TaskCreationPanelProps) {
  const { socket } = useSocket();
  const { addTaskToExpand } = useExpandTasks();
  const { theme } = useTheme();

  const [selectedProject, setSelectedProject] = useState<string[]>(() => {
    const stored = localStorage.getItem(`selectedProject-${teamSlugOrId}`);
    return stored ? JSON.parse(stored) : [];
  });
  const [selectedBranch, setSelectedBranch] = useState<string[]>([]);
  const [selectedAgents, setSelectedAgentsState] = useState<string[]>(() => {
    const storedAgents = parseStoredAgentSelection(
      localStorage.getItem("selectedAgents"),
    );

    if (storedAgents.length > 0) {
      return storedAgents;
    }

    return DEFAULT_AGENT_SELECTION.length > 0
      ? [...DEFAULT_AGENT_SELECTION]
      : [];
  });
  const selectedAgentsRef = useRef<string[]>(selectedAgents);
  const [taskDescription, setTaskDescription] = useState<string>("");
  const [isCloudMode, setIsCloudMode] = useState<boolean>(() => {
    const stored = localStorage.getItem("isCloudMode");
    return stored ? JSON.parse(stored) : true;
  });
  const [, setDockerReady] = useState<boolean | null>(null);
  const [providerStatus, setProviderStatus] =
    useState<ProviderStatusResponse | null>(null);
  const editorApiRef = useRef<EditorApi | null>(null);

  const persistAgentSelection = useCallback((agents: string[]) => {
    try {
      const isDefaultSelection =
        DEFAULT_AGENT_SELECTION.length > 0 &&
        agents.length === DEFAULT_AGENT_SELECTION.length &&
        agents.every(
          (agent, index) => agent === DEFAULT_AGENT_SELECTION[index],
        );

      if (agents.length === 0 || isDefaultSelection) {
        localStorage.removeItem("selectedAgents");
      } else {
        localStorage.setItem("selectedAgents", JSON.stringify(agents));
      }
    } catch (error) {
      console.warn("Failed to persist agent selection", error);
    }
  }, []);

  const handleProjectChange = useCallback(
    (newProjects: string[]) => {
      setSelectedProject(newProjects);
      localStorage.setItem(
        `selectedProject-${teamSlugOrId}`,
        JSON.stringify(newProjects),
      );
      if (newProjects[0] !== selectedProject[0]) {
        setSelectedBranch([]);
      }
      if ((newProjects[0] || "").startsWith("env:")) {
        setIsCloudMode(true);
        localStorage.setItem("isCloudMode", JSON.stringify(true));
      }
    },
    [selectedProject, teamSlugOrId],
  );

  const handleBranchChange = useCallback((newBranches: string[]) => {
    setSelectedBranch(newBranches);
  }, []);

  const handleAgentChange = useCallback(
    (newAgents: string[]) => {
      const normalizedAgents = filterKnownAgents(newAgents);
      setSelectedAgentsState(normalizedAgents);
      selectedAgentsRef.current = normalizedAgents;
      persistAgentSelection(normalizedAgents);
    },
    [persistAgentSelection],
  );

  const handleTaskDescriptionChange = useCallback((value: string) => {
    setTaskDescription(value);
  }, []);

  const handleCloudModeToggle = useCallback(() => {
    setIsCloudMode((prev) => {
      localStorage.setItem("isCloudMode", JSON.stringify(!prev));
      return !prev;
    });
  }, []);

  const reposByOrgQuery = useQuery({
    ...convexQuery(api.github.getReposByOrg, { teamSlugOrId }),
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  const reposByOrg = useMemo(
    () => reposByOrgQuery.data || {},
    [reposByOrgQuery.data],
  );

  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  const createTask = useMutation(api.tasks.create).withOptimisticUpdate(
    (localStore, args) => {
      const currentTasks = localStore.getQuery(api.tasks.get, {
        teamSlugOrId,
      });

      if (currentTasks !== undefined) {
        const now = Date.now();
        const optimisticTask = {
          _id: createFakeConvexId() as Doc<"tasks">["_id"],
          _creationTime: now,
          text: args.text,
          description: args.description,
          projectFullName: args.projectFullName,
          baseBranch: args.baseBranch,
          worktreePath: args.worktreePath,
          isCompleted: false,
          isArchived: false,
          createdAt: now,
          updatedAt: now,
          images: args.images,
          userId: "optimistic",
          teamId: teamSlugOrId,
          environmentId: args.environmentId,
        };

        const listArgs: {
          teamSlugOrId: string;
          projectFullName?: string;
          archived?: boolean;
        } = {
          teamSlugOrId,
        };
        localStore.setQuery(api.tasks.get, listArgs, [
          optimisticTask,
          ...currentTasks,
        ]);
      }
    },
  );
  const addManualRepo = useAction(api.github_http.addManualRepo);

  const branchesQuery = useQuery({
    ...branchesQueryOptions({
      teamSlugOrId,
      repoFullName: selectedProject[0] || "",
    }),
    enabled: !!selectedProject[0] && !selectedProject[0].startsWith("env:"),
  });

  const branchSummary = useMemo(() => {
    const data = branchesQuery.data;
    if (!data?.branches) {
      return { names: [] as string[], defaultName: undefined as string | undefined };
    }
    const names = data.branches.map((branch) => branch.name);
    const fromResponse = data.defaultBranch?.trim();
    const flaggedDefault = data.branches.find((branch) => branch.isDefault)?.name;
    const normalizedFromResponse =
      fromResponse && names.includes(fromResponse) ? fromResponse : undefined;
    const normalizedFlagged =
      flaggedDefault && names.includes(flaggedDefault) ? flaggedDefault : undefined;

    return {
      names,
      defaultName: normalizedFromResponse ?? normalizedFlagged,
    };
  }, [branchesQuery.data]);

  const branchNames = branchSummary.names;
  const remoteDefaultBranch = branchSummary.defaultName;

  const handleProjectSearchPaste = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return false;
      }
      try {
        const result = await addManualRepo({
          teamSlugOrId,
          repoUrl: trimmed,
        });
        if (result?.success) {
          await reposByOrgQuery.refetch();
          localStorage.setItem(
            `selectedProject-${teamSlugOrId}`,
            JSON.stringify([result.fullName]),
          );
          setSelectedProject([result.fullName]);
          setIsCloudMode(false);
          localStorage.setItem("isCloudMode", JSON.stringify(false));
          return true;
        }
      } catch (error) {
        console.error("Failed to add repo manually", error);
      }
      toast.error("Unable to add that repository");
      return false;
    },
    [addManualRepo, reposByOrgQuery, teamSlugOrId],
  );

  const isEnvSelected = useMemo(
    () => (selectedProject[0] || "").startsWith("env:"),
    [selectedProject],
  );

  useEffect(() => {
    if (!preselectedEnvironmentId) {
      return;
    }
    const val = `env:${preselectedEnvironmentId}`;
    setSelectedProject([val]);
    localStorage.setItem(`selectedProject-${teamSlugOrId}`, JSON.stringify([val]));
    setIsCloudMode(true);
    localStorage.setItem("isCloudMode", JSON.stringify(true));
  }, [preselectedEnvironmentId, teamSlugOrId]);

  const environmentsQuery = useQuery(
    convexQuery(api.environments.list, { teamSlugOrId }),
  );

  const projectOptions = useMemo(() => {
    const repoDocs = Object.values(reposByOrg || {}).flatMap((repos) => repos);
    const uniqueRepos = repoDocs.reduce((acc, repo) => {
      const existing = acc.get(repo.fullName);
      if (!existing) {
        acc.set(repo.fullName, repo);
        return acc;
      }
      const existingActivity =
        existing.lastPushedAt ?? Number.NEGATIVE_INFINITY;
      const candidateActivity = repo.lastPushedAt ?? Number.NEGATIVE_INFINITY;
      if (candidateActivity > existingActivity) {
        acc.set(repo.fullName, repo);
      }
      return acc;
    }, new Map<string, Doc<"repos">>());
    const sortedRepos = Array.from(uniqueRepos.values()).sort((a, b) => {
      const aPushedAt = a.lastPushedAt ?? Number.NEGATIVE_INFINITY;
      const bPushedAt = b.lastPushedAt ?? Number.NEGATIVE_INFINITY;
      if (aPushedAt !== bPushedAt) {
        return bPushedAt - aPushedAt;
      }
      return a.fullName.localeCompare(b.fullName);
    });
    const repoOptions = sortedRepos.map((repo) => ({
      label: repo.fullName,
      value: repo.fullName,
      icon: (
        <GitHubIcon className="w-4 h-4 text-neutral-600 dark:text-neutral-300" />
      ),
      iconKey: "github",
    }));

    const envOptions = (environmentsQuery.data || []).map((env) => ({
      label: `${env.name}`,
      value: `env:${env._id}`,
      icon: (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <ServerIcon className="w-4 h-4 text-neutral-600 dark:text-neutral-300" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Environment: {env.name}</TooltipContent>
        </Tooltip>
      ),
      iconKey: "environment",
    }));

    const options: SelectOption[] = [];
    if (envOptions.length > 0) {
      options.push({
        label: "Environments",
        value: "__heading-env",
        heading: true,
      });
      options.push(...envOptions);
    }
    if (repoOptions.length > 0) {
      options.push({
        label: "Repositories",
        value: "__heading-repo",
        heading: true,
      });
      options.push(...repoOptions);
    }

    return options;
  }, [environmentsQuery.data, reposByOrg]);

  const selectedRepoFullName = useMemo(() => {
    if (!selectedProject[0] || isEnvSelected) return null;
    return selectedProject[0];
  }, [selectedProject, isEnvSelected]);

  const branchOptions = useMemo(() => branchNames, [branchNames]);

  useEffect(() => {
    if (!socket) return;

    socket.emit("check-provider-status", (response) => {
      if (!response) return;
      setProviderStatus(response);

      if (response.success) {
        const isRunning = response.dockerStatus?.isRunning;
        if (typeof isRunning === "boolean") {
          setDockerReady(isRunning);
        }
      }

      const currentAgents = selectedAgentsRef.current;
      if (currentAgents.length === 0) {
        return;
      }

      const providers = response.providers;
      if (!providers || providers.length === 0) {
        const normalizedOnly = filterKnownAgents(currentAgents);
        if (normalizedOnly.length !== currentAgents.length) {
          selectedAgentsRef.current = normalizedOnly;
          setSelectedAgentsState(normalizedOnly);
          persistAgentSelection(normalizedOnly);
        }
        return;
      }

      const availableAgents = new Set(
        providers
          .filter((provider) => provider.isAvailable)
          .map((provider) => provider.name),
      );

      const normalizedAgents = filterKnownAgents(currentAgents);
      const removedUnknown = normalizedAgents.length !== currentAgents.length;

      const filteredAgents = normalizedAgents.filter((agent) =>
        availableAgents.has(agent),
      );
      const removedUnavailable = normalizedAgents.filter(
        (agent) => !availableAgents.has(agent),
      );

      if (!removedUnknown && removedUnavailable.length === 0) {
        return;
      }

      selectedAgentsRef.current = filteredAgents;
      setSelectedAgentsState(filteredAgents);
      persistAgentSelection(filteredAgents);

      if (removedUnavailable.length > 0) {
        const uniqueMissing = Array.from(new Set(removedUnavailable));
        if (uniqueMissing.length > 0) {
          const label = uniqueMissing.length === 1 ? "model" : "models";
          const verb = uniqueMissing.length === 1 ? "is" : "are";
          toast.warning(
            `${uniqueMissing.join(", ")} ${verb} not configured and was removed from the selection. Update credentials in Settings to use this ${label}.`,
          );
        }
      }
    });
  }, [persistAgentSelection, socket]);

  useEffect(() => {
    if (!socket) return;

    const interval = setInterval(() => {
      socket.emit("check-provider-status", (response) => {
        if (!response) return;
        setProviderStatus(response);

        if (response.success) {
          const isRunning = response.dockerStatus?.isRunning;
          if (typeof isRunning === "boolean") {
            setDockerReady(isRunning);
          }
        }
      });
    }, 5000);

    const handleFocus = () => {
      socket.emit("check-provider-status", (response) => {
        if (!response) return;
        setProviderStatus(response);

        if (response.success) {
          const isRunning = response.dockerStatus?.isRunning;
          if (typeof isRunning === "boolean") {
            setDockerReady(isRunning);
          }
        }
      });
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [socket]);

  const effectiveSelectedBranch = useMemo(() => {
    if (selectedBranch.length > 0) {
      return selectedBranch;
    }
    if (branchNames.length === 0) {
      return [];
    }
    const fallbackBranch = branchNames.includes("main")
      ? "main"
      : branchNames.includes("master")
        ? "master"
        : branchNames[0];
    const preferredBranch =
      remoteDefaultBranch && branchNames.includes(remoteDefaultBranch)
        ? remoteDefaultBranch
        : fallbackBranch;
    return [preferredBranch];
  }, [selectedBranch, branchNames, remoteDefaultBranch]);

  const handleStartTask = useCallback(async () => {
    if (!selectedProject[0] || !taskDescription.trim()) {
      console.error("Please select a project and enter a task description");
      return;
    }
    if (!socket) {
      console.error("Socket not connected");
      return;
    }

    if (!isEnvSelected && !isCloudMode) {
      const ready = await new Promise<boolean>((resolve) => {
        socket.emit("check-provider-status", (response) => {
          const isRunning = !!response?.dockerStatus?.isRunning;
          if (typeof isRunning === "boolean") {
            setDockerReady(isRunning);
          }
          resolve(isRunning);
        });
      });

      if (!ready) {
        toast.error("Docker is not running. Start Docker Desktop.");
        return;
      }
    }

    const branch = effectiveSelectedBranch[0];
    const projectFullName = selectedProject[0];
    const envSelected = projectFullName.startsWith("env:");
    const environmentId = envSelected
      ? (projectFullName.replace(/^env:/, "") as Id<"environments">)
      : undefined;

    try {
      const content = editorApiRef.current?.getContent();
      const images = content?.images || [];

      const uploadedImages = await Promise.all(
        images.map(
          async (image: {
            src: string;
            fileName?: string;
            altText: string;
          }) => {
            const base64Data = image.src.split(",")[1] || image.src;
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: "image/png" });
            const uploadUrl = await generateUploadUrl({
              teamSlugOrId,
            });
            const result = await fetch(uploadUrl, {
              method: "POST",
              headers: { "Content-Type": blob.type },
              body: blob,
            });
            const { storageId } = await result.json();

            return {
              storageId,
              fileName: image.fileName,
              altText: image.altText,
            };
          },
        ),
      );

      setTaskDescription("");
      handleTaskDescriptionChange("");
      if (editorApiRef.current?.clear) {
        editorApiRef.current.clear();
      }

      const taskId = await createTask({
        teamSlugOrId,
        text: content?.text || taskDescription,
        projectFullName: envSelected ? undefined : projectFullName,
        baseBranch: envSelected ? undefined : branch,
        images: uploadedImages.length > 0 ? uploadedImages : undefined,
        environmentId,
      });

      addTaskToExpand(taskId);

      const repoUrl = envSelected
        ? undefined
        : `https://github.com/${projectFullName}.git`;

      const handleStartTaskAck = (
        response: TaskAcknowledged | TaskStarted | TaskError,
      ) => {
        if ("error" in response) {
          console.error("Task start error:", response.error);
          toast.error(`Task start error: ${JSON.stringify(response.error)}`);
          return;
        }

        attachTaskLifecycleListeners(socket, response.taskId, {
          onStarted: (payload) => {
            console.log("Task started:", payload);
          },
          onFailed: (payload) => {
            toast.error(`Task failed to start: ${payload.error}`);
          },
        });
        console.log("Task acknowledged:", response);
      };

      socket.emit(
        "start-task",
        {
          ...(repoUrl ? { repoUrl } : {}),
          ...(envSelected ? {} : { branch }),
          taskDescription: content?.text || taskDescription,
          projectFullName,
          taskId,
          selectedAgents:
            selectedAgents.length > 0 ? selectedAgents : undefined,
          isCloudMode: envSelected ? true : isCloudMode,
          ...(environmentId ? { environmentId } : {}),
          images: images.length > 0 ? images : undefined,
          theme,
        },
        handleStartTaskAck,
      );

      onTaskStarted?.();
      console.log("Task created:", taskId);
    } catch (error) {
      console.error("Error starting task:", error);
    }
  }, [
    addTaskToExpand,
    createTask,
    effectiveSelectedBranch,
    generateUploadUrl,
    handleTaskDescriptionChange,
    isCloudMode,
    selectedAgents,
    selectedProject,
    socket,
    taskDescription,
    teamSlugOrId,
    theme,
  ]);

  const lexicalEnvironmentId = useMemo(() => {
    if (!selectedProject[0] || !isEnvSelected) return undefined;
    return selectedProject[0].replace(/^env:/, "") as Id<"environments">;
  }, [selectedProject, isEnvSelected]);

  const lexicalRepoUrl = useMemo(() => {
    if (!selectedProject[0]) return undefined;
    if (isEnvSelected) return undefined;
    return `https://github.com/${selectedProject[0]}.git`;
  }, [selectedProject, isEnvSelected]);

  const lexicalBranch = useMemo(
    () => effectiveSelectedBranch[0],
    [effectiveSelectedBranch],
  );

  const canSubmit = useMemo(() => {
    if (!selectedProject[0]) return false;
    if (!taskDescription.trim()) return false;
    if (selectedAgents.length === 0) return false;
    if (isEnvSelected) return true;
    return !!effectiveSelectedBranch[0];
  }, [
    effectiveSelectedBranch,
    isEnvSelected,
    selectedAgents,
    selectedProject,
    taskDescription,
  ]);

  const shouldShowWorkspaceSetup = !!selectedRepoFullName && !isEnvSelected;

  return (
    <div className={clsx("space-y-6", className)}>
      {showWorkspaceCreationButtons ? (
        <WorkspaceCreationButtons
          teamSlugOrId={teamSlugOrId}
          selectedProject={selectedProject}
          isEnvSelected={isEnvSelected}
        />
      ) : null}

      <DashboardMainCard
        editorApiRef={editorApiRef}
        onTaskDescriptionChange={handleTaskDescriptionChange}
        onSubmit={() => {
          if (selectedProject[0] && taskDescription.trim()) {
            void handleStartTask();
          }
        }}
        lexicalRepoUrl={lexicalRepoUrl}
        lexicalEnvironmentId={lexicalEnvironmentId}
        lexicalBranch={lexicalBranch}
        projectOptions={projectOptions}
        selectedProject={selectedProject}
        onProjectChange={handleProjectChange}
        onProjectSearchPaste={handleProjectSearchPaste}
        branchOptions={branchOptions}
        selectedBranch={effectiveSelectedBranch}
        onBranchChange={handleBranchChange}
        selectedAgents={selectedAgents}
        onAgentChange={handleAgentChange}
        isCloudMode={isCloudMode}
        onCloudModeToggle={handleCloudModeToggle}
        isLoadingProjects={reposByOrgQuery.isLoading}
        isLoadingBranches={branchesQuery.isPending}
        teamSlugOrId={teamSlugOrId}
        cloudToggleDisabled={isEnvSelected}
        branchDisabled={isEnvSelected || !selectedProject[0]}
        providerStatus={providerStatus}
        canSubmit={canSubmit}
        onStartTask={() => void handleStartTask()}
        editorPersistenceKey={editorPersistenceKey}
        maxEditorHeight={maxEditorHeight}
      />

      {showWorkspaceSetupPanel && shouldShowWorkspaceSetup ? (
        <WorkspaceSetupPanel
          teamSlugOrId={teamSlugOrId}
          projectFullName={selectedRepoFullName}
        />
      ) : null}
    </div>
  );
}

type DashboardMainCardProps = {
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
  editorPersistenceKey: string;
  maxEditorHeight: string;
};

function DashboardMainCard({
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
  editorPersistenceKey,
  maxEditorHeight,
}: DashboardMainCardProps) {
  return (
    <div className="relative bg-white dark:bg-neutral-700/50 border border-neutral-500/15 dark:border-neutral-500/15 rounded-2xl transition-all">
      <DashboardInput
        ref={editorApiRef}
        onTaskDescriptionChange={onTaskDescriptionChange}
        onSubmit={onSubmit}
        repoUrl={lexicalRepoUrl}
        environmentId={lexicalEnvironmentId}
        branch={lexicalBranch}
        persistenceKey={editorPersistenceKey}
        maxHeight={maxEditorHeight}
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
        <DashboardStartTaskButton canSubmit={canSubmit} onStartTask={onStartTask} />
      </DashboardInputFooter>
    </div>
  );
}
