import { GitHubIcon } from "@/components/icons/github";
import { PersistentWebView } from "@/components/persistent-webview";
import { WorkspaceLoadingIndicator } from "@/components/workspace-loading-indicator";
import { ScriptTextareaField } from "@/components/ScriptTextareaField";
import { SCRIPT_COPY } from "@/components/scriptCopy";
import { ResizableColumns } from "@/components/ResizableColumns";
import { parseEnvBlock } from "@/lib/parseEnvBlock";
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
import type { MorphSnapshotId } from "@cmux/shared";
import { validateExposedPorts } from "@cmux/shared/utils/validate-exposed-ports";
import {
  postApiEnvironmentsMutation,
  postApiSandboxesByIdEnvMutation,
  postApiEnvironmentsByIdSnapshotsMutation,
} from "@cmux/www-openapi-client/react-query";
import { Accordion, AccordionItem } from "@heroui/react";
import { useMutation as useRQMutation } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { Id } from "@cmux/convex/dataModel";
import clsx from "clsx";
import type { PersistentIframeStatus } from "@/components/persistent-iframe";
import {
  ArrowLeft,
  Code2,
  Loader2,
  Minus,
  Monitor,
  PanelsTopBottom,
  Plus,
  Settings,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import TextareaAutosize from "react-textarea-autosize";
import { toast } from "sonner";

type PreviewLayout = "split" | "vscode" | "browser";

const MIN_PREVIEW_SPLIT = 0.3;
const MAX_PREVIEW_SPLIT = 0.7;
const PREVIEW_SPLIT_HANDLE_HEIGHT = 12;
const clampSplitRatio = (value: number): number =>
  Math.min(Math.max(value, MIN_PREVIEW_SPLIT), MAX_PREVIEW_SPLIT);

const readStoredSplitRatio = (storageKey: string | null): number => {
  if (typeof window === "undefined" || !storageKey) {
    return 0.5;
  }
  const stored = localStorage.getItem(storageKey);
  const parsed = stored ? Number.parseFloat(stored) : NaN;
  return Number.isFinite(parsed) ? clampSplitRatio(parsed) : 0.5;
};

const forEachIframe = (callback: (iframe: HTMLIFrameElement) => void) => {
  if (typeof document === "undefined") {
    return;
  }
  const iframes = Array.from(document.querySelectorAll("iframe"));
  for (const el of iframes) {
    if (el instanceof HTMLIFrameElement) {
      callback(el);
    }
  }
};

const disableIframePointerEvents = () => {
  forEachIframe((iframe) => {
    const current = iframe.style.pointerEvents;
    iframe.dataset.prevPointerEvents = current ? current : "__unset__";
    iframe.style.pointerEvents = "none";
  });
};

const restoreIframePointerEvents = () => {
  forEachIframe((iframe) => {
    const prev = iframe.dataset.prevPointerEvents;
    if (prev !== undefined) {
      if (prev === "__unset__") {
        iframe.style.removeProperty("pointer-events");
      } else {
        iframe.style.pointerEvents = prev;
      }
      delete iframe.dataset.prevPointerEvents;
    } else {
      iframe.style.removeProperty("pointer-events");
    }
  });
};

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
      persistConfig({ exposedPorts: value });
    },
    [persistConfig]
  );
  const [portsError, setPortsError] = useState<string | null>(null);
  const keyInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(
    null
  );
  const lastSubmittedEnvContent = useRef<string | null>(null);
  const [previewLayout, setPreviewLayout] = useState<PreviewLayout>(() =>
    browserUrl ? "split" : "vscode"
  );
  const userSelectedPreviewRef = useRef(false);
  const previousBrowserAvailabilityRef = useRef(Boolean(browserUrl));
  const [vscodeStatus, setVscodeStatus] =
    useState<PersistentIframeStatus>("loading");
  const [vscodeError, setVscodeError] = useState<string | null>(null);
  const [browserStatus, setBrowserStatus] =
    useState<PersistentIframeStatus>("loading");
  const [browserError, setBrowserError] = useState<string | null>(null);
  const basePersistKey = useMemo(() => {
    if (instanceId) return `env-config:${instanceId}`;
    if (vscodeUrl) return `env-config:${vscodeUrl}`;
    if (browserUrl) return `env-config:${browserUrl}`;
    return "env-config";
  }, [browserUrl, instanceId, vscodeUrl]);
  const splitPersistKey = basePersistKey ? `${basePersistKey}:split` : null;
  const [splitRatio, setSplitRatio] = useState<number>(() =>
    readStoredSplitRatio(splitPersistKey)
  );
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const splitBoundsRef = useRef<{ top: number; height: number }>({
    top: 0,
    height: 1,
  });
  const splitDragRafRef = useRef<number | null>(null);
  const vscodePersistKey = `${basePersistKey}:vscode`;
  const browserPersistKey = `${basePersistKey}:browser`;
  const isBrowserAvailable = Boolean(browserUrl);

  useEffect(() => {
    if (
      !isBrowserAvailable &&
      (previewLayout === "browser" || previewLayout === "split")
    ) {
      setPreviewLayout("vscode");
    }
  }, [isBrowserAvailable, previewLayout]);

  useEffect(() => {
    const wasAvailable = previousBrowserAvailabilityRef.current;
    if (isBrowserAvailable && !wasAvailable && !userSelectedPreviewRef.current) {
      setPreviewLayout("split");
    }
    previousBrowserAvailabilityRef.current = isBrowserAvailable;
  }, [isBrowserAvailable]);

  useEffect(() => {
    if (!splitPersistKey || !isBrowserAvailable) {
      return;
    }
    const next = readStoredSplitRatio(splitPersistKey);
    setSplitRatio((prev) => (Math.abs(prev - next) < 0.001 ? prev : next));
  }, [isBrowserAvailable, splitPersistKey]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !splitPersistKey ||
      !isBrowserAvailable
    ) {
      return;
    }
    localStorage.setItem(splitPersistKey, String(splitRatio));
  }, [isBrowserAvailable, splitPersistKey, splitRatio]);

  useEffect(() => {
    setVscodeStatus("loading");
    setVscodeError(null);
  }, [vscodeUrl]);

  useEffect(() => {
    setBrowserStatus("loading");
    setBrowserError(null);
  }, [browserUrl]);

  const createEnvironmentMutation = useRQMutation(
    postApiEnvironmentsMutation()
  );
  const createSnapshotMutation = useRQMutation(
    postApiEnvironmentsByIdSnapshotsMutation()
  );
  const applySandboxEnvMutation = useRQMutation(
    postApiSandboxesByIdEnvMutation()
  );
  const applySandboxEnv = applySandboxEnvMutation.mutate;

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

  const handlePreviewSelect = useCallback(
    (view: PreviewLayout) => {
      if (!isBrowserAvailable && (view === "browser" || view === "split")) {
        return;
      }
      userSelectedPreviewRef.current = true;
      setPreviewLayout(view);
    },
    [isBrowserAvailable]
  );

  const handleVscodeLoad = useCallback(() => {
    setVscodeError(null);
    setVscodeStatus("loaded");
  }, []);

  const handleVscodeError = useCallback((error: Error) => {
    console.error("Failed to load VS Code workspace iframe", error);
    setVscodeError(
      "We couldn’t load VS Code. Try reloading or restarting the environment."
    );
    setVscodeStatus("error");
  }, []);

  const handleBrowserLoad = useCallback(() => {
    setBrowserError(null);
    setBrowserStatus("loaded");
  }, []);

  const handleBrowserError = useCallback((error: Error) => {
    console.error("Failed to load browser workspace iframe", error);
    setBrowserError(
      "We couldn’t load the browser. Try reloading or restarting the environment."
    );
    setBrowserStatus("error");
  }, []);

  const handleSplitMouseMove = useCallback(
    (event: MouseEvent) => {
      if (splitDragRafRef.current != null) {
        return;
      }
      splitDragRafRef.current = window.requestAnimationFrame(() => {
        splitDragRafRef.current = null;
        const { top, height } = splitBoundsRef.current;
        if (!height) {
          return;
        }
        const relative = (event.clientY - top) / height;
        setSplitRatio(clampSplitRatio(relative));
      });
    },
    []
  );

  const stopSplitResizing = useCallback(() => {
    if (typeof document !== "undefined") {
      document.body.style.cursor = "";
      document.body.classList.remove("select-none");
    }
    restoreIframePointerEvents();
    if (splitDragRafRef.current != null) {
      cancelAnimationFrame(splitDragRafRef.current);
      splitDragRafRef.current = null;
    }
    window.removeEventListener("mousemove", handleSplitMouseMove);
    window.removeEventListener("mouseup", stopSplitResizing);
  }, [handleSplitMouseMove]);

  const startSplitResizing = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (previewLayout !== "split") {
        return;
      }
      event.preventDefault();
      const container = splitContainerRef.current;
      if (!container) {
        return;
      }
      if (typeof document !== "undefined") {
        document.body.style.cursor = "row-resize";
        document.body.classList.add("select-none");
      }
      const rect = container.getBoundingClientRect();
      splitBoundsRef.current = { top: rect.top, height: rect.height };
      disableIframePointerEvents();
      window.addEventListener("mousemove", handleSplitMouseMove);
      window.addEventListener("mouseup", stopSplitResizing);
    },
    [handleSplitMouseMove, previewLayout, stopSplitResizing]
  );

  useEffect(() => {
    return () => {
      if (splitDragRafRef.current != null) {
        cancelAnimationFrame(splitDragRafRef.current);
        splitDragRafRef.current = null;
      }
      window.removeEventListener("mousemove", handleSplitMouseMove);
      window.removeEventListener("mouseup", stopSplitResizing);
      restoreIframePointerEvents();
    };
  }, [handleSplitMouseMove, stopSplitResizing]);

  // no-op placeholder removed; using onSnapshot instead

  useEffect(() => {
    lastSubmittedEnvContent.current = null;
  }, [instanceId]);

  useEffect(() => {
    if (!instanceId) {
      return;
    }

    const envVarsContent = formatEnvVarsContent(
      envVars
        .filter((r) => r.name.trim().length > 0)
        .map((r) => ({ name: r.name, value: r.value }))
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

  const onSnapshot = async (): Promise<void> => {
    if (!instanceId) {
      console.error("Missing instanceId for snapshot");
      return;
    }
    if (!envName.trim()) {
      console.error("Environment name is required");
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
      // Create a new snapshot version
      createSnapshotMutation.mutate(
        {
          path: { id: sourceEnvironmentId },
          body: {
            teamSlugOrId,
            morphInstanceId: instanceId,
            label: envName.trim(),
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
          onError: (err) => {
            console.error("Failed to create snapshot version:", err);
          },
        }
      );
    } else {
      // Create a new environment
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
          onError: (err) => {
            console.error("Failed to create environment:", err);
          },
        }
      );
    }
  };

  const showVscodeOverlay =
    vscodeStatus !== "loaded" || vscodeError !== null;
  const showBrowserOverlay =
    browserStatus !== "loaded" || browserError !== null;
  const browserLoadingFallback = useMemo(
    () => <WorkspaceLoadingIndicator variant="browser" status="loading" />,
    []
  );
  const browserErrorFallback = useMemo(
    () => <WorkspaceLoadingIndicator variant="browser" status="error" />,
    []
  );

  const renderVscodePreview = () => {
    if (!vscodeUrl) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center">
          <div className="space-y-3">
            <Loader2 className="w-6 h-6 mx-auto animate-spin text-neutral-500 dark:text-neutral-400" />
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Waiting for the VS Code workspace URL...
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="relative h-full" aria-busy={showVscodeOverlay}>
        <div
          aria-hidden={!showVscodeOverlay}
          className={clsx(
            "absolute inset-0 z-[var(--z-low)] flex items-center justify-center backdrop-blur-sm transition-opacity duration-300",
            "bg-white/60 dark:bg-neutral-950/60",
            showVscodeOverlay
              ? "opacity-100 pointer-events-auto"
              : "opacity-0 pointer-events-none"
          )}
        >
          {vscodeError ? (
            <div className="text-center max-w-sm px-6">
              <X className="w-8 h-8 mx-auto mb-3 text-red-500" />
              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                {vscodeError}
              </p>
            </div>
          ) : (
            <div className="text-center">
              <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin text-neutral-500 dark:text-neutral-400" />
              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                Loading VS Code...
              </p>
            </div>
          )}
        </div>
        <PersistentWebView
          persistKey={vscodePersistKey}
          src={vscodeUrl}
          className="absolute inset-0"
          iframeClassName="w-full h-full border-0"
          allow={TASK_RUN_IFRAME_ALLOW}
          sandbox={TASK_RUN_IFRAME_SANDBOX}
          retainOnUnmount
          onLoad={handleVscodeLoad}
          onError={handleVscodeError}
          onStatusChange={setVscodeStatus}
          loadTimeoutMs={60_000}
          fallbackClassName="bg-neutral-50 dark:bg-neutral-950"
          errorFallbackClassName="bg-neutral-50 dark:bg-neutral-950"
        />
      </div>
    );
  };

  const renderBrowserPreview = () => {
    if (!browserUrl) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center">
          <div className="space-y-3">
            <Loader2 className="w-6 h-6 mx-auto animate-spin text-neutral-500 dark:text-neutral-400" />
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Waiting for the workspace browser to be ready...
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="relative h-full" aria-busy={showBrowserOverlay}>
        <PersistentWebView
          persistKey={browserPersistKey}
          src={browserUrl}
          className="absolute inset-0"
          iframeClassName="w-full h-full border-0"
          allow={TASK_RUN_IFRAME_ALLOW}
          sandbox={TASK_RUN_IFRAME_SANDBOX}
          retainOnUnmount
          onLoad={handleBrowserLoad}
          onError={handleBrowserError}
          onStatusChange={setBrowserStatus}
          fallback={browserLoadingFallback}
          fallbackClassName="bg-neutral-50 dark:bg-neutral-950"
          errorFallback={browserErrorFallback}
          errorFallbackClassName="bg-neutral-50/95 dark:bg-neutral-950/95"
          loadTimeoutMs={60_000}
        />
        <div
          aria-hidden={!showBrowserOverlay}
          className={clsx(
            "absolute inset-0 z-[var(--z-low)] flex items-center justify-center backdrop-blur-sm transition-opacity duration-300",
            "bg-white/60 dark:bg-neutral-950/60",
            showBrowserOverlay
              ? "opacity-100 pointer-events-auto"
              : "opacity-0 pointer-events-none"
          )}
        >
          {browserError ? (
            <div className="text-center max-w-sm px-6">
              <X className="w-8 h-8 mx-auto mb-3 text-red-500" />
              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                {browserError}
              </p>
            </div>
          ) : (
            <WorkspaceLoadingIndicator variant="browser" status="loading" />
          )}
        </div>
      </div>
    );
  };

  const renderSplitPreview = () => {
    if (!isBrowserAvailable) {
      return renderVscodePreview();
    }
    return (
      <div
        ref={splitContainerRef}
        className="relative flex h-full flex-col"
        aria-label="VS Code and browser split view"
      >
        <div
          className="relative min-h-0"
          style={{ flex: `${splitRatio} 1 0%` }}
        >
          {renderVscodePreview()}
        </div>
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize split view"
          onMouseDown={startSplitResizing}
          className="group relative flex items-center justify-center cursor-row-resize"
          style={{ height: `${PREVIEW_SPLIT_HANDLE_HEIGHT}px` }}
        >
          <div className="absolute left-4 right-4 h-px bg-neutral-200 transition-colors group-hover:bg-neutral-300 dark:bg-neutral-800 dark:group-hover:bg-neutral-700" />
          <div className="z-10 h-3 w-8 rounded-full border border-neutral-200 bg-white/80 dark:border-neutral-700 dark:bg-neutral-900/80" />
        </div>
        <div
          className="relative min-h-0"
          style={{ flex: `${1 - splitRatio} 1 0%` }}
        >
          {renderBrowserPreview()}
        </div>
      </div>
    );
  };

  const previewButtonClass = useCallback(
    (view: PreviewLayout, disabled: boolean) =>
      clsx(
        "inline-flex h-7 w-7 items-center justify-center focus:outline-none text-neutral-600 dark:text-neutral-300",
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-100",
        view === previewLayout && !disabled
          ? "text-neutral-900 dark:text-neutral-100"
          : undefined
      ),
    [previewLayout]
  );

  const headerControls = useMemo(() => {
    if (isProvisioning) {
      return null;
    }

    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => handlePreviewSelect("split")}
          className={previewButtonClass("split", !isBrowserAvailable)}
          aria-pressed={previewLayout === "split"}
          aria-label="Show split view"
          title="Show split view"
          disabled={!isBrowserAvailable}
        >
          <PanelsTopBottom className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => handlePreviewSelect("vscode")}
          className={previewButtonClass("vscode", false)}
          aria-pressed={previewLayout === "vscode"}
          aria-label="Show VS Code workspace"
          title="Show VS Code workspace"
        >
          <Code2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => handlePreviewSelect("browser")}
          className={previewButtonClass("browser", !isBrowserAvailable)}
          aria-pressed={previewLayout === "browser"}
          aria-label="Show browser preview"
          title="Show browser preview"
          disabled={!isBrowserAvailable}
        >
          <Monitor className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }, [
    handlePreviewSelect,
    isBrowserAvailable,
    isProvisioning,
    previewButtonClass,
    previewLayout,
  ]);

  useEffect(() => {
    if (!onHeaderControlsChange) {
      return;
    }
    onHeaderControlsChange(headerControls ?? null);
  }, [headerControls, onHeaderControlsChange]);

  useEffect(() => {
    return () => {
      onHeaderControlsChange?.(null);
    };
  }, [onHeaderControlsChange]);

  const leftPane = (
    <div className="h-full p-6 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-4 mb-4">
        {mode === "new" ? (
          <button
            onClick={async () => {
              onBackToRepositorySelection?.();
              await navigate({
                to: "/$teamSlugOrId/environments/new",
                params: { teamSlugOrId },
                search: {
                  step: "select",
                  selectedRepos:
                    selectedRepos.length > 0 ? selectedRepos : undefined,
                  instanceId: search.instanceId,
                  connectionLogin: search.connectionLogin,
                  repoSearch: search.repoSearch,
                  snapshotId: search.snapshotId,
                },
              });
            }}
            className="inline-flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to repository selection
          </button>
        ) : sourceEnvironmentId ? (
          <button
            onClick={async () => {
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
            }}
            className="inline-flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to environment
          </button>
        ) : null}
      </div>

      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
        {mode === "snapshot"
          ? "Configure Snapshot Version"
          : "Configure Environment"}
      </h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        {mode === "snapshot"
          ? "Update configuration for the new snapshot version."
          : "Set up your environment name and variables."}
      </p>

      <div className="mt-6 space-y-4">
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
        ) : null}

        <Accordion
          selectionMode="multiple"
          className="px-0"
          defaultExpandedKeys={[
            "env-vars",
            "install-dependencies",
            "browser-setup",
            "maintenance-script",
            "dev-script",
          ]}
          itemClasses={{
            trigger: "text-sm cursor-pointer py-3",
            content: "pt-0",
            title: "text-sm font-medium",
          }}
        >
          <AccordionItem
            key="env-vars"
            aria-label="Environment variables"
            title="Environment variables"
          >
            <div
              className="pb-2"
              onPasteCapture={(e) => {
                const text = e.clipboardData?.getData("text") ?? "";
                if (text && (/\n/.test(text) || /(=|:)\s*\S/.test(text))) {
                  e.preventDefault();
                  const items = parseEnvBlock(text);
                  if (items.length > 0) {
                    updateEnvVars((prev) => {
                      const map = new Map(
                        prev
                          .filter(
                            (r) =>
                              r.name.trim().length > 0 ||
                              r.value.trim().length > 0
                          )
                          .map((r) => [r.name, r] as const)
                      );
                      for (const it of items) {
                        if (!it.name) continue;
                        const existing = map.get(it.name);
                        if (existing) {
                          map.set(it.name, {
                            ...existing,
                            value: it.value,
                          });
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
                className="grid gap-3 text-xs text-neutral-500 dark:text-neutral-500 items-center pb-1"
                style={{
                  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr) 44px",
                }}
              >
                <span>Key</span>
                <span>Value</span>
                <span className="w-[44px]" />
              </div>

              <div className="space-y-2">
                {envVars.map((row, idx) => (
                  <div
                    key={idx}
                    className="grid gap-3 items-center"
                    style={{
                      gridTemplateColumns:
                        "minmax(0, 1fr) minmax(0, 1.4fr) 44px",
                    }}
                  >
                    <input
                      type="text"
                      value={row.name}
                      ref={(el) => {
                        keyInputRefs.current[idx] = el;
                      }}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateEnvVars((prev) => {
                          const next = [...prev];
                          next[idx] = { ...next[idx]!, name: v };
                          return next;
                        });
                      }}
                      placeholder="EXAMPLE_NAME"
                      className="w-full min-w-0 self-start rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-sm font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700"
                    />
                    <TextareaAutosize
                      value={row.value}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateEnvVars((prev) => {
                          const next = [...prev];
                          next[idx] = { ...next[idx]!, value: v };
                          return next;
                        });
                      }}
                      placeholder="I9JU23NF394R6HH"
                      minRows={1}
                      maxRows={10}
                      className="w-full min-w-0 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-sm font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 resize-none"
                    />
                    <div className="self-start flex items-center justify-end w-[44px]">
                      <button
                        type="button"
                        onClick={() => {
                          updateEnvVars((prev) => {
                            const next = prev.filter((_, i) => i !== idx);
                            return next.length > 0
                              ? next
                              : [{ name: "", value: "", isSecret: true }];
                          });
                        }}
                        className="h-10 w-[44px] rounded-md border border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 grid place-items-center hover:bg-neutral-50 dark:hover:bg-neutral-900"
                        aria-label="Remove variable"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() =>
                    updateEnvVars((prev) => [
                      ...prev,
                      { name: "", value: "", isSecret: true },
                    ])
                  }
                  className="inline-flex items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <Plus className="w-4 h-4" /> Add More
                </button>
              </div>

              <p className="text-xs text-neutral-500 dark:text-neutral-500 pt-2">
                Tip: Paste an .env above to populate the form. Values are
                encrypted at rest.
              </p>
            </div>
          </AccordionItem>

          <AccordionItem
            key="install-dependencies"
            aria-label="Install dependencies"
            title="Install dependencies"
          >
            <div className="space-y-2 pb-4">
              <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3">
                Use the VS Code terminal to install any dependencies your
                codebase needs.
              </p>
              <p className="text-xs text-neutral-500 dark:text-neutral-500">
                Examples: docker pull postgres, docker run redis, install system
                packages, etc.
              </p>
            </div>
          </AccordionItem>

          <AccordionItem
            key="browser-setup"
            aria-label="Browser VNC setup"
            title="Browser VNC setup"
          >
            <div className="space-y-3 pb-4 text-sm text-neutral-600 dark:text-neutral-400">
              <p>
                Configure the embedded browser so the Browser agent can reuse your
                authenticated session for screenshots, visual verification, and
                cross-app navigation.
              </p>
              <ul className="list-disc space-y-2 pl-5 text-sm text-neutral-600 dark:text-neutral-400">
                <li>
                  Complete SSO, MFA, or product logins now so session cookies are
                  ready when the agent opens the workspace.
                </li>
                <li>
                  Leave the browser on the page you want captured (dashboards,
                  feature flags, admin panels) so screenshots start in the right
                  context.
                </li>
                <li>
                  Pin important tabs and store any temporary access tokens in the
                  browser password manager if the run needs to refresh auth later.
                </li>
              </ul>
              <p className="text-xs text-neutral-500 dark:text-neutral-500">
                Tip: switch to the browser panel above if you need to finish the
                setup before saving the environment.
              </p>
            </div>
          </AccordionItem>

          <AccordionItem
            key="maintenance-script"
            aria-label="Maintenance script"
            title="Maintenance script"
          >
            <div className="pb-4">
              <ScriptTextareaField
                description={SCRIPT_COPY.maintenance.description}
                subtitle={SCRIPT_COPY.maintenance.subtitle}
                value={maintenanceScript}
                onChange={updateMaintenanceScript}
                placeholder={SCRIPT_COPY.maintenance.placeholder}
                descriptionClassName="mb-3"
                minHeightClassName="min-h-[114px]"
              />
            </div>
          </AccordionItem>

          <AccordionItem
            key="dev-script"
            aria-label="Dev script"
            title="Dev script"
          >
            <div className="space-y-4 pb-4">
              <ScriptTextareaField
                description={SCRIPT_COPY.dev.description}
                subtitle={SCRIPT_COPY.dev.subtitle}
                value={devScript}
                onChange={updateDevScript}
                placeholder={SCRIPT_COPY.dev.placeholder}
                minHeightClassName="min-h-[130px]"
              />

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
                <p className="text-xs text-neutral-500 dark:text-neutral-500">
                  Comma-separated list of ports that should be exposed from the
                  container for preview URLs.
                </p>
                {portsError && (
                  <p className="text-xs text-red-500">{portsError}</p>
                )}
              </div>
            </div>
          </AccordionItem>
        </Accordion>

        <div className="pt-2">
          <button
            type="button"
            onClick={onSnapshot}
            disabled={
              isProvisioning ||
              createEnvironmentMutation.isPending ||
              createSnapshotMutation.isPending
            }
            className="inline-flex items-center rounded-md bg-neutral-900 text-white disabled:bg-neutral-300 dark:disabled:bg-neutral-700 disabled:cursor-not-allowed px-4 py-2 text-sm hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {isProvisioning ||
            createEnvironmentMutation.isPending ||
            createSnapshotMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {mode === "snapshot"
                  ? "Creating snapshot..."
                  : "Creating environment..."}
              </>
            ) : mode === "snapshot" ? (
              "Create snapshot version"
            ) : (
              "Snapshot environment"
            )}
          </button>
        </div>
      </div>
    </div>
  );

  const rightPane = (
    <div className="h-full bg-neutral-50 dark:bg-neutral-950">
      {isProvisioning ? (
        <div className="flex h-full items-center justify-center">
          <div className="text-center max-w-md px-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-lg bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center">
              <Settings className="w-8 h-8 text-neutral-500 dark:text-neutral-400" />
            </div>
            <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">
              Launching Environment
            </h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
              {mode === "snapshot"
                ? "Creating instance from snapshot. Once ready, VS Code and the browser will appear here so you can test your changes."
                : "Your development environment is launching. Once ready, VS Code and the browser will appear here so you can configure and test your setup."}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex-1 min-h-0">
            {previewLayout === "browser"
              ? renderBrowserPreview()
              : previewLayout === "split" && isBrowserAvailable
                ? renderSplitPreview()
                : renderVscodePreview()}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <ResizableColumns
      storageKey={null}
      defaultLeftWidth={360}
      minLeft={220}
      maxLeft={700}
      left={leftPane}
      right={rightPane}
    />
  );
}
