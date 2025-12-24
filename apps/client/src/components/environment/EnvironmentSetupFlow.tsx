/**
 * Environment Setup Flow
 *
 * Orchestrates the two-phase environment configuration flow:
 * 1. Initial Setup Phase - Full-page form for repos, framework, scripts, env vars
 * 2. Workspace Configuration Phase - Split view with VS Code/Browser for verification
 *
 * This flow is inspired by preview.new but supports:
 * - Multiple repositories (workspace root is one level above repo roots)
 * - Both electron and web versions
 */

import type {
  EnvVar,
  FrameworkPreset,
  LayoutPhase,
  PackageManager,
} from "@cmux/shared/components/environment";
import {
  deriveVncWebsocketUrl,
  deriveVscodeUrl,
  ensureInitialEnvVars,
  getFrameworkPresetConfig,
} from "@cmux/shared/components/environment";
import { formatEnvVarsContent } from "@cmux/shared/utils/format-env-vars-content";
import { validateExposedPorts } from "@cmux/shared/utils/validate-exposed-ports";
import {
  postApiEnvironmentsMutation,
  postApiSandboxesByIdEnvMutation,
} from "@cmux/www-openapi-client/react-query";
import { useMutation as useRQMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { EnvironmentInitialSetup } from "./EnvironmentInitialSetup";
import { EnvironmentWorkspaceConfig } from "./EnvironmentWorkspaceConfig";

interface EnvironmentSetupFlowProps {
  teamSlugOrId: string;
  selectedRepos: string[];
  instanceId?: string;
  initialEnvName?: string;
  initialMaintenanceScript?: string;
  initialDevScript?: string;
  initialExposedPorts?: string;
  initialEnvVars?: EnvVar[];
  initialFrameworkPreset?: FrameworkPreset;
  onEnvironmentSaved?: () => void;
  onBack?: () => void;
}

export function EnvironmentSetupFlow({
  teamSlugOrId,
  selectedRepos,
  instanceId,
  initialEnvName = "",
  initialMaintenanceScript = "",
  initialDevScript = "",
  initialExposedPorts = "",
  initialEnvVars,
  initialFrameworkPreset = "other",
  onEnvironmentSaved,
  onBack,
}: EnvironmentSetupFlowProps) {
  const navigate = useNavigate();

  // Layout phase state
  const [layoutPhase, setLayoutPhase] = useState<LayoutPhase>("initial-setup");

  // Configuration state
  const [envName] = useState(initialEnvName);
  const [envVars, setEnvVars] = useState<EnvVar[]>(() =>
    ensureInitialEnvVars(initialEnvVars)
  );
  const [maintenanceScript, setMaintenanceScript] = useState(initialMaintenanceScript);
  const [devScript, setDevScript] = useState(initialDevScript);
  const [exposedPorts] = useState(initialExposedPorts);
  const [frameworkPreset, setFrameworkPreset] = useState<FrameworkPreset>(initialFrameworkPreset);
  const [detectedPackageManager, setDetectedPackageManager] = useState<PackageManager>("npm");
  const [isDetectingFramework, setIsDetectingFramework] = useState(false);

  // Error state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Derived URLs
  const vscodeUrl = useMemo((): string | undefined => {
    if (!instanceId) return undefined;
    return deriveVscodeUrl(instanceId) ?? undefined;
  }, [instanceId]);

  const vncWebsocketUrl = useMemo((): string | undefined => {
    return deriveVncWebsocketUrl(instanceId, vscodeUrl) ?? undefined;
  }, [instanceId, vscodeUrl]);

  // Framework detection (only fetch if we have repos)
  const hasUserEditedScriptsRef = useRef(false);

  useEffect(() => {
    if (selectedRepos.length === 0) return;

    const detectFramework = async () => {
      setIsDetectingFramework(true);
      try {
        // Use the first repo for framework detection
        const repo = selectedRepos[0];
        const response = await fetch(
          `/api/integrations/github/framework-detection?repo=${encodeURIComponent(repo)}`
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

        // Only update UI state if user hasn't edited scripts yet
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

  // Mutations
  const createEnvironmentMutation = useRQMutation(postApiEnvironmentsMutation());
  const applySandboxEnvMutation = useRQMutation(postApiSandboxesByIdEnvMutation());

  // Auto-apply env vars to sandbox
  const lastSubmittedEnvContent = useRef<string | null>(null);

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
      applySandboxEnvMutation.mutate(
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
  }, [applySandboxEnvMutation, envVars, instanceId, teamSlugOrId]);

  // Handlers
  const handleMaintenanceScriptChange = useCallback((value: string) => {
    setMaintenanceScript(value);
    hasUserEditedScriptsRef.current = true;
  }, []);

  const handleDevScriptChange = useCallback((value: string) => {
    setDevScript(value);
    hasUserEditedScriptsRef.current = true;
  }, []);

  const handleEnvVarsChange = useCallback((updater: (prev: EnvVar[]) => EnvVar[]) => {
    setEnvVars((prev) => updater(prev));
  }, []);

  const handleFrameworkPresetChange = useCallback(
    (preset: FrameworkPreset) => {
      setFrameworkPreset(preset);
      // Only auto-fill if user hasn't manually edited the scripts
      if (!hasUserEditedScriptsRef.current) {
        const presetConfig = getFrameworkPresetConfig(preset, detectedPackageManager);
        setMaintenanceScript(presetConfig.maintenanceScript);
        setDevScript(presetConfig.devScript);
      }
    },
    [detectedPackageManager]
  );

  const handleContinueToWorkspaceConfig = useCallback(() => {
    setLayoutPhase("workspace-config");
  }, []);

  const handleBackToInitialSetup = useCallback(() => {
    setLayoutPhase("initial-setup");
  }, []);

  const handleSaveEnvironment = useCallback(async () => {
    if (!instanceId) {
      console.error("Missing instanceId for save");
      return;
    }

    // Generate env name if not set
    const finalEnvName =
      envName.trim() ||
      (() => {
        const now = new Date();
        const dateTime = now.toISOString().replace(/[:.]/g, "-").slice(0, -5);
        const repoName = selectedRepos[0]?.split("/").pop() || "environment";
        return `${repoName}-${dateTime}`;
      })();

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

    // Parse and validate ports
    const parsedPorts = exposedPorts
      .split(",")
      .map((p) => Number.parseInt(p.trim(), 10))
      .filter((n) => Number.isFinite(n));

    const validation = validateExposedPorts(parsedPorts);
    if (validation.reserved.length > 0) {
      setErrorMessage(`Reserved ports cannot be exposed: ${validation.reserved.join(", ")}`);
      return;
    }
    if (validation.invalid.length > 0) {
      setErrorMessage("Ports must be positive integers.");
      return;
    }

    setErrorMessage(null);
    const ports = validation.sanitized;

    createEnvironmentMutation.mutate(
      {
        body: {
          teamSlugOrId,
          name: finalEnvName,
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
          setErrorMessage("Failed to create environment. Please try again.");
        },
      }
    );
  }, [
    createEnvironmentMutation,
    devScript,
    envName,
    envVars,
    exposedPorts,
    instanceId,
    maintenanceScript,
    navigate,
    onEnvironmentSaved,
    selectedRepos,
    teamSlugOrId,
  ]);

  // Initial Setup Phase
  if (layoutPhase === "initial-setup") {
    return (
      <EnvironmentInitialSetup
        selectedRepos={selectedRepos}
        maintenanceScript={maintenanceScript}
        devScript={devScript}
        envVars={envVars}
        frameworkPreset={frameworkPreset}
        detectedPackageManager={detectedPackageManager}
        isDetectingFramework={isDetectingFramework}
        onMaintenanceScriptChange={handleMaintenanceScriptChange}
        onDevScriptChange={handleDevScriptChange}
        onEnvVarsChange={handleEnvVarsChange}
        onFrameworkPresetChange={handleFrameworkPresetChange}
        onContinue={handleContinueToWorkspaceConfig}
        onBack={onBack}
        backLabel="Back to repository selection"
      />
    );
  }

  // Workspace Configuration Phase
  return (
    <EnvironmentWorkspaceConfig
      selectedRepos={selectedRepos}
      maintenanceScript={maintenanceScript}
      devScript={devScript}
      envVars={envVars}
      vscodeUrl={vscodeUrl}
      vncWebsocketUrl={vncWebsocketUrl}
      isSaving={createEnvironmentMutation.isPending}
      errorMessage={errorMessage}
      onMaintenanceScriptChange={handleMaintenanceScriptChange}
      onDevScriptChange={handleDevScriptChange}
      onEnvVarsChange={handleEnvVarsChange}
      onSave={handleSaveEnvironment}
      onBack={handleBackToInitialSetup}
    />
  );
}
