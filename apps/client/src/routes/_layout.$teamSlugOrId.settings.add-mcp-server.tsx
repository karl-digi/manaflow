import {
  McpCustomEditor,
  SegmentedTabs,
} from "@/components/mcp/McpFormSections";
import { FloatingPane } from "@/components/floating-pane";
import { TitleBar } from "@/components/TitleBar";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  DEFAULT_SCOPE_OPTIONS,
  MCP_INPUT_CLASS_NAME,
  buildEmptyForm,
  buildJsonConfigText,
  getErrorMessage,
  getPresetPayload,
  getScopedProjectFullName,
  getTransportPayload,
  isValidProjectFullName,
  matchesTarget,
  parseEnvVarsText,
  parseJsonConfigText,
  shouldRebuildJsonConfig,
  type FormState,
  validateForm,
} from "@/lib/mcp-form-helpers";
import { settingsSectionSchema } from "@/routes/_layout.$teamSlugOrId.settings";
import { api } from "@cmux/convex/api";
import { MCP_SERVER_PRESETS, type McpServerPreset } from "@cmux/shared";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useConvex } from "convex/react";
import { ArrowLeft, Loader2, Server } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

export const Route = createFileRoute("/_layout/$teamSlugOrId/settings/add-mcp-server")({
  component: AddMcpServerRoute,
  validateSearch: z.object({
    section: settingsSectionSchema.default("mcp-servers"),
  }),
});

