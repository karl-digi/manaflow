import { ScriptTextareaField } from "@/components/ScriptTextareaField";
import { parseEnvBlock } from "@/lib/parseEnvBlock";
import { ensureInitialEnvVars, type EnvVar } from "@/types/environment";
import { formatEnvVarsContent } from "@cmux/shared/utils/format-env-vars-content";
import {
  getApiLocalWorkspaceConfigsOptions,
  postApiLocalWorkspaceConfigsMutation,
} from "@cmux/www-openapi-client/react-query";
import { useMutation as useRQMutation, useQuery } from "@tanstack/react-query";
import TextareaAutosize from "react-textarea-autosize";
import { FileUp, Minus, Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
} from "react";
import { toast } from "sonner";

type LocalWorkspaceSetupPanelProps = {
  teamSlugOrId: string;
  projectFullName: string | null;
};

export function LocalWorkspaceSetupPanel({
  teamSlugOrId,
  projectFullName,
}: LocalWorkspaceSetupPanelProps) {
  const configQuery = useQuery({
    ...getApiLocalWorkspaceConfigsOptions({
      query: {
        teamSlugOrId,
        projectFullName: projectFullName || "",
      },
    }),
    enabled: Boolean(projectFullName),
  });

  const saveMutation = useRQMutation(
    postApiLocalWorkspaceConfigsMutation(),
  );

  const [maintenanceScript, setMaintenanceScript] = useState("");
  const [envVars, setEnvVars] = useState<EnvVar[]>(() =>
    ensureInitialEnvVars(),
  );

  const originalConfigRef = useRef<{ script: string; envContent: string }>({
    script: "",
    envContent: "",
  });

  useEffect(() => {
    if (!projectFullName) return;
    setMaintenanceScript("");
    setEnvVars(ensureInitialEnvVars());
    originalConfigRef.current = { script: "", envContent: "" };
  }, [projectFullName]);

  useEffect(() => {
    if (configQuery.isPending) return;
    if (configQuery.error) return;
    if (configQuery.data === undefined) return;
    const data = configQuery.data;
    const nextScript = (data?.maintenanceScript ?? "").toString();
    const envContent = data?.envVarsContent ?? "";
    const parsedEnvVars =
      envContent.trim().length > 0
        ? parseEnvBlock(envContent).map((row) => ({
            name: row.name,
            value: row.value,
            isSecret: true,
          }))
        : [];
    const normalizedEnvContent = formatEnvVarsContent(
      parsedEnvVars
        .filter(
          (row) => row.name.trim().length > 0 || row.value.trim().length > 0,
        )
        .map((row) => ({ name: row.name, value: row.value })),
    );

    setMaintenanceScript(nextScript);
    setEnvVars(ensureInitialEnvVars(parsedEnvVars));
    originalConfigRef.current = {
      script: nextScript.trim(),
      envContent: normalizedEnvContent,
    };
  }, [configQuery.data, configQuery.isPending, configQuery.error]);

  const updateEnvVars = useCallback(
    (updater: (prev: EnvVar[]) => EnvVar[]) => {
      setEnvVars((prev) => ensureInitialEnvVars(updater(prev)));
    },
    [],
  );

  const currentEnvContent = useMemo(() => {
    const filtered = envVars
      .filter(
        (row) => row.name.trim().length > 0 || row.value.trim().length > 0,
      )
      .map((row) => ({ name: row.name, value: row.value }));
    return formatEnvVarsContent(filtered);
  }, [envVars]);

  const normalizedScript = maintenanceScript.trim();
  const hasChanges =
    normalizedScript !== originalConfigRef.current.script ||
    currentEnvContent !== originalConfigRef.current.envContent;

  const handleSave = useCallback(() => {
    if (!projectFullName) return;

    const scriptToSave = normalizedScript.length
      ? normalizedScript
      : undefined;

    saveMutation.mutate(
      {
        body: {
          teamSlugOrId,
          projectFullName,
          maintenanceScript: scriptToSave,
          envVarsContent: currentEnvContent,
        },
      },
      {
        onSuccess: () => {
          originalConfigRef.current = {
            script: normalizedScript,
            envContent: currentEnvContent,
          };
          toast.success("Local workspace setup saved");
        },
        onError: (error) => {
          console.error(
            "[LocalWorkspaceSetupPanel] Failed to save setup",
            error,
          );
          toast.error("Failed to save local setup");
        },
      },
    );
  }, [
    currentEnvContent,
    normalizedScript,
    projectFullName,
    saveMutation,
    teamSlugOrId,
  ]);

  const handleEnvPaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const text = event.clipboardData?.getData("text") ?? "";
      if (!text || !/\n|=/.test(text)) {
        return;
      }
      event.preventDefault();
      const entries = parseEnvBlock(text);
      if (entries.length === 0) {
        return;
      }
      updateEnvVars((prev) => {
        const map = new Map(
          prev
            .filter(
              (row) =>
                row.name.trim().length > 0 || row.value.trim().length > 0,
            )
            .map((row) => [row.name, row] as const),
        );
        for (const entry of entries) {
          if (!entry.name) continue;
          map.set(entry.name, {
            name: entry.name,
            value: entry.value,
            isSecret: true,
          });
        }
        return Array.from(map.values());
      });
    },
    [updateEnvVars],
  );

  const handleLoadEnvFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const entries = parseEnvBlock(text);

        if (entries.length === 0) {
          toast.error("No environment variables found in file");
          return;
        }

        updateEnvVars((prev) => {
          const map = new Map(
            prev
              .filter(
                (row) =>
                  row.name.trim().length > 0 || row.value.trim().length > 0,
              )
              .map((row) => [row.name, row] as const),
          );
          for (const entry of entries) {
            if (!entry.name) continue;
            map.set(entry.name, {
              name: entry.name,
              value: entry.value,
              isSecret: true,
            });
          }
          return Array.from(map.values());
        });

        toast.success(`Loaded ${entries.length} variables from ${file.name}`);
      } catch (error) {
        console.error("Failed to load env file:", error);
        toast.error(`Failed to load file: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    },
    [updateEnvVars],
  );

  if (configQuery.error) {
    throw configQuery.error;
  }

  if (!projectFullName) {
    return null;
  }

  return (
    <div className="mt-4 rounded-xl border border-amber-200/50 bg-amber-50/60 px-4 py-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
      <div className="flex flex-col gap-1">
        <div className="font-medium text-amber-900 dark:text-amber-100">
          Prepare your local workspace
        </div>
        <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
          Configure a setup script and environment variables for{" "}
          <span className="font-semibold">{projectFullName}</span>. We’ll run
          it automatically every time we create a local workspace.
        </p>
      </div>

      {configQuery.isPending ? (
        <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
          Loading saved configuration…
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {/* Split Screen Container */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left: Scripts Section */}
            <div className="flex flex-col">
              <ScriptTextareaField
                description="Runs after cmux clones your repository locally so dependencies and services are ready."
                subtitle="Executed from your workspace root (e.g. ~/cmux/local-workspaces/<workspace-name>)."
                value={maintenanceScript}
                onChange={setMaintenanceScript}
                placeholder={`# e.g.\npnpm install\nbundle install\nuv sync`}
                minRows={4}
                maxRows={18}
              />
            </div>

            {/* Right: Environment Variables Section */}
            <div className="flex flex-col">
              <div
                className="rounded-lg border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-950 flex flex-col h-full"
                onPasteCapture={handleEnvPaste}
              >
                <div className="px-3 py-3 border-b border-neutral-200 dark:border-neutral-800">
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      Environment variables
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Stored securely and injected when your setup script runs. Load from .env files or paste directly.
                    </p>
                  </div>

                  {/* File Upload Buttons */}
                  <div className="mt-3 space-y-2">
                    <label className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 cursor-pointer dark:border-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-900">
                      <FileUp className="h-3.5 w-3.5" />
                      Load .env file
                      <input
                        type="file"
                        accept=".env,.env.*,text/plain"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            handleLoadEnvFile(file);
                            // Reset input so same file can be loaded again
                            e.target.value = "";
                          }
                        }}
                      />
                    </label>
                    <p className="text-2xs text-neutral-500 dark:text-neutral-400">
                      Click to browse and load environment variables from .env files
                    </p>
                  </div>
                </div>

                {/* Scrollable Env Vars Grid */}
                <div className="flex-1 overflow-y-auto px-3 py-3" style={{ maxHeight: "400px" }}>
                  <div className="grid gap-2 text-2xs text-neutral-500 dark:text-neutral-500 items-center mb-2" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr) 40px" }}>
                    <span>Key</span>
                    <span>Value</span>
                    <span />
                  </div>

                  <div className="space-y-2">
                    {envVars.map((row, idx) => (
                      <div
                        key={`${row.name}-${idx}`}
                        className="grid gap-2 items-start"
                        style={{
                          gridTemplateColumns:
                            "minmax(0, 1fr) minmax(0, 1.2fr) 40px",
                        }}
                      >
                        <input
                          type="text"
                          value={row.name}
                          onChange={(event) => {
                            const value = event.target.value;
                            updateEnvVars((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx]!, name: value };
                              return next;
                            });
                          }}
                          placeholder="EXAMPLE_KEY"
                          className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-mono text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-700"
                        />
                        <TextareaAutosize
                          value={row.value}
                          onChange={(event) => {
                            const value = event.target.value;
                            updateEnvVars((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx]!, value };
                              return next;
                            });
                          }}
                          minRows={1}
                          maxRows={6}
                          placeholder="secret-value"
                          className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-mono text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-700"
                        />
                        <button
                          type="button"
                          className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
                          onClick={() =>
                            updateEnvVars((prev) =>
                              prev.filter((_, i) => i !== idx),
                            )
                          }
                          aria-label="Remove variable"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3">
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-900"
                      onClick={() =>
                        updateEnvVars((prev) => [
                          ...prev,
                          { name: "", value: "", isSecret: true },
                        ])
                      }
                    >
                      <Plus className="h-4 w-4" />
                      Add variable
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Save Button - Full Width at Bottom */}
          <div className="flex items-center justify-end gap-3">
            {!hasChanges && !saveMutation.isPending ? (
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                All changes saved
              </span>
            ) : null}
            <button
              type="button"
              className="inline-flex items-center rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-60"
              disabled={!hasChanges || saveMutation.isPending}
              onClick={handleSave}
            >
              {saveMutation.isPending ? "Saving…" : "Save setup"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
