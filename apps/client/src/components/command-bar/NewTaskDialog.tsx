import { GitHubIcon } from "@/components/icons/github";
import { Button } from "@/components/ui/button";
import SearchableSelect, {
  type SelectOption,
} from "@/components/ui/searchable-select";
import { branchesQueryOptions } from "@/queries/branches";
import { attachTaskLifecycleListeners } from "@/lib/socket/taskLifecycleListeners";
import type { CmuxSocket } from "@/contexts/socket/types";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { AGENT_CONFIGS } from "@cmux/shared/agentConfig";
import { Switch } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { toast } from "sonner";
import { Loader2, Server, X } from "lucide-react";
import type { LocalWorkspaceOption } from "./types";
import type { TaskAcknowledged, TaskError, TaskStarted } from "@cmux/shared";

type CreateTaskArgs = {
  teamSlugOrId: string;
  text: string;
  description?: string;
  projectFullName?: string;
  baseBranch?: string;
  worktreePath?: string;
  images?: Array<{
    storageId: Id<"_storage">;
    fileName?: string;
    altText: string;
  }>;
  environmentId?: Id<"environments">;
  isCloudWorkspace?: boolean;
};

interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamSlugOrId: string;
  localWorkspaceOptions: LocalWorkspaceOption[];
  environments: Doc<"environments">[] | undefined;
  isProjectListLoading: boolean;
  createTask: (args: CreateTaskArgs) => Promise<Id<"tasks">>;
  addTaskToExpand: (taskId: Id<"tasks">) => void;
  socket: CmuxSocket | null;
  theme: "light" | "dark" | "system";
}

const DEFAULT_AGENTS = [
  "claude/sonnet-4.5",
  "claude/opus-4.1",
  "codex/gpt-5-codex-high",
];

const KNOWN_AGENT_NAMES = new Set(AGENT_CONFIGS.map((agent) => agent.name));

const AGENT_SELECTION_KEY = "selectedAgents";

const CLOUD_MODE_KEY = "isCloudMode";

function parseStoredAgentSelection(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (agent): agent is string =>
          typeof agent === "string" && KNOWN_AGENT_NAMES.has(agent)
      );
    }
    return [];
  } catch {
    return [];
  }
}

function readStoredAgents(): string[] {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem(AGENT_SELECTION_KEY);
  const parsed = parseStoredAgentSelection(stored);
  if (parsed.length > 0) {
    return parsed;
  }
  return DEFAULT_AGENTS.filter((agent) => KNOWN_AGENT_NAMES.has(agent));
}