function AddMcpServerRoute() {
  const { teamSlugOrId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const convex = useConvex();
  const [activeTab, setActiveTab] = useState<"preset" | "custom">("preset");
  const [form, setForm] = useState<FormState>(buildEmptyForm("global"));
  const [formError, setFormError] = useState<string | null>(null);
  const [jsonConfigText, setJsonConfigText] = useState(() =>
    buildJsonConfigText(buildEmptyForm("global")),
  );

  const { data: configs } = useQuery(
    convexQuery(api.mcpServerConfigs.list, { teamSlugOrId }),
  );

  const upsertMutation = useMutation({
    mutationFn: async (
      payload: Parameters<typeof convex.mutation<typeof api.mcpServerConfigs.upsert>>[1],
    ) => {
      return await convex.mutation(api.mcpServerConfigs.upsert, payload);
    },
  });

  const configuredPresetNames = useMemo(() => {
    if (activeTab !== "preset") {
      return new Set<string>();
    }

    return new Set(
      (configs ?? [])
        .filter((config) => matchesTarget(config, form.scope, form.projectFullName))
        .map((config) => config.name),
    );
  }, [activeTab, configs, form.projectFullName, form.scope]);

  const workspaceRepoValid = useMemo(
    () => isValidProjectFullName(form.projectFullName),
    [form.projectFullName],
  );

  const updateCustomEditorForm = <K extends keyof FormState,>(field: K, value: FormState[K]) => {
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
  };

  const updateJsonConfig = (value: string) => {
    setJsonConfigText(value);
    setFormError(null);
  };

  const goBackToSettings = async () => {
    await navigate({
      to: "/$teamSlugOrId/settings",
      params: { teamSlugOrId },
      search: {
        section: "mcp-servers",
      },
    });
  };

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
      toast.success("MCP server added");
      await goBackToSettings();
    } catch (error) {
      const message = getErrorMessage(error, "Failed to save MCP server.");
      setFormError(message);
      toast.error(message);
    }
  };

  const handleAddPreset = async (preset: McpServerPreset) => {
    try {
      await upsertMutation.mutateAsync({
        teamSlugOrId,
        ...getPresetPayload(preset, form.scope, form.projectFullName),
      });
      toast.success(`${preset.displayName} added`);
      await goBackToSettings();
    } catch (error) {
      const message = getErrorMessage(error, "Failed to add preset.");
      setFormError(message);
      toast.error(message);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <FloatingPane header={<TitleBar title="Add MCP Server" />}>
        <div className="relative flex grow flex-col overflow-auto select-none">
          <div className="w-full max-w-5xl mx-auto p-6 space-y-5">
            <Button variant="ghost" size="sm" asChild className="w-fit">
              <Link
                to="/$teamSlugOrId/settings"
                params={{ teamSlugOrId }}
                search={{ section: "mcp-servers" }}
              >
                <ArrowLeft className="size-4" />
                Back to MCP Servers
              </Link>
            </Button>

            <div className="flex items-start gap-4 rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                <Server className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-lg font-medium text-neutral-900 dark:text-white">
                  Add MCP Server
                </h1>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                  Choose a preset or configure a custom stdio, http, or sse MCP server.
                </p>
              </div>
            </div>

            <SegmentedTabs
              value={activeTab}
              onChange={setActiveTab}
              options={[
                { value: "preset", label: "Presets" },
                { value: "custom", label: "Custom" },
              ]}
            />

            {formError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                {formError}
              </div>
            ) : null}

            {activeTab === "preset" ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-950/60">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                        Installation target
                      </p>
                      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                        Choose whether this preset is available globally or for one workspace.
                      </p>
                    </div>
                    <SegmentedTabs
                      value={form.scope}
                      onChange={(scope) => updateCustomEditorForm("scope", scope)}
                      options={DEFAULT_SCOPE_OPTIONS}
                    />
                  </div>

                  {form.scope === "workspace" ? (
                    <div className="mt-4">
                      <label
                        htmlFor="preset-project-full-name"
                        className="text-sm font-medium text-neutral-900 dark:text-neutral-100"
                      >
                        Workspace repository
                      </label>
                      <input
                        id="preset-project-full-name"
                        value={form.projectFullName}
                        onChange={(event) =>
                          updateCustomEditorForm("projectFullName", event.target.value)
                        }
                        placeholder="owner/repo"
                        className={MCP_INPUT_CLASS_NAME}
                      />
                      <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                        Required for workspace-scoped presets.
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                  {MCP_SERVER_PRESETS.map((preset, index) => {
                    const alreadyConfigured = configuredPresetNames.has(preset.name);
                    const workspaceMissing =
                      form.scope === "workspace" && !workspaceRepoValid;
                    const commandLabel = `${preset.command} ${preset.args.join(" ")}`.trim();

                    return (
                      <div
                        key={preset.name}
                        className={`flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-neutral-50/80 dark:hover:bg-neutral-950/60 sm:flex-row sm:items-start sm:justify-between ${
                          index < MCP_SERVER_PRESETS.length - 1
                            ? "border-b border-neutral-200 dark:border-neutral-800"
                            : ""
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                              {preset.displayName}
                            </h3>
                            {preset.tags.map((tag) => (
                              <span
                                key={`${preset.name}:${tag}`}
                                className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                            {preset.description}
                          </p>
                          <p className="mt-2 inline-flex max-w-full truncate rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 font-mono text-[11px] text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300">
                            {commandLabel}
                          </p>
                        </div>

                        <Button
                          size="sm"
                          onClick={() => {
                            void handleAddPreset(preset);
                          }}
                          disabled={
                            upsertMutation.isPending ||
                            alreadyConfigured ||
                            workspaceMissing
                          }
                        >
                          {upsertMutation.isPending ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : alreadyConfigured ? (
                            "Configured"
                          ) : (
                            "Add"
                          )}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <McpCustomEditor
                form={form}
                onFieldChange={updateCustomEditorForm}
                jsonConfigText={jsonConfigText}
                onJsonConfigChange={updateJsonConfig}
                onErrorChange={setFormError}
              />
            )}
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-neutral-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-neutral-800 dark:bg-neutral-900/80 supports-[backdrop-filter]:dark:bg-neutral-900/60">
          <div className="mx-auto flex max-w-5xl items-center justify-end gap-3 px-6 py-3">
            <Button variant="outline" asChild disabled={upsertMutation.isPending}>
              <Link
                to="/$teamSlugOrId/settings"
                params={{ teamSlugOrId }}
                search={{ section: "mcp-servers" }}
              >
                Cancel
              </Link>
            </Button>
            {activeTab === "custom" ? (
              <Button
                onClick={() => {
                  void handleSaveCustom();
                }}
                disabled={upsertMutation.isPending}
              >
                {upsertMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Add
              </Button>
            ) : null}
          </div>
        </div>

      </FloatingPane>
    </TooltipProvider>
  );
}
