import { AgentLogo } from "@/components/icons/agent-logos";
import {
  AgentToggleButton,
  McpCustomEditor,
  SegmentedTabs,
} from "@/components/mcp/McpFormSections";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getElectronBridge, isElectron } from "@/lib/electron";
import { McpMergedPreview } from "./McpMergedPreview";
import {
  deriveEffectiveMcpConfigsByAgent,
  getWorkspacePreviewProjects,
  type McpPreviewAgent,
} from "./mcp-preview-helpers";
import {
  AGENT_OPTIONS,
  buildEnabledAgentState,
  buildFormFromConfig,
  buildEmptyForm,
  buildJsonConfigText,
  countEnabledAgents,
  DEFAULT_SCOPE_OPTIONS,
  formatMcpServerTarget,
  getErrorMessage,
  getScopeOptions,
  getScopedProjectFullName,
  getTransportPayload,
  getTransportType,
  type AgentField,
  type FormState,
  parseEnvVarsText,
  parseJsonConfigText,
  shouldRebuildJsonConfig,
  type McpServerConfig,
  type Scope,
  validateForm,
} from "@/lib/mcp-form-helpers";
import { api } from "@cmux/convex/api";
import {
  buildMergedClaudePreview,
  buildMergedCodexPreview,
  buildMergedOpencodePreview,
} from "@cmux/shared";
import { convexQuery } from "@convex-dev/react-query";
import { env } from "@/client-env";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useConvex } from "convex/react";
import { Loader2, Pencil, Plug, Trash2, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

interface McpServersSectionProps {
  teamSlugOrId: string;
}

export function McpServersSection({
  teamSlugOrId,
}: McpServersSectionProps) {
  const convex = useConvex();
  const [activeScope, setActiveScope] = useState<Scope>("global");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<McpServerConfig | null>(null);
  const [form, setForm] = useState<FormState>(buildEmptyForm("global"));
  const [jsonConfigText, setJsonConfigText] = useState(() =>
    buildJsonConfigText(buildEmptyForm("global")),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<McpServerConfig | null>(null);
  const [activePreviewAgent, setActivePreviewAgent] = useState<McpPreviewAgent>("claude");
  const [workspacePreviewProject, setWorkspacePreviewProject] = useState<string>("");

  const { data: configs, refetch, isLoading } = useQuery(
    convexQuery(api.mcpServerConfigs.list, { teamSlugOrId }),
  );

  const { data: claudeHostConfig } = useQuery({
    queryKey: ["mcp-host-config", "claude"],
    enabled: isElectron,
    queryFn: async () => {
      const bridge = getElectronBridge();
      return bridge?.mcpHostConfig?.readClaudeJson() ?? null;
    },
  });

  const { data: codexHostConfig } = useQuery({
    queryKey: ["mcp-host-config", "codex"],
    enabled: isElectron,
    queryFn: async () => {
      const bridge = getElectronBridge();
      return bridge?.mcpHostConfig?.readCodexToml() ?? null;
    },
  });

  const { data: opencodeHostConfig } = useQuery({
    queryKey: ["mcp-host-config", "opencode"],
    enabled: isElectron,
    queryFn: async () => {
      const bridge = getElectronBridge();
      return bridge?.mcpHostConfig?.readOpencodeJson() ?? null;
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (
      payload: Parameters<typeof convex.mutation<typeof api.mcpServerConfigs.upsert>>[1],
    ) => {
      return await convex.mutation(api.mcpServerConfigs.upsert, payload);
    },
    onSuccess: async () => {
      await refetch();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: McpServerConfig["_id"]) => {
      return await convex.mutation(api.mcpServerConfigs.remove, {
        teamSlugOrId,
        id,
      });
    },
    onSuccess: async () => {
      await refetch();
    },
  });

  const visibleConfigs = useMemo(
    () => (configs ?? []).filter((config) => config.scope === activeScope),
    [activeScope, configs],
  );

  const counts = useMemo(() => {
    const nextCounts = { global: 0, workspace: 0 } satisfies Record<Scope, number>;

    for (const config of configs ?? []) {
      nextCounts[config.scope] += 1;
    }

    return nextCounts;
  }, [configs]);

  const workspacePreviewProjects = useMemo(
    () => getWorkspacePreviewProjects(configs ?? []),
    [configs],
  );

  const effectiveWorkspacePreviewProject =
    activeScope !== "workspace"
      ? ""
      : workspacePreviewProject && workspacePreviewProjects.includes(workspacePreviewProject)
        ? workspacePreviewProject
        : workspacePreviewProjects[0] || "";

  const previewConfigsByAgent = useMemo(
    () =>
      deriveEffectiveMcpConfigsByAgent(
        configs ?? [],
        activeScope,
        effectiveWorkspacePreviewProject,
        { includeBuiltins: env.NEXT_PUBLIC_WEB_MODE },
      ),
    [activeScope, configs, effectiveWorkspacePreviewProject],
  );

  const claudePreviewConfigs = previewConfigsByAgent.claude;
  const codexPreviewConfigs = previewConfigsByAgent.codex;
  const opencodePreviewConfigs = previewConfigsByAgent.opencode;

  const activePreviewText = useMemo(() => {
    const claudePreviewHostConfigText = !env.NEXT_PUBLIC_WEB_MODE && claudeHostConfig?.ok
      ? claudeHostConfig.content
      : undefined;
    const codexPreviewHostConfigText = !env.NEXT_PUBLIC_WEB_MODE && codexHostConfig?.ok
      ? codexHostConfig.content
      : undefined;
    const opencodePreviewHostConfigText = !env.NEXT_PUBLIC_WEB_MODE && opencodeHostConfig?.ok
      ? opencodeHostConfig.content
      : undefined;

    if (activePreviewAgent === "claude") {
      return buildMergedClaudePreview({
        hostConfigText: claudePreviewHostConfigText,
        mcpServerConfigs: claudePreviewConfigs,
      });
    }

    if (activePreviewAgent === "codex") {
      return buildMergedCodexPreview({
        hostConfigText: codexPreviewHostConfigText,
        mcpServerConfigs: codexPreviewConfigs,
      });
    }

    return buildMergedOpencodePreview({
      hostConfigText: opencodePreviewHostConfigText,
      mcpServerConfigs: opencodePreviewConfigs,
    });
  }, [
    activePreviewAgent,
    claudeHostConfig,
    claudePreviewConfigs,
    codexHostConfig,
    codexPreviewConfigs,
    opencodeHostConfig,
    opencodePreviewConfigs,
  ]);

  const scopeOptions = useMemo(() => getScopeOptions(counts), [counts]);

  const handleScopeChange = useCallback((scope: Scope) => {
    setActiveScope(scope);
    if (scope === "global") {
      setWorkspacePreviewProject("");
      return;
    }

    setWorkspacePreviewProject((current) => current || workspacePreviewProjects[0] || "");
  }, [workspacePreviewProjects]);

  const enabledCounts = useMemo(
    () => countEnabledAgents(visibleConfigs),
    [visibleConfigs],
  );

  const pendingMutationKey =
    upsertMutation.isPending && upsertMutation.variables
      ? `${upsertMutation.variables.name}:${upsertMutation.variables.scope}`
      : null;

  const updateCustomEditorForm = useCallback(
    <K extends keyof FormState,>(field: K, value: FormState[K]) => {
      setForm((current) => {
        const next = {
          ...current,
          [field]: value,
        };
        if (shouldRebuildJsonConfig(field)) {
          setJsonConfigText(buildJsonConfigText(next));
        }
        return next;
      });
      setFormError(null);
    },
    [],
  );

  const updateJsonConfig = useCallback((value: string) => {
    setJsonConfigText(value);
    setFormError(null);
  }, []);

  const resetDialog = useCallback(() => {
    setDialogOpen(false);
    setEditingConfig(null);
    setForm(buildEmptyForm(activeScope));
    setFormError(null);
  }, [activeScope]);

  const openEditDialog = useCallback((config: McpServerConfig) => {
    const nextForm = buildFormFromConfig(config);
    setEditingConfig(config);
    setForm(nextForm);
    setJsonConfigText(buildJsonConfigText(nextForm));
    setFormError(null);
    setDialogOpen(true);
  }, []);

  const handleSaveCustom = async () => {
    const nextForm = (() => {
      const parsedJson = parseJsonConfigText(jsonConfigText);
      if (parsedJson.error) {
        setFormError(parsedJson.error);
        return null;
      }

      return {
        ...form,
        transportType: parsedJson.transportType,
        command: parsedJson.command,
        argsText: parsedJson.argsText,
        url: parsedJson.url,
        headersText: parsedJson.headersText,
        envVarsText: parsedJson.envVarsText,
      } satisfies FormState;
    })();

    if (!nextForm) {
      return;
    }

    const validationError = validateForm(nextForm);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    if (nextForm !== form) {
      setForm(nextForm);
    }

    const parsedEnvVars = parseEnvVarsText(nextForm.envVarsText);

    try {
      await upsertMutation.mutateAsync({
        teamSlugOrId,
        name: nextForm.name.trim(),
        displayName: nextForm.displayName.trim(),
        ...getTransportPayload(nextForm),
        ...(parsedEnvVars.hasChanges ? { envVars: parsedEnvVars.envVars } : {}),
        description: nextForm.description.trim() || undefined,
        enabledClaude: nextForm.enabledClaude,
        enabledCodex: nextForm.enabledCodex,
        enabledGemini: nextForm.enabledGemini,
        enabledOpencode: nextForm.enabledOpencode,
        scope: nextForm.scope,
        projectFullName: getScopedProjectFullName(
          nextForm.scope,
          nextForm.projectFullName,
        ),
      });
      toast.success("MCP server updated");
      resetDialog();
    } catch (error) {
      const message = getErrorMessage(error, "Failed to save MCP server.");
      setFormError(message);
      toast.error(message);
    }
  };

  const handleToggleAgent = async (
    config: McpServerConfig,
    field: AgentField,
    nextValue: boolean,
  ) => {
    try {
      const transportType = getTransportType(config);

      await upsertMutation.mutateAsync({
        teamSlugOrId,
        name: config.name,
        displayName: config.displayName,
        ...getTransportPayload({
          transportType,
          command: config.command ?? "",
          argsText: (config.args ?? []).join("\n"),
          url: config.url ?? "",
          headersText: config.headers
            ? Object.entries(config.headers)
                .map(([key, value]) => `${key}: ${value}`)
                .join("\n")
            : "",
        }),
        ...(config.envVars ? { envVars: config.envVars } : {}),
        description: config.description,
        tags: config.tags,
        ...buildEnabledAgentState(config, field, nextValue),
        scope: config.scope,
        projectFullName: config.projectFullName,
      });
      toast.success(`${config.displayName} updated`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to update MCP server."));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }

    try {
      await deleteMutation.mutateAsync(deleteTarget._id);
      toast.success(`${deleteTarget.displayName} deleted`);
      setDeleteTarget(null);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to delete MCP server."));
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-medium text-neutral-900 dark:text-neutral-100">
                MCP Servers
              </h2>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                Manage shared and workspace-specific MCP servers for your team.
              </p>
            </div>
            <Button size="sm" asChild>
              <Link
                to="/$teamSlugOrId/settings/add-mcp-server"
                params={{ teamSlugOrId }}
                search={{ section: "mcp-servers" }}
              >
                Add MCP
              </Link>
            </Button>
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white px-3 py-3 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="inline-flex h-7 items-center rounded-full border border-neutral-200 bg-neutral-50 px-3 text-sm font-medium text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300">
                  {visibleConfigs.length} total
                </span>
                {AGENT_OPTIONS.map((agent) => (
                  <span
                    key={agent.key}
                    className="inline-flex h-7 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 text-xs font-medium text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
                  >
                    <AgentLogo agentName={`${agent.key}/ui`} className="size-3.5" />
                    <span>{agent.label}</span>
                    <span className="text-neutral-900 dark:text-neutral-100">
                      {enabledCounts[agent.key]}
                    </span>
                  </span>
                ))}
              </div>

              <SegmentedTabs
                value={activeScope}
                onChange={handleScopeChange}
                options={scopeOptions}
              />
            </div>
          </div>

          {isElectron || env.NEXT_PUBLIC_WEB_MODE ? (
            <McpMergedPreview
              activeAgent={activePreviewAgent}
              onActiveAgentChange={setActivePreviewAgent}
              previewText={activePreviewText}
              claudeHostConfig={claudeHostConfig ?? null}
              codexHostConfig={codexHostConfig ?? null}
              opencodeHostConfig={opencodeHostConfig ?? null}
              scope={activeScope}
              workspaceProjectFullName={
                activeScope === "workspace" ? effectiveWorkspacePreviewProject : undefined
              }
              workspaceProjects={workspacePreviewProjects}
              selectedWorkspaceProject={effectiveWorkspacePreviewProject}
              onWorkspaceProjectChange={setWorkspacePreviewProject}
              webMode={env.NEXT_PUBLIC_WEB_MODE}
            />
          ) : null}

          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-neutral-500 dark:text-neutral-400">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : visibleConfigs.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-white px-6 py-12 text-center dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex size-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300">
                <Plug className="size-5" />
              </div>
              <h3 className="mt-4 text-base font-medium text-neutral-900 dark:text-neutral-100">
                No {activeScope} MCP servers
              </h3>
              <p className="mt-2 max-w-md text-sm text-neutral-500 dark:text-neutral-400">
                Add a preset or configure a custom server for this scope.
              </p>
              <Button variant="outline" size="sm" className="mt-4" asChild>
                <Link
                  to="/$teamSlugOrId/settings/add-mcp-server"
                  params={{ teamSlugOrId }}
                  search={{ section: "mcp-servers" }}
                >
                  Add MCP
                </Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              {visibleConfigs.map((config, index) => {
                const isPending =
                  pendingMutationKey === `${config.name}:${config.scope}`;
                const transportType = getTransportType(config);
                const commandLabel = formatMcpServerTarget(config);
                return (
                  <div
                    key={config._id}
                    className={`group flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-neutral-50/80 dark:hover:bg-neutral-950/60 sm:flex-row sm:items-start sm:justify-between ${
                      index < visibleConfigs.length - 1
                        ? "border-b border-neutral-200 dark:border-neutral-800"
                        : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300">
                          <Plug className="size-4" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                              {config.displayName}
                            </h3>
                            <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                              {config.scope === "global" ? "Global" : "Workspace"}
                            </span>
                            <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                              {transportType.toUpperCase()}
                            </span>
                            {config.projectFullName ? (
                              <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                                {config.projectFullName}
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                            <span className="font-mono text-[11px]">{config.name}</span>
                            {config.tags?.map((tag) => (
                              <span
                                key={`${config._id}:${tag}`}
                                className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>

                          {config.description ? (
                            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
                              {config.description}
                            </p>
                          ) : null}

                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-neutral-500 dark:text-neutral-400">
                            <span className="max-w-full truncate rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 font-mono text-[11px] text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300">
                              {commandLabel}
                            </span>
                            <span>
                              Updated {new Date(config._creationTime).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 sm:justify-end">
                      <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-950">
                        {AGENT_OPTIONS.map((agent) => (
                          <AgentToggleButton
                            key={`${config._id}:${agent.key}`}
                            agent={agent}
                            enabled={config[agent.field]}
                            pending={isPending}
                            disabled={isPending}
                            onToggle={() => {
                              void handleToggleAgent(config, agent.field, !config[agent.field]);
                            }}
                          />
                        ))}
                      </div>

                      <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 rounded-lg text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-100"
                          onClick={() => openEditDialog(config)}
                          aria-label={`Edit ${config.displayName}`}
                          title="Edit"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 rounded-lg text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                          onClick={() => setDeleteTarget(config)}
                          aria-label={`Delete ${config.displayName}`}
                          title="Delete"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Dialog.Root
          open={dialogOpen}
          onOpenChange={(open) => {
            if (!open && !upsertMutation.isPending) {
              resetDialog();
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[var(--z-global-blocking)] bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-[var(--z-global-blocking)] w-[min(1040px,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="absolute right-4 top-4 rounded-lg border border-neutral-200 bg-white p-2 text-neutral-400 transition hover:text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:text-white"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </button>
              </Dialog.Close>

              <div className="max-h-[calc(100vh-2rem)] overflow-y-auto p-5 sm:p-6">
                <div className="flex items-start gap-4 pr-10">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                    <Plug className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Dialog.Title className="text-lg font-medium text-neutral-900 dark:text-white">
                      Edit {editingConfig?.displayName ?? "MCP Server"}
                    </Dialog.Title>
                    <Dialog.Description className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                      Update transport details, scope, secrets, and enabled agents.
                    </Dialog.Description>
                  </div>
                </div>

                {formError ? (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                    {formError}
                  </div>
                ) : null}

                <div className="mt-5">
                  <McpCustomEditor
                    form={form}
                    onFieldChange={updateCustomEditorForm}
                    jsonConfigText={jsonConfigText}
                    onJsonConfigChange={updateJsonConfig}
                    onErrorChange={setFormError}
                    disableName
                    disableScope
                    scopeOptions={DEFAULT_SCOPE_OPTIONS}
                    scopeDescription="The scope and target repo are fixed after creation."
                  />
                </div>

                <div className="mt-6 flex justify-end gap-3 border-t border-neutral-200 pt-5 dark:border-neutral-800">
                  <Dialog.Close asChild>
                    <Button variant="outline" disabled={upsertMutation.isPending}>
                      Cancel
                    </Button>
                  </Dialog.Close>
                  <Button
                    onClick={() => {
                      void handleSaveCustom();
                    }}
                    disabled={upsertMutation.isPending}
                  >
                    {upsertMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    Save
                  </Button>
                </div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <ConfirmDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open && !deleteMutation.isPending) {
              setDeleteTarget(null);
            }
          }}
          title="Delete MCP server?"
          description={
            deleteTarget
              ? `Remove ${deleteTarget.displayName}${deleteTarget.projectFullName ? ` for ${deleteTarget.projectFullName}` : ""} from settings.`
              : "Remove this MCP server from settings."
          }
          confirmLabel={deleteMutation.isPending ? "Deleting..." : "Delete"}
          onConfirm={handleDelete}
        />
      </>
    </TooltipProvider>
  );
}
