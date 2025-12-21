/**
 * Multi-Repository Environment Configuration Component
 *
 * This component implements the environment configuration flow that supports multiple repositories.
 * It uses the multi-phase layout pattern from preview.new:
 * - initial-setup: Configure framework, scripts, and env vars (full page)
 * - transitioning: Animated transition to workspace view
 * - workspace-config: Step-by-step config with VS Code/browser preview (split view)
 *
 * Unlike preview.new (single repo where workspace root = repo root), this supports:
 * - Multiple repositories cloned to /root/workspace/{repoName}
 * - Workspace root at /root/workspace (one level above repo roots)
 * - Framework detection from first repository
 */

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
import { formatEnvVarsContent } from "@cmux/shared/utils/format-env-vars-content";
import { validateExposedPorts } from "@cmux/shared/utils/validate-exposed-ports";
import {
  postApiEnvironmentsMutation,
  postApiSandboxesByIdEnvMutation,
} from "@cmux/www-openapi-client/react-query";
import {
  VncViewer,
  type VncConnectionStatus,
} from "@cmux/shared/components/vnc-viewer";
import { useMutation as useRQMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Id } from "@cmux/convex/dataModel";
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
import {
  type ConfigStep,
  type LayoutPhase,
  type FrameworkPreset,
  type PackageManager,
  MASKED_ENV_VALUE,
  WORKSPACE_ROOT,
  parseEnvBlock,
} from "@cmux/shared/environment-config";
import {
  getFrameworkPresetConfig,
  FRAMEWORK_PRESETS,
} from "@cmux/shared/environment-config";

// Configuration steps for workspace configuration phase
const ALL_CONFIG_STEPS: readonly ConfigStep[] = [
  "scripts",
  "env-vars",
  "run-scripts",
  "browser-setup",
];

type MultiRepoEnvironmentConfigProps = {
  selectedRepos: string[];
  teamSlugOrId: string;
  instanceId?: string;
  vscodeUrl?: string;
  vncWebsocketUrl?: string;
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
};

function StepBadge({ step, done }: { step: number; done: boolean }) {
  return (
    <span
      className={clsx(
        "flex h-5 w-5 items-center justify-center rounded-full border text-[11px]",
        done
          ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-400/70 dark:bg-emerald-900/40 dark:text-emerald-100"
          : "border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
      )}
    >
      {done ? <Check className="h-3 w-3" /> : step}
    </span>
  );
}

// Framework preset icons (inline SVGs for simplicity)
function FrameworkIcon({ preset }: { preset: FrameworkPreset }) {
  const iconClass = "w-5 h-5";
  switch (preset) {
    case "next":
      return (
        <svg className={iconClass} viewBox="0 0 48 48" fill="none">
          <mask id="next-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
            <circle cx="24" cy="24" r="24" fill="#000" />
          </mask>
          <g mask="url(#next-mask)">
            <circle cx="24" cy="24" r="23.2" fill="currentColor" stroke="currentColor" strokeWidth="1.6" />
          </g>
        </svg>
      );
    case "vite":
      return (
        <svg className={iconClass} viewBox="0 0 410 404" fill="none">
          <path d="M399.641 59.5246L215.643 388.545C211.844 395.338 202.084 395.378 198.228 388.618L10.5817 59.5563C6.38087 52.1896 12.6802 43.2665 21.0281 44.7586L205.223 77.6824C206.398 77.8924 207.601 77.8904 208.776 77.6763L389.119 44.8058C397.439 43.2894 403.768 52.1434 399.641 59.5246Z" fill="url(#vite-paint0)" />
          <defs>
            <linearGradient id="vite-paint0" x1="6" y1="33" x2="235" y2="344" gradientUnits="userSpaceOnUse">
              <stop stopColor="#41D1FF" />
              <stop offset="1" stopColor="#BD34FE" />
            </linearGradient>
          </defs>
        </svg>
      );
    default:
      return (
        <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        </svg>
      );
  }
}

