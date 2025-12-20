import { GitHubIcon } from "@/components/icons/github";
import { PersistentWebView } from "@/components/persistent-webview";
import { WorkspaceLoadingIndicator } from "@/components/workspace-loading-indicator";
import {
  TASK_RUN_IFRAME_ALLOW,
  TASK_RUN_IFRAME_SANDBOX,
} from "@/lib/preloadTaskRunIframes";
import {
  ensureInitialEnvVars,
  type EnvVar,
  type EnvironmentConfigDraft,
} from "@/types/environment";
import { EnvVarsSection } from "@cmux/shared/components/environment/env-vars-section";
import { ScriptsSection } from "@cmux/shared/components/environment/scripts-section";
import { formatEnvVarsContent } from "@cmux/shared/utils/format-env-vars-content";
import { validateExposedPorts } from "@cmux/shared/utils/validate-exposed-ports";
import type { MorphSnapshotId } from "@cmux/shared";
import type { Id } from "@cmux/convex/dataModel";
import {
  postApiEnvironmentsByIdSnapshotsMutation,
  postApiEnvironmentsMutation,
  postApiSandboxesByIdEnvMutation,
} from "@cmux/www-openapi-client/react-query";
import { useMutation as useRQMutation } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Minus,
  Plus,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

const MASKED_ENV_VALUE = "••••••••••••••••";

const ALL_CONFIG_STEPS = [
  "scripts",
  "env-vars",
  "run-scripts",
  "browser-setup",
] as const;

type ConfigStep = (typeof ALL_CONFIG_STEPS)[number];

type LayoutPhase = "setup" | "workspace";

function StepBadge({ step, done }: { step: number; done?: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold",
        done
          ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
          : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
      )}
    >
      {done ? <Check className="h-3 w-3" /> : step}
    </span>
  );
}