function readStoredProject(teamSlugOrId: string): string[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(`selectedProject-${teamSlugOrId}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function readStoredCloudMode(): boolean {
  if (typeof window === "undefined") return true;
  const raw = localStorage.getItem(CLOUD_MODE_KEY);
  if (!raw) return true;
  try {
    return JSON.parse(raw);
  } catch {
    return true;
  }
}

export function NewTaskDialog({
  open,
  onOpenChange,
  teamSlugOrId,
  localWorkspaceOptions,
  environments,
  isProjectListLoading,
  createTask,
  addTaskToExpand,
  socket,
  theme,
}: NewTaskDialogProps) {
  const [selectedProject, setSelectedProject] = useState<string[]>(() =>
    readStoredProject(teamSlugOrId)
  );
  const [branch, setBranch] = useState("");
  const [branchDirty, setBranchDirty] = useState(false);
  const [taskDescription, setTaskDescription] = useState("");
  const [isCloudMode, setIsCloudMode] = useState(() => readStoredCloudMode());
  const [selectedAgents, setSelectedAgents] = useState<string[]>(() =>
    readStoredAgents()
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) {
      setTaskDescription("");
      setError(null);
      setIsSubmitting(false);
      setBranchDirty(false);
    } else {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  }, [open]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      `selectedProject-${teamSlugOrId}`,
      JSON.stringify(selectedProject)
    );
  }, [selectedProject, teamSlugOrId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedAgents.length === 0) {
      localStorage.removeItem(AGENT_SELECTION_KEY);
    } else {
      localStorage.setItem(AGENT_SELECTION_KEY, JSON.stringify(selectedAgents));
    }
  }, [selectedAgents]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(CLOUD_MODE_KEY, JSON.stringify(isCloudMode));
  }, [isCloudMode]);

  const projectOptions = useMemo<SelectOption[]>(() => {
    const envOptions =
      environments?.map((env) => ({
        label: env.name,
        value: `env:${env._id}`,
        icon: <Server className="w-4 h-4 text-emerald-500" aria-hidden />,
        iconKey: "environment",
      })) ?? [];

    const repoOptions = localWorkspaceOptions.map((repo) => ({
      label: repo.fullName,
      value: repo.fullName,
      icon: (
        <GitHubIcon
          className="w-4 h-4 text-neutral-600 dark:text-neutral-300"
          aria-hidden
        />
      ),
      iconKey: "repo",
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
  }, [environments, localWorkspaceOptions]);

  const selectedProjectValue = selectedProject[0] ?? "";
  const isEnvironment = selectedProjectValue.startsWith("env:");
  const environmentId = isEnvironment
    ? (selectedProjectValue.replace(/^env:/, "") as Id<"environments">)
    : undefined;

  const selectedRepoFullName = !isEnvironment && selectedProjectValue
    ? selectedProjectValue
    : null;

  const branchesQuery = useQuery({
    ...branchesQueryOptions({
      teamSlugOrId,
      repoFullName: selectedRepoFullName ?? "",
    }),
    enabled: Boolean(selectedRepoFullName),
  });

  const branchOptions = useMemo(() => {
    return branchesQuery.data?.branches?.map((branchOption) => branchOption.name) ?? [];
  }, [branchesQuery.data?.branches]);

  const remoteDefaultBranch = useMemo(() => {
    const data = branchesQuery.data;
    if (!data?.branches) return undefined;
    const fromResponse = data.defaultBranch?.trim();
    const flaggedDefault = data.branches.find((b) => b.isDefault)?.name;
    if (fromResponse && branchOptions.includes(fromResponse)) {
      return fromResponse;
    }
    if (flaggedDefault && branchOptions.includes(flaggedDefault)) {
      return flaggedDefault;
    }
    return undefined;
  }, [branchOptions, branchesQuery.data]);

  useEffect(() => {
    if (isEnvironment) {
      setBranch("");
      setBranchDirty(false);
      return;
    }
    if (!selectedRepoFullName) {
      setBranch("");
      setBranchDirty(false);
      return;
    }
    if (branchDirty) return;
    if (remoteDefaultBranch) {
      setBranch(remoteDefaultBranch);
      return;
    }
    if (!branch) {
      setBranch("main");
    }
  }, [
    branch,
    branchDirty,
    isEnvironment,
    remoteDefaultBranch,
    selectedRepoFullName,
  ]);

  const projectIsReady = Boolean(projectOptions.length);

  const agentOptions = useMemo<SelectOption[]>(() => {
    return AGENT_CONFIGS.map((agent) => ({
      label: agent.name,
      value: agent.name,
    }));
  }, []);

  const handleProjectChange = useCallback((values: string[]) => {
    setSelectedProject(values);
    setBranchDirty(false);
  }, []);

  const handleBranchChange = useCallback(
    (value: string) => {
      setBranch(value);
      setBranchDirty(true);
    },
    []
  );

  const handleAgentsChange = useCallback((agents: string[]) => {
    const filtered = agents.filter((agent) => KNOWN_AGENT_NAMES.has(agent));
    setSelectedAgents(filtered);
  }, []);

  const handleVerifyLocal = useCallback(async () => {
    if (!socket) {
      toast.error("Socket is not connected. Try again in a moment.");
      return false;
    }
    return await new Promise<boolean>((resolve) => {
      socket.emit("check-provider-status", (response: { dockerStatus?: { isRunning?: boolean } }) => {
        resolve(Boolean(response?.dockerStatus?.isRunning));
      });
    });
  }, [socket]);

  const handleSubmit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (isSubmitting) return;
      const projectValue = selectedProjectValue;
      const trimmedDescription = taskDescription.trim();
      if (!projectValue) {
        setError("Select a repository or environment.");
        return;
      }
      if (!trimmedDescription) {
        setError("Enter a task description.");
        return;
      }
      if (!isEnvironment && !branch.trim()) {
        setError("Enter a branch to base the task on.");
        return;
      }
      if (!socket) {
        setError("Socket is not connected. Try again shortly.");
        return;
      }
      if (!isEnvironment && !isCloudMode) {
        const ready = await handleVerifyLocal();
        if (!ready) {
          toast.error("Docker is not running. Start Docker Desktop or switch to cloud mode.");
          return;
        }
      }

      setIsSubmitting(true);
      setError(null);

      try {
        const taskId = await createTask({
          teamSlugOrId,
          text: trimmedDescription,
          projectFullName: isEnvironment ? undefined : projectValue,
          baseBranch: isEnvironment ? undefined : branch.trim(),
          environmentId,
        });

        addTaskToExpand(taskId);

        await new Promise<void>((resolve, reject) => {
          socket.emit(
            "start-task",
            {
              ...(isEnvironment
                ? {}
                : {
                    repoUrl: `https://github.com/${projectValue}.git`,
                    branch: branch.trim(),
                  }),
              taskDescription: trimmedDescription,
              projectFullName: projectValue,
              taskId,
              selectedAgents:
                selectedAgents.length > 0 ? selectedAgents : undefined,
              isCloudMode: isEnvironment ? true : isCloudMode,
              ...(environmentId ? { environmentId } : {}),
              theme,
            },
            (response: TaskAcknowledged | TaskStarted | TaskError) => {
              if ("error" in response) {
                reject(
                  new Error(
                    typeof response.error === "string"
                      ? response.error
                      : "Failed to start task"
                  )
                );
                return;
              }

              attachTaskLifecycleListeners(socket, response.taskId, {
                onFailed: (payload) => {
                  toast.error(`Task failed to start: ${payload.error}`);
                },
              });
              resolve();
            }
          );
        });

        toast.success("Task started");
        setTaskDescription("");
        setBranchDirty(false);
        onOpenChange(false);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to start task";
        setError(message);
        toast.error(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      addTaskToExpand,
      branch,
      createTask,
      environmentId,
      handleVerifyLocal,
      isCloudMode,
      isEnvironment,
      isSubmitting,
      onOpenChange,
      selectedAgents,
      selectedProjectValue,
      socket,
      taskDescription,
      teamSlugOrId,
      theme,
    ]
  );

  const canSubmit =
    Boolean(selectedProjectValue) &&
    Boolean(taskDescription.trim()) &&
    (isEnvironment || Boolean(branch.trim()));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[var(--z-modal)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[var(--z-modal)] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-start justify-between gap-6">
            <div>
              <Dialog.Title className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
                New task
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                Choose a repository or environment, describe the task, and we’ll start it right away.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-full p-1 text-neutral-500 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:text-neutral-400 dark:hover:text-neutral-200"
              >
                <span className="sr-only">Close</span>
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                Project
              </label>
              <SearchableSelect
                options={projectOptions}
                value={selectedProject}
                onChange={handleProjectChange}
                placeholder="Select a repository or environment"
                singleSelect
                loading={isProjectListLoading && !projectIsReady}
                maxTagCount={1}
                className="w-full"
              />
              {!projectIsReady && isProjectListLoading ? (
                <p className="text-xs text-neutral-500">Loading projects…</p>
              ) : null}
              {!projectIsReady && !isProjectListLoading ? (
                <p className="text-xs text-neutral-500">
                  Connect a GitHub repository or environment to start tasks.
                </p>
              ) : null}
            </div>

            {!isEnvironment ? (
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                  Base branch
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={branch}
                    onChange={(event) => handleBranchChange(event.target.value)}
                    placeholder="main"
                    className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-neutral-600 dark:focus:ring-neutral-800"
                  />
                  {branchesQuery.isFetching ? (
                    <Loader2 className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-neutral-400" />
                  ) : null}
                </div>
                {branchOptions.length > 0 ? (
                  <p className="text-xs text-neutral-500">
                    Suggestions: {branchOptions.slice(0, 4).join(", ")}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-300">
                Environment tasks always run in cloud mode; branch selection isn’t required.
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                Task description
              </label>
              <textarea
                ref={textareaRef}
                value={taskDescription}
                onChange={(event) => setTaskDescription(event.target.value)}
                placeholder="Describe what you’d like the agents to do…"
                className="w-full min-h-[140px] rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-neutral-600 dark:focus:ring-neutral-800"
                onKeyDown={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter"
                  ) {
                    void handleSubmit();
                  }
                }}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                  Agents
                </label>
                <SearchableSelect
                  options={agentOptions}
                  value={selectedAgents}
                  onChange={handleAgentsChange}
                  placeholder="Select agents"
                  className="w-full"
                  maxTagCount={3}
                  maxCountPerValue={1}
                />
                <p className="text-xs text-neutral-500">
                  No selection uses the default workspace configuration.
                </p>
              </div>

              <div className="space-y-2 rounded-lg border border-neutral-200 px-3 py-3 dark:border-neutral-700">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                      Run in cloud
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Tasks run on cmux infrastructure. Required for environments.
                    </p>
                  </div>
                  <Switch
                    isDisabled={isEnvironment}
                    isSelected={isEnvironment ? true : isCloudMode}
                    onValueChange={(value) => setIsCloudMode(value)}
                  />
                </div>
                {!isEnvironment ? (
                  <ul className="mt-2 list-disc pl-4 text-xs text-neutral-500 dark:text-neutral-400">
                    <li>Disable to run against your local Docker setup.</li>
                  </ul>
                ) : null}
              </div>
            </div>

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-3 pt-2">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="ml-2">Starting…</span>
                  </>
                ) : (
                  "Start task"
                )}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