export function MultiRepoEnvironmentConfig({
  selectedRepos,
  teamSlugOrId,
  instanceId,
  vscodeUrl,
  vncWebsocketUrl,
  isProvisioning,
  mode: _mode = "new",
  sourceEnvironmentId: _sourceEnvironmentId,
  initialEnvName = "",
  initialMaintenanceScript = "",
  initialDevScript = "",
  initialExposedPorts = "",
  initialEnvVars,
  onHeaderControlsChange: _onHeaderControlsChange,
  persistedState,
  onPersistStateChange,
  onBackToRepositorySelection,
  onEnvironmentSaved,
}: MultiRepoEnvironmentConfigProps) {
  const navigate = useNavigate();

  // Layout phase state
  const [layoutPhase, setLayoutPhase] = useState<LayoutPhase>("initial-setup");
  const [currentConfigStep, setCurrentConfigStep] = useState<ConfigStep>("run-scripts");
  const [completedSteps, setCompletedSteps] = useState<Set<ConfigStep>>(
    () => new Set(["scripts", "env-vars"] as ConfigStep[])
  );

  // Form state
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

  // Framework detection state
  const [frameworkPreset, setFrameworkPreset] = useState<FrameworkPreset>("other");
  const [detectedPackageManager, setDetectedPackageManager] = useState<PackageManager>("npm");
  const [isDetectingFramework, setIsDetectingFramework] = useState(true);
  const [hasUserEditedScripts, setHasUserEditedScripts] = useState(false);
  const hasUserEditedScriptsRef = useRef(false);
  useEffect(() => {
    hasUserEditedScriptsRef.current = hasUserEditedScripts;
  }, [hasUserEditedScripts]);

  // UI state
  const [areEnvValuesHidden, setAreEnvValuesHidden] = useState(true);
  const [activeEnvValueIndex, setActiveEnvValueIndex] = useState<number | null>(null);
  const [portsError, setPortsError] = useState<string | null>(null);
  const [commandsCopied, setCommandsCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // VNC state
  const [_vncStatus, setVncStatus] = useState<VncConnectionStatus>("disconnected");

  // Refs
  const keyInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);
  const lastSubmittedEnvContent = useRef<string | null>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);

  // Mutations
  const createEnvironmentMutation = useRQMutation(
    postApiEnvironmentsMutation()
  );
  const applySandboxEnvMutation = useRQMutation(
    postApiSandboxesByIdEnvMutation()
  );
  const applySandboxEnv = applySandboxEnvMutation.mutate;

  // Persist config callback
  const persistConfig = useCallback(
    (partial: Partial<EnvironmentConfigDraft>) => {
      onPersistStateChange?.(partial);
    },
    [onPersistStateChange]
  );

  // Update functions with persistence
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
      setHasUserEditedScripts(true);
      persistConfig({ maintenanceScript: value });
    },
    [persistConfig]
  );

  const updateDevScript = useCallback(
    (value: string) => {
      setDevScript(value);
      setHasUserEditedScripts(true);
      persistConfig({ devScript: value });
    },
    [persistConfig]
  );

  const updateExposedPorts = useCallback(
    (value: string) => {
      setExposedPorts(value);
      persistConfig({ exposedPorts: value });
    },
    [persistConfig]
  );

  // Framework preset change handler
  const handleFrameworkPresetChange = useCallback(
    (preset: FrameworkPreset) => {
      setFrameworkPreset(preset);
      if (!hasUserEditedScriptsRef.current) {
        const presetConfig = getFrameworkPresetConfig(preset, detectedPackageManager);
        setMaintenanceScript(presetConfig.maintenanceScript);
        setDevScript(presetConfig.devScript);
        persistConfig({
          maintenanceScript: presetConfig.maintenanceScript,
          devScript: presetConfig.devScript,
        });
      }
    },
    [detectedPackageManager, persistConfig]
  );

  // Framework detection on mount
  useEffect(() => {
    if (selectedRepos.length === 0) {
      setIsDetectingFramework(false);
      return;
    }

    // Detect framework from first repository
    const firstRepo = selectedRepos[0];
    const detectFramework = async () => {
      try {
        const response = await fetch(
          `/api/integrations/github/framework-detection?repo=${encodeURIComponent(firstRepo)}`
        );
        if (!response.ok) {
          console.error("Framework detection failed:", response.statusText);
          return;
        }
        const data = (await response.json()) as {
          framework: FrameworkPreset;
          packageManager: PackageManager;
          maintenanceScript: string;
          devScript: string;
        };

        setDetectedPackageManager(data.packageManager);

        if (!hasUserEditedScriptsRef.current) {
          setFrameworkPreset(data.framework);
          if (!initialMaintenanceScript) {
            setMaintenanceScript(data.maintenanceScript);
          }
          if (!initialDevScript) {
            setDevScript(data.devScript);
          }
        }
      } catch (error) {
        console.error("Failed to detect framework:", error);
      } finally {
        setIsDetectingFramework(false);
      }
    };

    void detectFramework();
  }, [selectedRepos, initialMaintenanceScript, initialDevScript]);

  // Focus pending env var input
  useEffect(() => {
    if (pendingFocusIndex !== null) {
      const el = keyInputRefs.current[pendingFocusIndex];
      if (el) {
        setTimeout(() => {
          el.focus();
          try {
            el.scrollIntoView({ block: "nearest" });
          } catch (_e) {
            void 0;
          }
        }, 0);
        setPendingFocusIndex(null);
      }
    }
  }, [pendingFocusIndex, envVars]);

  // Auto-apply env vars to sandbox
  useEffect(() => {
    if (!instanceId) return;

    const envVarsContent = formatEnvVarsContent(
      envVars
        .filter((r) => r.name.trim().length > 0)
        .map((r) => ({ name: r.name, value: r.value }))
    );

    if (envVarsContent.length === 0 && lastSubmittedEnvContent.current === null) {
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

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  // Copy commands handler
  const handleCopyCommands = useCallback(async () => {
    const combined = [maintenanceScript.trim(), devScript.trim()]
      .filter(Boolean)
      .join(" && ");
    if (!combined) return;

    try {
      await navigator.clipboard.writeText(combined);
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
  }, [devScript, maintenanceScript]);

  // Save configuration
  const handleSaveConfiguration = async () => {
    if (!instanceId) {
      console.error("Missing instanceId for configuration save");
      return;
    }
    if (!envName.trim()) {
      setErrorMessage("Environment name is required");
      return;
    }

    const envVarsContent = formatEnvVarsContent(
      envVars
        .filter((r) => r.name.trim().length > 0)
        .map((r) => ({ name: r.name, value: r.value }))
    );

    const normalizedMaintenanceScript = maintenanceScript.trim();
    const normalizedDevScript = devScript.trim();
    const requestMaintenanceScript =
      normalizedMaintenanceScript.length > 0 ? normalizedMaintenanceScript : undefined;
    const requestDevScript =
      normalizedDevScript.length > 0 ? normalizedDevScript : undefined;

    const parsedPorts = exposedPorts
      .split(",")
      .map((p) => Number.parseInt(p.trim(), 10))
      .filter((n) => Number.isFinite(n));

    const validation = validateExposedPorts(parsedPorts);
    if (validation.reserved.length > 0) {
      setPortsError(`Reserved ports cannot be exposed: ${validation.reserved.join(", ")}`);
      return;
    }
    if (validation.invalid.length > 0) {
      setPortsError("Ports must be positive integers.");
      return;
    }

    setPortsError(null);
    setIsSaving(true);
    setErrorMessage(null);

    createEnvironmentMutation.mutate(
      {
        body: {
          teamSlugOrId,
          name: envName.trim(),
          morphInstanceId: instanceId,
          envVarsContent,
          selectedRepos,
          maintenanceScript: requestMaintenanceScript,
          devScript: requestDevScript,
          exposedPorts: validation.sanitized.length > 0 ? validation.sanitized : undefined,
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
        onError: (err) => {
          console.error("Failed to create environment:", err);
          setErrorMessage("Failed to save environment");
          setIsSaving(false);
        },
      }
    );
  };

  // Phase transition handlers
  const handleStartWorkspaceConfig = useCallback(() => {
    setLayoutPhase("transitioning");
    setTimeout(() => {
      setLayoutPhase("workspace-config");
    }, 650);
  }, []);

  const handleBackToInitialSetup = useCallback(() => {
    setLayoutPhase("initial-setup");
    setCurrentConfigStep("run-scripts");
  }, []);

  const handleNextConfigStep = useCallback(() => {
    const currentIndex = ALL_CONFIG_STEPS.indexOf(currentConfigStep);
    setCompletedSteps((prev) => new Set([...prev, currentConfigStep]));
    if (currentIndex < ALL_CONFIG_STEPS.length - 1) {
      setCurrentConfigStep(ALL_CONFIG_STEPS[currentIndex + 1]);
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

  // Helper functions
  const isStepVisible = useCallback(
    (step: ConfigStep) => completedSteps.has(step) || step === currentConfigStep,
    [completedSteps, currentConfigStep]
  );

  const isCurrentStep = useCallback(
    (step: ConfigStep) => step === currentConfigStep,
    [currentConfigStep]
  );

  const isStepCompleted = useCallback(
    (step: ConfigStep) => completedSteps.has(step),
    [completedSteps]
  );

  // Computed values
  const isWorkspaceReady = Boolean(vscodeUrl);

  const vscodePersistKey = instanceId
    ? `multi-repo-env-${instanceId}:vscode`
    : "multi-repo-env:vscode";

  // Placeholders
  const workspacePlaceholder = useMemo(
    () =>
      vscodeUrl
        ? null
        : {
            title: instanceId
              ? "Waiting for VS Code"
              : "VS Code workspace not ready",
            description: instanceId
              ? "The editor opens automatically once the environment finishes booting."
              : "Select repositories and launch an environment to open VS Code.",
          },
    [instanceId, vscodeUrl]
  );

  const browserPlaceholder = useMemo(
    () =>
      vncWebsocketUrl
        ? null
        : {
            title: instanceId
              ? "Waiting for browser"
              : "Browser preview unavailable",
            description: instanceId
              ? "We'll embed the browser session as soon as the environment exposes it."
              : "Launch an environment so the browser agent can stream the preview here.",
          },
    [instanceId, vncWebsocketUrl]
  );

  // VNC loading/error fallbacks
  const vncLoadingFallback = (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent" />
      <span className="text-sm text-neutral-400">
        Connecting to browser preview...
      </span>
    </div>
  );

  const vncErrorFallback = (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
      <span className="text-sm text-red-400">
        Failed to connect to browser preview
      </span>
    </div>
  );

  // Render scripts section
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
    const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";
    const titleSize = compact ? "text-[13px]" : "text-base";
    const contentPadding = compact ? "mt-3 pl-5" : "mt-4 pl-6";

    return (
      <details className="group" open={defaultOpen}>
        <summary
          className={clsx(
            "flex items-center gap-2 cursor-pointer font-semibold text-neutral-900 dark:text-neutral-100 list-none",
            titleSize
          )}
        >
          <ChevronDown
            className={clsx(
              iconSize,
              "text-neutral-400 transition-transform -rotate-90 group-open:rotate-0"
            )}
          />
          {showStepBadge && <StepBadge step={stepNumber} done={isDone} />}
          Maintenance and Dev Scripts
        </summary>
        <div className={clsx(contentPadding, "space-y-4")}>
          <div>
            <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">
              Maintenance Script
            </label>
            <textarea
              value={maintenanceScript}
              onChange={(e) => updateMaintenanceScript(e.target.value)}
              placeholder="npm install, bun install, pip install -r requirements.txt"
              rows={2}
              className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-xs font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 resize-none"
            />
            <p className="text-xs text-neutral-400 mt-1">
              Runs after git pull to install dependencies
            </p>
          </div>
          <div>
            <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">
              Dev Script
            </label>
            <textarea
              value={devScript}
              onChange={(e) => updateDevScript(e.target.value)}
              placeholder="npm run dev, bun dev, python manage.py runserver"
              rows={2}
              className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-xs font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 resize-none"
            />
            <p className="text-xs text-neutral-400 mt-1">
              Starts the development server
            </p>
          </div>
        </div>
      </details>
    );
  };

  // Render env vars section
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
    const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";
    const titleSize = compact ? "text-[13px]" : "text-base";
    const contentPadding = compact ? "mt-3 pl-5" : "mt-4 pl-6";

    return (
      <details className="group" open={defaultOpen}>
        <summary
          className={clsx(
            "flex items-center gap-2 cursor-pointer font-semibold text-neutral-900 dark:text-neutral-100 list-none",
            titleSize
          )}
        >
          <ChevronDown
            className={clsx(
              iconSize,
              "text-neutral-400 transition-transform -rotate-90 group-open:rotate-0"
            )}
          />
          {showStepBadge && <StepBadge step={stepNumber} done={isDone} />}
          <span>Environment Variables</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setActiveEnvValueIndex(null);
                setAreEnvValuesHidden((prev) => !prev);
              }}
              className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition p-0.5"
              aria-label={areEnvValuesHidden ? "Reveal values" : "Hide values"}
            >
              {areEnvValuesHidden ? (
                <EyeOff className={iconSize} />
              ) : (
                <Eye className={iconSize} />
              )}
            </button>
          </div>
        </summary>
        <div
          className={clsx(contentPadding, "space-y-2")}
          onPasteCapture={(e) => {
            const text = e.clipboardData?.getData("text") ?? "";
            if (text && (/\n/.test(text) || /(=|:)\s*\S/.test(text))) {
              e.preventDefault();
              const items = parseEnvBlock(text);
              if (items.length > 0) {
                updateEnvVars((prev) => {
                  const map = new Map(
                    prev
                      .filter((r) => r.name.trim().length > 0 || r.value.trim().length > 0)
                      .map((r) => [r.name, r] as const)
                  );
                  for (const it of items) {
                    if (!it.name) continue;
                    const existing = map.get(it.name);
                    if (existing) {
                      map.set(it.name, { ...existing, value: it.value });
                    } else {
                      map.set(it.name, {
                        name: it.name,
                        value: it.value,
                        isSecret: true,
                      });
                    }
                  }
                  const next = Array.from(map.values());
                  next.push({ name: "", value: "", isSecret: true });
                  setPendingFocusIndex(next.length - 1);
                  return next;
                });
              }
            }
          }}
        >
          <div
            className="grid gap-2 text-xs text-neutral-500 items-center mb-1"
            style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr) 40px" }}
          >
            <span>Name</span>
            <span>Value</span>
            <span />
          </div>
          {envVars.map((row, idx) => {
            const isEditingValue = activeEnvValueIndex === idx;
            const shouldMaskValue =
              areEnvValuesHidden && row.value.trim().length > 0 && !isEditingValue;
            return (
              <div
                key={idx}
                className="grid gap-2 items-center min-h-9"
                style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr) 40px" }}
              >
                <input
                  type="text"
                  value={row.name}
                  ref={(el) => {
                    keyInputRefs.current[idx] = el;
                  }}
                  onChange={(e) => {
                    updateEnvVars((prev) => {
                      const next = [...prev];
                      if (next[idx]) next[idx] = { ...next[idx], name: e.target.value };
                      return next;
                    });
                  }}
                  placeholder="EXAMPLE_NAME"
                  className="w-full min-w-0 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 text-sm font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700"
                />
                <input
                  type={shouldMaskValue ? "password" : "text"}
                  value={shouldMaskValue ? MASKED_ENV_VALUE : row.value}
                  onChange={
                    shouldMaskValue
                      ? undefined
                      : (e) => {
                          updateEnvVars((prev) => {
                            const next = [...prev];
                            if (next[idx]) next[idx] = { ...next[idx], value: e.target.value };
                            return next;
                          });
                        }
                  }
                  onFocus={() => setActiveEnvValueIndex(idx)}
                  onBlur={() =>
                    setActiveEnvValueIndex((current) => (current === idx ? null : current))
                  }
                  readOnly={shouldMaskValue}
                  placeholder="I9JU23NF394R6HH"
                  className="w-full min-w-0 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 text-sm font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700"
                />
                <button
                  type="button"
                  disabled={envVars.length <= 1}
                  onClick={() =>
                    updateEnvVars((prev) => {
                      const next = prev.filter((_, i) => i !== idx);
                      return next.length > 0 ? next : [{ name: "", value: "", isSecret: true }];
                    })
                  }
                  className={clsx(
                    "h-9 w-9 rounded-md border border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 grid place-items-center",
                    envVars.length <= 1
                      ? "opacity-60 cursor-not-allowed"
                      : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  )}
                  aria-label="Remove variable"
                >
                  <Minus className="w-4 h-4" />
                </button>
              </div>
            );
          })}
          <div className="mt-1">
            <button
              type="button"
              onClick={() =>
                updateEnvVars((prev) => [...prev, { name: "", value: "", isSecret: true }])
              }
              className="inline-flex items-center gap-2 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 px-3 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition"
            >
              <Plus className="w-4 h-4" /> Add variable
            </button>
          </div>
        </div>
        <p className={clsx("text-xs text-neutral-400 mt-4", compact ? "pl-5" : "pl-6")}>
          Tip: Paste a .env file to auto-fill
        </p>
      </details>
    );
  };

  // Render preview panel
  const renderPreviewPanel = () => {
    const showBrowser = currentConfigStep === "browser-setup";
    const placeholder = showBrowser ? browserPlaceholder : workspacePlaceholder;

    return (
      <div className="h-full flex flex-col overflow-hidden relative">
        {placeholder ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-neutral-500 dark:text-neutral-400">
            <div className="text-sm font-medium text-neutral-600 dark:text-neutral-200">
              {placeholder.title}
            </div>
            {placeholder.description ? (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {placeholder.description}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* VS Code WebView (shown for non-browser-setup steps) */}
        {!showBrowser && vscodeUrl && (
          <PersistentWebView
            key={vscodePersistKey}
            persistKey={vscodePersistKey}
            src={vscodeUrl}
            className={clsx(
              "flex h-full",
              placeholder ? "opacity-0" : "opacity-100"
            )}
            iframeClassName="select-none"
            allow={TASK_RUN_IFRAME_ALLOW}
            sandbox={TASK_RUN_IFRAME_SANDBOX}
            preflight
            retainOnUnmount
            fallback={<WorkspaceLoadingIndicator variant="vscode" status="loading" />}
            fallbackClassName="bg-neutral-50 dark:bg-black"
            errorFallback={<WorkspaceLoadingIndicator variant="vscode" status="error" />}
            errorFallbackClassName="bg-neutral-50/95 dark:bg-black/95"
            loadTimeoutMs={60_000}
          />
        )}

        {/* VNC Viewer for browser preview (shown for browser-setup step) */}
        {showBrowser && vncWebsocketUrl && (
          <VncViewer
            url={vncWebsocketUrl}
            className={clsx(
              "absolute inset-0",
              browserPlaceholder ? "opacity-0" : "opacity-100"
            )}
            background="#000000"
            scaleViewport
            autoConnect
            autoReconnect
            reconnectDelay={1000}
            maxReconnectDelay={30000}
            focusOnClick
            onStatusChange={setVncStatus}
            loadingFallback={vncLoadingFallback}
            errorFallback={vncErrorFallback}
          />
        )}
      </div>
    );
  };

  // Render initial setup content
  const renderInitialSetupContent = () => {
    return (
      <div className="space-y-6">
        {/* Environment Name */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">
            Environment name
          </label>
          <input
            type="text"
            value={envName}
            onChange={(e) => updateEnvName(e.target.value)}
            placeholder="e.g. project-name"
            className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700"
          />
        </div>

        {/* Selected Repos */}
        {selectedRepos.length > 0 && (
          <div>
            <div className="text-xs text-neutral-500 dark:text-neutral-500 mb-2">
              Selected repositories ({selectedRepos.length})
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
        )}

        {/* Framework Preset */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">
            Framework
          </label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(FRAMEWORK_PRESETS) as FrameworkPreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handleFrameworkPresetChange(preset)}
                disabled={isDetectingFramework}
                className={clsx(
                  "inline-flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition",
                  frameworkPreset === preset
                    ? "border-neutral-900 dark:border-neutral-100 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
                    : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900",
                  isDetectingFramework && "opacity-50 cursor-wait"
                )}
              >
                <FrameworkIcon preset={preset} />
                {FRAMEWORK_PRESETS[preset].name}
              </button>
            ))}
          </div>
          {isDetectingFramework && (
            <p className="text-xs text-neutral-500">Detecting framework...</p>
          )}
        </div>

        {/* Scripts */}
        {renderScriptsSection({ defaultOpen: true })}

        {/* Environment Variables */}
        {renderEnvVarsSection({ defaultOpen: true })}

        {/* Exposed Ports */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">
            Exposed ports
          </label>
          <input
            type="text"
            value={exposedPorts}
            onChange={(e) => updateExposedPorts(e.target.value)}
            placeholder="3000, 8080, 5432"
            className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700"
          />
          <p className="text-xs text-neutral-500">
            Comma-separated list of ports that should be exposed for preview URLs.
          </p>
          {portsError && <p className="text-xs text-red-500">{portsError}</p>}
        </div>
      </div>
    );
  };

  // Render workspace step content
  const renderWorkspaceStepContent = () => {
    return (
      <div className="space-y-4">
        {/* Step 1: Scripts */}
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

        {/* Step 2: Environment Variables */}
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

        {/* Step 3: Run Scripts */}
        {isStepVisible("run-scripts") && (
          <div>
            <details className="group" open={isCurrentStep("run-scripts")}>
              <summary
                className={clsx(
                  "flex items-center gap-2 list-none",
                  isSaving ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                )}
                onClick={(e) => {
                  if (isSaving) return;
                  if (isStepCompleted("run-scripts") && !isCurrentStep("run-scripts")) {
                    e.preventDefault();
                    handleGoToStep("run-scripts");
                  }
                }}
              >
                <ChevronDown className="h-3.5 w-3.5 text-neutral-400 transition-transform -rotate-90 group-open:rotate-0" />
                <StepBadge
                  step={3}
                  done={isStepCompleted("run-scripts") && !isCurrentStep("run-scripts")}
                />
                <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
                  Run scripts in VS Code terminal
                </span>
              </summary>
              <div className="mt-3 ml-6 space-y-3">
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Open terminal (<kbd className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px]">Ctrl+Shift+`</kbd> or{" "}
                  <kbd className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px]">Cmd+J</kbd>) and paste:
                </p>
                <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800/50">
                    <span className="text-[10px] uppercase tracking-wide text-neutral-500">Commands</span>
                    {(maintenanceScript.trim() || devScript.trim()) && (
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
                        {commandsCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                  <pre className="px-3 py-2 text-[11px] font-mono text-neutral-900 dark:text-neutral-100 overflow-x-auto whitespace-pre-wrap break-all select-all">
                    {maintenanceScript.trim() || devScript.trim() ? (
                      [maintenanceScript.trim(), devScript.trim()].filter(Boolean).join(" && ")
                    ) : (
                      <span className="text-neutral-400 italic">No scripts configured</span>
                    )}
                  </pre>
                </div>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Proceed once dev script is running.
                </p>
              </div>
            </details>
            {isCurrentStep("run-scripts") && (
              <button
                type="button"
                onClick={handleNextConfigStep}
                className="w-full mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition cursor-pointer"
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Step 4: Browser Setup */}
        {isStepVisible("browser-setup") && (
          <div>
            <details className="group" open={isCurrentStep("browser-setup")}>
              <summary
                className={clsx(
                  "flex items-center gap-2 list-none",
                  isSaving ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                )}
                onClick={(e) => {
                  if (isSaving) return;
                  if (isStepCompleted("browser-setup") && !isCurrentStep("browser-setup")) {
                    e.preventDefault();
                    handleGoToStep("browser-setup");
                  }
                }}
              >
                <ChevronDown className="h-3.5 w-3.5 text-neutral-400 transition-transform -rotate-90 group-open:rotate-0" />
                <StepBadge
                  step={4}
                  done={isStepCompleted("browser-setup") && !isCurrentStep("browser-setup")}
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
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-500 dark:text-neutral-400 flex-shrink-0 mt-0.5">1</span>
                    <span>Sign in to any dashboards or SaaS tools</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-500 dark:text-neutral-400 flex-shrink-0 mt-0.5">2</span>
                    <span>Dismiss cookie banners, popups, or MFA prompts</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-500 dark:text-neutral-400 flex-shrink-0 mt-0.5">3</span>
                    <span>Navigate to your dev server URL (e.g., localhost:3000)</span>
                  </li>
                </ul>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Proceed once browser is set up properly.
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
                    Saving...
                  </>
                ) : (
                  "Save configuration"
                )}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // Render initial setup panel
  const renderInitialSetupPanel = () => (
    <div className="min-h-full bg-white dark:bg-black font-sans overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* Back button */}
        {onBackToRepositorySelection && (
          <div className="mb-3">
            <button
              type="button"
              onClick={onBackToRepositorySelection}
              className="inline-flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to repository selection
            </button>
          </div>
        )}

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
            Configure environment
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 pt-2">
            Your workspace root at{" "}
            <code className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-xs text-neutral-700 dark:text-neutral-300">
              {WORKSPACE_ROOT}
            </code>{" "}
            contains all selected repositories.
          </p>
        </div>

        {/* Content */}
        {renderInitialSetupContent()}

        {/* Error Message */}
        {errorMessage && (
          <div className="rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 p-3 mt-6">
            <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
          </div>
        )}

        {/* Footer Button */}
        <div className="mt-8 pt-6 border-t border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            onClick={handleStartWorkspaceConfig}
            disabled={!isWorkspaceReady && !isProvisioning}
            className={clsx(
              "w-full inline-flex items-center justify-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold transition",
              "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200 cursor-pointer",
              (!isWorkspaceReady && !isProvisioning) && "opacity-50 cursor-not-allowed"
            )}
          >
            {isProvisioning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Launching environment...
              </>
            ) : (
              <>
                Continue
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  // Render workspace config panel
  const renderWorkspaceConfigPanel = () => (
    <div className="w-[420px] h-full flex flex-col overflow-hidden border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-black">
      <div className="flex-shrink-0 px-5 pt-4 pb-2">
        <button
          type="button"
          onClick={handleBackToInitialSetup}
          disabled={isSaving}
          className={clsx(
            "inline-flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400 mb-3",
            isSaving ? "opacity-50 cursor-not-allowed" : "hover:text-neutral-900 dark:hover:text-neutral-100"
          )}
        >
          <ArrowLeft className="h-3 w-3" />
          Back to project setup
        </button>
        <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 tracking-tight">
          Configure workspace
        </h1>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed pt-2">
          {selectedRepos.length} repositor{selectedRepos.length === 1 ? "y" : "ies"} in{" "}
          <code className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-700 dark:text-neutral-300">
            {WORKSPACE_ROOT}
          </code>
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {renderWorkspaceStepContent()}

        {errorMessage && (
          <div className="rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 p-3 mt-4">
            <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
          </div>
        )}
      </div>
    </div>
  );

  // Initial setup layout
  if (layoutPhase === "initial-setup") {
    return renderInitialSetupPanel();
  }

  // Show loading if workspace isn't ready
  if (!isWorkspaceReady) {
    return (
      <div className="flex min-h-full items-center justify-center bg-white dark:bg-black font-sans">
        <div className="text-center px-6">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-neutral-400" />
          <h1 className="mt-4 text-lg font-medium text-neutral-900 dark:text-neutral-100">
            Starting your VS Code workspace...
          </h1>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            We'll show the configuration once your environment is ready.
          </p>
        </div>
      </div>
    );
  }

  // Workspace config layout (split with sidebar + preview)
  return (
    <div className="flex h-full overflow-hidden bg-neutral-50 dark:bg-neutral-950 font-sans text-[15px] leading-6">
      {/* Left: Configuration Form */}
      {renderWorkspaceConfigPanel()}

      {/* Right: Preview Panel */}
      <div className="flex-1 flex flex-col bg-neutral-950 overflow-hidden">
        {renderPreviewPanel()}
      </div>
    </div>
  );
}