export function EnvironmentConfiguration({
  selectedRepos,
  teamSlugOrId,
  instanceId,
  vscodeUrl,
  browserUrl,
  isProvisioning,
  mode = "new",
  sourceEnvironmentId,
  initialEnvName = "",
  initialMaintenanceScript = "",
  initialDevScript = "",
  initialExposedPorts = "",
  initialEnvVars,
  onHeaderControlsChange,
  persistedState = null,
  onPersistStateChange,
  onBackToRepositorySelection,
  onEnvironmentSaved,
}: {
  selectedRepos: string[];
  teamSlugOrId: string;
  instanceId?: string;
  vscodeUrl?: string;
  browserUrl?: string;
  isProvisioning: boolean;
  mode?: "new" | "snapshot";
  sourceEnvironmentId?: Id<"environments">;
  initialEnvName?: string;
  initialMaintenanceScript?: string;
  initialDevScript?: string;
  initialExposedPorts?: string;
  initialEnvVars?: EnvVar[];
  onHeaderControlsChange?: (controls: ReactNode | null) => void;
  persistedState?: EnvironmentConfigDraft | null;
  onPersistStateChange?: (partial: Partial<EnvironmentConfigDraft>) => void;
  onBackToRepositorySelection?: () => void;
  onEnvironmentSaved?: () => void;
}) {
  const navigate = useNavigate();
  const searchRoute:
    | "/_layout/$teamSlugOrId/environments/new"
    | "/_layout/$teamSlugOrId/environments/new-version" =
    mode === "snapshot"
      ? "/_layout/$teamSlugOrId/environments/new-version"
      : "/_layout/$teamSlugOrId/environments/new";
  const search = useSearch({ from: searchRoute }) as {
    step?: "select" | "configure";
    selectedRepos?: string[];
    connectionLogin?: string;
    repoSearch?: string;
    instanceId?: string;
    snapshotId?: MorphSnapshotId;
  };

  const [layoutPhase, setLayoutPhase] = useState<LayoutPhase>("setup");
  const [currentConfigStep, setCurrentConfigStep] = useState<ConfigStep>(
    "run-scripts"
  );
  const [completedSteps, setCompletedSteps] = useState<Set<ConfigStep>>(
    () => new Set(["scripts", "env-vars"] as ConfigStep[])
  );

  const [envName, setEnvName] = useState(
    () => persistedState?.envName ?? initialEnvName
  );
  const [envVars, setEnvVars] = useState<EnvVar[]>(() =>
    ensureInitialEnvVars(persistedState?.envVars ?? initialEnvVars)
  );
  const [maintenanceScript, setMaintenanceScript] = useState(
    () => persistedState?.maintenanceScript ?? initialMaintenanceScript
  );
  const [devScript, setDevScript] = useState(
    () => persistedState?.devScript ?? initialDevScript
  );
  const [exposedPorts, setExposedPorts] = useState(
    () => persistedState?.exposedPorts ?? initialExposedPorts
  );
  const [portsError, setPortsError] = useState<string | null>(null);
  const [commandsCopied, setCommandsCopied] = useState(false);

  const persistConfig = useCallback(
    (partial: Partial<EnvironmentConfigDraft>) => {
      onPersistStateChange?.(partial);
    },
    [onPersistStateChange]
  );

  const updateEnvName = useCallback(
    (value: string) => {
      setEnvName(value);
      persistConfig({ envName: value });
    },
    [persistConfig]
  );

  const updateEnvVars = useCallback(
    (updater: (prev: EnvVar[]) => EnvVar[]) => {
      setEnvVars((prev) => {
        const next = updater(prev);
        persistConfig({ envVars: next });
        return next;
      });
    },
    [persistConfig]
  );

  const updateMaintenanceScript = useCallback(
    (value: string) => {
      setMaintenanceScript(value);
      persistConfig({ maintenanceScript: value });
    },
    [persistConfig]
  );

  const updateDevScript = useCallback(
    (value: string) => {
      setDevScript(value);
      persistConfig({ devScript: value });
    },
    [persistConfig]
  );

  const updateExposedPorts = useCallback(
    (value: string) => {
      setExposedPorts(value);
      setPortsError(null);
      persistConfig({ exposedPorts: value });
    },
    [persistConfig]
  );

  const createEnvironmentMutation = useRQMutation(postApiEnvironmentsMutation());
  const createSnapshotMutation = useRQMutation(
    postApiEnvironmentsByIdSnapshotsMutation()
  );
  const { mutate: applySandboxEnv } = useRQMutation(
    postApiSandboxesByIdEnvMutation()
  );

  const lastSubmittedEnvContent = useRef<string | null>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);

  const resolvedVscodeUrl = useMemo(() => {
    if (!vscodeUrl) return undefined;
    try {
      const url = new URL(vscodeUrl);
      url.searchParams.set("folder", "/root/workspace");
      return url.toString();
    } catch {
      return vscodeUrl;
    }
  }, [vscodeUrl]);

  const workspacePlaceholder = useMemo(() => {
    if (resolvedVscodeUrl) return null;
    if (instanceId || isProvisioning) {
      return {
        title: "Waiting for VS Code",
        description:
          "The editor opens automatically once the environment finishes booting.",
      };
    }
    return {
      title: "VS Code workspace not ready",
      description:
        "Select repositories and launch an environment to open VS Code.",
    };
  }, [instanceId, isProvisioning, resolvedVscodeUrl]);

  const browserPlaceholder = useMemo(() => {
    if (browserUrl) return null;
    if (instanceId || isProvisioning) {
      return {
        title: "Waiting for browser",
        description:
          "We'll embed the browser session as soon as the environment exposes it.",
      };
    }
    return {
      title: "Browser preview unavailable",
      description:
        "Launch the environment so the browser agent can handle authentication flows.",
    };
  }, [browserUrl, instanceId, isProvisioning]);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!onHeaderControlsChange) {
      return;
    }
    onHeaderControlsChange(null);
    return () => {
      onHeaderControlsChange(null);
    };
  }, [onHeaderControlsChange]);

  useEffect(() => {
    lastSubmittedEnvContent.current = null;
  }, [instanceId]);

  useEffect(() => {
    if (!instanceId) {
      return;
    }

    const envVarsContent = formatEnvVarsContent(
      envVars
        .filter((row) => row.name.trim().length > 0)
        .map((row) => ({ name: row.name, value: row.value }))
    );

    if (
      envVarsContent.length === 0 &&
      lastSubmittedEnvContent.current === null
    ) {
      return;
    }

    if (envVarsContent === lastSubmittedEnvContent.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      applySandboxEnv(
        {
          path: { id: instanceId },
          body: { teamSlugOrId, envVarsContent },
        },
        {
          onSuccess: () => {
            lastSubmittedEnvContent.current = envVarsContent;
          },
          onError: (error) => {
            console.error("Failed to apply sandbox environment vars", error);
          },
        }
      );
    }, 400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [applySandboxEnv, envVars, instanceId, teamSlugOrId]);

  const handleStartWorkspaceConfig = useCallback(() => {
    setLayoutPhase("workspace");
  }, []);

  const handleBackToSetup = useCallback(() => {
    setLayoutPhase("setup");
  }, []);

  const handleNextConfigStep = useCallback(() => {
    const idx = ALL_CONFIG_STEPS.indexOf(currentConfigStep);
    if (idx === -1) return;
    const nextStep = ALL_CONFIG_STEPS[idx + 1];
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      next.add(currentConfigStep);
      return next;
    });
    if (nextStep) {
      setCurrentConfigStep(nextStep);
    }
  }, [currentConfigStep]);

  const handleGoToStep = useCallback((step: ConfigStep) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      next.delete(step);
      return next;
    });
    setCurrentConfigStep(step);
  }, []);

  const isStepVisible = useCallback(
    (step: ConfigStep) => completedSteps.has(step) || step === currentConfigStep,
    [completedSteps, currentConfigStep]
  );

  const isStepCompleted = useCallback(
    (step: ConfigStep) => completedSteps.has(step),
    [completedSteps]
  );

  const isCurrentStep = useCallback(
    (step: ConfigStep) => step === currentConfigStep,
    [currentConfigStep]
  );

  const combinedCommands = useMemo(() => {
    const parts = [maintenanceScript.trim(), devScript.trim()].filter(Boolean);
    return parts.join(" && ");
  }, [devScript, maintenanceScript]);

  const handleCopyCommands = useCallback(async () => {
    if (!combinedCommands) {
      return;
    }

    try {
      await navigator.clipboard.writeText(combinedCommands);
      setCommandsCopied(true);
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setCommandsCopied(false);
      }, 2000);
    } catch (error) {
      console.error("Failed to copy commands:", error);
    }
  }, [combinedCommands]);

  const handleSaveConfiguration = useCallback(async () => {
    if (!instanceId) {
      console.error("Missing instanceId for environment save");
      return;
    }

    const trimmedName = envName.trim();
    if (!trimmedName) {
      const message =
        mode === "snapshot"
          ? "Snapshot label is required"
          : "Environment name is required";
      toast.error(message);
      return;
    }

    const envVarsContent = formatEnvVarsContent(
      envVars
        .filter((row) => row.name.trim().length > 0)
        .map((row) => ({ name: row.name, value: row.value }))
    );

    const normalizedMaintenanceScript = maintenanceScript.trim();
    const normalizedDevScript = devScript.trim();
    const requestMaintenanceScript =
      normalizedMaintenanceScript.length > 0
        ? normalizedMaintenanceScript
        : undefined;
    const requestDevScript =
      normalizedDevScript.length > 0 ? normalizedDevScript : undefined;

    const parsedPorts = exposedPorts
      .split(",")
      .map((p) => Number.parseInt(p.trim(), 10))
      .filter((n) => Number.isFinite(n));

    const validation = validateExposedPorts(parsedPorts);
    if (validation.reserved.length > 0) {
      setPortsError(
        `Reserved ports cannot be exposed: ${validation.reserved.join(", ")}`
      );
      return;
    }
    if (validation.invalid.length > 0) {
      setPortsError("Ports must be positive integers.");
      return;
    }

    setPortsError(null);
    const ports = validation.sanitized;

    if (mode === "snapshot" && sourceEnvironmentId) {
      createSnapshotMutation.mutate(
        {
          path: { id: sourceEnvironmentId },
          body: {
            teamSlugOrId,
            morphInstanceId: instanceId,
            label: trimmedName,
            activate: true,
            maintenanceScript: requestMaintenanceScript,
            devScript: requestDevScript,
          },
        },
        {
          onSuccess: async () => {
            toast.success("Snapshot version created");
            onEnvironmentSaved?.();
            await navigate({
              to: "/$teamSlugOrId/environments",
              params: {
                teamSlugOrId,
              },
              search: () => ({
                step: undefined,
                selectedRepos: undefined,
                connectionLogin: undefined,
                repoSearch: undefined,
                instanceId: undefined,
                snapshotId: undefined,
              }),
            });
          },
          onError: (error) => {
            console.error("Failed to create snapshot version:", error);
          },
        }
      );
      return;
    }

    createEnvironmentMutation.mutate(
      {
        body: {
          teamSlugOrId,
          name: trimmedName,
          morphInstanceId: instanceId,
          envVarsContent,
          selectedRepos,
          maintenanceScript: requestMaintenanceScript,
          devScript: requestDevScript,
          exposedPorts: ports.length > 0 ? ports : undefined,
          description: undefined,
        },
      },
      {
        onSuccess: async () => {
          toast.success("Environment saved");
          onEnvironmentSaved?.();
          await navigate({
            to: "/$teamSlugOrId/environments",
            params: { teamSlugOrId },
            search: {
              step: undefined,
              selectedRepos: undefined,
              connectionLogin: undefined,
              repoSearch: undefined,
              instanceId: undefined,
              snapshotId: undefined,
            },
          });
        },
        onError: (error) => {
          console.error("Failed to create environment:", error);
        },
      }
    );
  }, [
    createEnvironmentMutation,
    createSnapshotMutation,
    devScript,
    envName,
    envVars,
    exposedPorts,
    instanceId,
    maintenanceScript,
    mode,
    navigate,
    onEnvironmentSaved,
    selectedRepos,
    sourceEnvironmentId,
    teamSlugOrId,
  ]);

  const handleBackNavigation = useCallback(async () => {
    if (mode === "new") {
      onBackToRepositorySelection?.();
      await navigate({
        to: "/$teamSlugOrId/environments/new",
        params: { teamSlugOrId },
        search: {
          step: "select",
          selectedRepos: selectedRepos.length > 0 ? selectedRepos : undefined,
          instanceId: search.instanceId,
          connectionLogin: search.connectionLogin,
          repoSearch: search.repoSearch,
          snapshotId: search.snapshotId,
        },
      });
      return;
    }

    if (sourceEnvironmentId) {
      await navigate({
        to: "/$teamSlugOrId/environments/$environmentId",
        params: {
          teamSlugOrId,
          environmentId: sourceEnvironmentId,
        },
        search: {
          step: search.step,
          selectedRepos: search.selectedRepos,
          connectionLogin: search.connectionLogin,
          repoSearch: search.repoSearch,
          instanceId: search.instanceId,
          snapshotId: search.snapshotId,
        },
      });
    }
  }, [
    mode,
    navigate,
    onBackToRepositorySelection,
    search.connectionLogin,
    search.instanceId,
    search.repoSearch,
    search.selectedRepos,
    search.snapshotId,
    search.step,
    selectedRepos,
    sourceEnvironmentId,
    teamSlugOrId,
  ]);

  const isSaving =
    createEnvironmentMutation.isPending || createSnapshotMutation.isPending;

  const renderScriptsSection = (options?: {
    compact?: boolean;
    defaultOpen?: boolean;
    showStepBadge?: boolean;
    stepNumber?: number;
    isDone?: boolean;
  }) => {
    const {
      compact = false,
      defaultOpen = true,
      showStepBadge = false,
      stepNumber = 1,
      isDone = false,
    } = options ?? {};

    return (
      <ScriptsSection
        maintenanceScript={maintenanceScript}
        devScript={devScript}
        onMaintenanceScriptChange={updateMaintenanceScript}
        onDevScriptChange={updateDevScript}
        chevronIcon={ChevronDown}
        headerPrefix={
          showStepBadge ? <StepBadge step={stepNumber} done={isDone} /> : null
        }
        compact={compact}
        defaultOpen={defaultOpen}
      />
    );
  };

  const renderEnvVarsSection = (options?: {
    compact?: boolean;
    defaultOpen?: boolean;
    showStepBadge?: boolean;
    stepNumber?: number;
    isDone?: boolean;
  }) => {
    const {
      compact = false,
      defaultOpen = true,
      showStepBadge = false,
      stepNumber = 2,
      isDone = false,
    } = options ?? {};

    return (
      <EnvVarsSection
        envVars={envVars}
        onUpdate={updateEnvVars}
        chevronIcon={ChevronDown}
        eyeIcon={Eye}
        eyeOffIcon={EyeOff}
        minusIcon={Minus}
        plusIcon={Plus}
        headerPrefix={
          showStepBadge ? <StepBadge step={stepNumber} done={isDone} /> : null
        }
        compact={compact}
        defaultOpen={defaultOpen}
        maskedValue={MASKED_ENV_VALUE}
      />
    );
  };

  const renderSetupPanel = () => (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="flex flex-wrap items-center gap-4 mb-4">
          {mode === "new" || sourceEnvironmentId ? (
            <button
              type="button"
              onClick={handleBackNavigation}
              className="inline-flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              <ArrowLeft className="w-4 h-4" />
              {mode === "snapshot"
                ? "Back to environment"
                : "Back to repository selection"}
            </button>
          ) : null}
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            {mode === "snapshot"
              ? "Configure Snapshot Version"
              : "Configure Environment"}
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {mode === "snapshot"
              ? "Update configuration for the new snapshot version."
              : "Set up your environment name, scripts, and variables before launching the workspace."}
          </p>
        </div>

        <div className="mt-6 space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {mode === "snapshot" ? "Snapshot label" : "Environment name"}
            </label>
            <input
              type="text"
              value={envName}
              onChange={(e) => updateEnvName(e.target.value)}
              readOnly={mode === "snapshot"}
              aria-readonly={mode === "snapshot"}
              placeholder={
                mode === "snapshot"
                  ? "Auto-generated from environment"
                  : "e.g. project-name"
              }
              className={clsx(
                "w-full rounded-md border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2",
                mode === "snapshot"
                  ? "bg-neutral-100 text-neutral-600 cursor-not-allowed focus:ring-neutral-300/0 dark:bg-neutral-900 dark:text-neutral-400 dark:focus:ring-neutral-700/0"
                  : "bg-white text-neutral-900 focus:ring-neutral-300 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:ring-neutral-700"
              )}
            />
          </div>

          {selectedRepos.length > 0 ? (
            <div>
              <div className="text-xs text-neutral-500 dark:text-neutral-500 mb-1">
                Selected repositories
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedRepos.map((fullName) => (
                  <span
                    key={fullName}
                    className="inline-flex items-center gap-1 rounded-full border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-neutral-800 dark:text-neutral-200 px-2 py-1 text-xs"
                  >
                    <GitHubIcon className="h-3 w-3 shrink-0 text-neutral-700 dark:text-neutral-300" />
                    {fullName}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-neutral-500 dark:text-neutral-500">
              No repositories selected. You can configure a bare workspace.
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">
              Exposed ports
            </label>
            <input
              type="text"
              value={exposedPorts}
              onChange={(e) => updateExposedPorts(e.target.value)}
              placeholder="3000, 5173"
              className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700"
            />
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Comma-separated ports to expose in preview URLs.
            </p>
            {portsError ? (
              <p className="text-xs text-red-500 dark:text-red-400">
                {portsError}
              </p>
            ) : null}
          </div>

          <div className="space-y-4">
            {renderScriptsSection({ defaultOpen: true })}
            {renderEnvVarsSection({ defaultOpen: true })}
          </div>
        </div>
      </div>
      <div className="border-t border-neutral-200 dark:border-neutral-800 px-6 py-4">
        <button
          type="button"
          onClick={handleStartWorkspaceConfig}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition"
        >
          Continue to workspace
          <ArrowRight className="w-4 h-4" />
        </button>
        {isProvisioning || !instanceId ? (
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            {isProvisioning
              ? "Launching environment..."
              : "Workspace will connect once the instance is ready."}
          </p>
        ) : null}
      </div>
    </div>
  );

  const renderWorkspaceSteps = () => (
    <div className="space-y-4">
      {isStepVisible("scripts") && (
        <div>
          {renderScriptsSection({
            compact: true,
            defaultOpen: !isStepCompleted("scripts"),
            showStepBadge: true,
            stepNumber: 1,
            isDone: isStepCompleted("scripts"),
          })}
        </div>
      )}

      {isStepVisible("env-vars") && (
        <div>
          {renderEnvVarsSection({
            compact: true,
            defaultOpen: !isStepCompleted("env-vars"),
            showStepBadge: true,
            stepNumber: 2,
            isDone: isStepCompleted("env-vars"),
          })}
        </div>
      )}

      {isStepVisible("run-scripts") && (
        <div>
          <details className="group" open={isCurrentStep("run-scripts")}>
            <summary
              className={clsx(
                "flex items-center gap-2 list-none",
                isSaving ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              )}
              onClick={(event) => {
                if (isSaving) return;
                if (
                  isStepCompleted("run-scripts") &&
                  !isCurrentStep("run-scripts")
                ) {
                  event.preventDefault();
                  handleGoToStep("run-scripts");
                }
              }}
            >
              <ChevronDown className="h-3.5 w-3.5 text-neutral-400 transition-transform -rotate-90 group-open:rotate-0" />
              <StepBadge
                step={3}
                done={
                  isStepCompleted("run-scripts") &&
                  !isCurrentStep("run-scripts")
                }
              />
              <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                Run scripts in VS Code terminal
              </span>
            </summary>
            <div className="mt-3 ml-6 space-y-3">
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                Open terminal (
                <kbd className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] font-sans">
                  Ctrl+Shift+`
                </kbd>{" "}
                or{" "}
                <kbd className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] font-sans">
                  Cmd+J
                </kbd>
                ) and paste:
              </p>
              <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800/50">
                  <span className="text-[10px] uppercase tracking-wide text-neutral-500">
                    Commands
                  </span>
                  {combinedCommands ? (
                    <button
                      type="button"
                      onClick={handleCopyCommands}
                      className={clsx(
                        "p-0.5",
                        commandsCopied
                          ? "text-emerald-500"
                          : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                      )}
                    >
                      {commandsCopied ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  ) : null}
                </div>
                <pre className="px-3 py-2 text-[11px] font-mono text-neutral-900 dark:text-neutral-100 overflow-x-auto whitespace-pre-wrap break-all select-all">
                  {combinedCommands ? (
                    combinedCommands
                  ) : (
                    <span className="text-neutral-400 italic">
                      No scripts configured
                    </span>
                  )}
                </pre>
              </div>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                Proceed once the dev server is running.
              </p>
            </div>
          </details>
          {isCurrentStep("run-scripts") && (
            <button
              type="button"
              onClick={handleNextConfigStep}
              className="w-full mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition"
            >
              Continue
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {isStepVisible("browser-setup") && (
        <div>
          <details className="group" open={isCurrentStep("browser-setup")}>
            <summary
              className={clsx(
                "flex items-center gap-2 list-none",
                isSaving ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              )}
              onClick={(event) => {
                if (isSaving) return;
                if (
                  isStepCompleted("browser-setup") &&
                  !isCurrentStep("browser-setup")
                ) {
                  event.preventDefault();
                  handleGoToStep("browser-setup");
                }
              }}
            >
              <ChevronDown className="h-3.5 w-3.5 text-neutral-400 transition-transform -rotate-90 group-open:rotate-0" />
              <StepBadge
                step={4}
                done={
                  isStepCompleted("browser-setup") &&
                  !isCurrentStep("browser-setup")
                }
              />
              <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                Configure browser
              </span>
            </summary>
            <div className="mt-3 ml-6 space-y-3">
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                Use the browser on the right to set up authentication:
              </p>
              <ul className="space-y-2 text-[11px] text-neutral-600 dark:text-neutral-400">
                <li className="flex items-start gap-2">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-500 dark:text-neutral-400 flex-shrink-0 mt-0.5">
                    1
                  </span>
                  <span>Sign in to any dashboards or SaaS tools</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-500 dark:text-neutral-400 flex-shrink-0 mt-0.5">
                    2
                  </span>
                  <span>Dismiss cookie banners, popups, or MFA prompts</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-500 dark:text-neutral-400 flex-shrink-0 mt-0.5">
                    3
                  </span>
                  <span>Navigate to your dev server URL (e.g., localhost:3000)</span>
                </li>
              </ul>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                Proceed once the browser is ready.
              </p>
            </div>
          </details>
          {isCurrentStep("browser-setup") && (
            <button
              type="button"
              onClick={handleSaveConfiguration}
              disabled={isSaving}
              className="w-full mt-4 inline-flex items-center justify-center rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {mode === "snapshot" ? "Creating snapshot..." : "Saving..."}
                </>
              ) : mode === "snapshot" ? (
                "Create snapshot version"
              ) : (
                "Save environment"
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );

  const renderWorkspacePanel = () => {
    const showBrowser = currentConfigStep === "browser-setup";
    const activeUrl = showBrowser ? browserUrl : resolvedVscodeUrl;
    const placeholder = showBrowser ? browserPlaceholder : workspacePlaceholder;
    const fallback = (
      <div className="flex h-full items-center justify-center">
        <WorkspaceLoadingIndicator
          variant={showBrowser ? "browser" : "vscode"}
          status="loading"
          loadingTitle={placeholder?.title}
          loadingDescription={placeholder?.description}
        />
      </div>
    );
    const errorFallback = (
      <div className="flex h-full items-center justify-center">
        <WorkspaceLoadingIndicator
          variant={showBrowser ? "browser" : "vscode"}
          status="error"
        />
      </div>
    );

    if (!activeUrl) {
      return fallback;
    }

    return (
      <PersistentWebView
        key={showBrowser ? "browser" : "vscode"}
        persistKey={
          instanceId
            ? `env-config:${instanceId}:${showBrowser ? "browser" : "vscode"}`
            : `env-config:${showBrowser ? "browser" : "vscode"}`
        }
        src={activeUrl}
        className="flex h-full"
        iframeClassName="select-none"
        allow={TASK_RUN_IFRAME_ALLOW}
        sandbox={TASK_RUN_IFRAME_SANDBOX}
        preflight={!showBrowser}
        retainOnUnmount
        fallback={fallback}
        fallbackClassName="bg-neutral-50 dark:bg-black"
        errorFallback={errorFallback}
        errorFallbackClassName="bg-neutral-50/95 dark:bg-black/95"
        loadTimeoutMs={60_000}
      />
    );
  };

  if (layoutPhase === "setup") {
    return renderSetupPanel();
  }

  return (
    <div className="flex h-full">
      <div className="w-[360px] border-r border-neutral-200 dark:border-neutral-800 p-6 overflow-y-auto">
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleBackToSetup}
            className="inline-flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to setup
          </button>
          {mode === "new" ? (
            <button
              type="button"
              onClick={handleBackNavigation}
              className="inline-flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              <ArrowLeft className="h-3 w-3" />
              Change repositories
            </button>
          ) : null}
        </div>

        <div className="mt-4 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          Workspace steps
        </div>
        <div className="mt-4">{renderWorkspaceSteps()}</div>
      </div>
      <div className="flex-1 min-h-0 p-4">
        <div className="h-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 overflow-hidden">
          {renderWorkspacePanel()}
        </div>
      </div>
    </div>
  );
}
