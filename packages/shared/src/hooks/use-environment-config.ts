/**
 * Environment configuration hook - shared between client and www apps.
 *
 * This hook provides state management for environment configuration flows,
 * supporting both single-repo (preview.new) and multi-repo modes.
 */

import { useCallback, useMemo, useState } from "react";
import {
  type EnvVar,
  type EnvironmentConfigDraft,
  type FrameworkPreset,
  type PackageManager,
  createEmptyEnvironmentConfig,
  ensureInitialEnvVars,
  getFrameworkPresetConfig,
} from "../environment-config/types";

export interface UseEnvironmentConfigOptions {
  /** Initial config values */
  initialConfig?: Partial<EnvironmentConfigDraft>;
  /** Initial framework preset */
  initialPreset?: FrameworkPreset;
  /** Initial package manager */
  initialPackageManager?: PackageManager;
  /** Callback when config changes */
  onChange?: (config: EnvironmentConfigDraft) => void;
  /** Debounce delay for onChange callback in ms */
  debounceMs?: number;
}

export interface UseEnvironmentConfigReturn {
  /** Current configuration draft */
  config: EnvironmentConfigDraft;
  /** Current framework preset */
  frameworkPreset: FrameworkPreset;
  /** Current package manager */
  packageManager: PackageManager;
  /** Whether the configuration has been modified from initial values */
  isDirty: boolean;
  /** Update environment name */
  setEnvName: (name: string) => void;
  /** Update environment variables */
  setEnvVars: (envVars: EnvVar[]) => void;
  /** Update maintenance script */
  setMaintenanceScript: (script: string) => void;
  /** Update dev script */
  setDevScript: (script: string) => void;
  /** Update exposed ports */
  setExposedPorts: (ports: string) => void;
  /** Update framework preset - automatically updates scripts based on package manager */
  setFrameworkPreset: (preset: FrameworkPreset) => void;
  /** Update package manager - automatically updates scripts based on framework preset */
  setPackageManager: (pm: PackageManager) => void;
  /** Apply detected framework/package manager from API */
  applyDetectedFramework: (
    framework: FrameworkPreset,
    pm: PackageManager,
    detectedScripts?: { maintenanceScript?: string; devScript?: string }
  ) => void;
  /** Reset config to initial or empty state */
  resetConfig: () => void;
  /** Get the full config object */
  getConfig: () => EnvironmentConfigDraft;
}

/**
 * Hook for managing environment configuration state.
 *
 * Features:
 * - Framework preset selection with auto-generated scripts
 * - Package manager detection and script generation
 * - Environment variables management
 * - Dirty tracking for save prompts
 */
export function useEnvironmentConfig(
  options: UseEnvironmentConfigOptions = {}
): UseEnvironmentConfigReturn {
  const {
    initialConfig,
    initialPreset = "other",
    initialPackageManager = "npm",
    onChange,
  } = options;

  // Initialize config with defaults merged with initial values
  const [config, setConfigState] = useState<EnvironmentConfigDraft>(() => {
    const base = createEmptyEnvironmentConfig();
    return {
      ...base,
      ...initialConfig,
      envVars: ensureInitialEnvVars(initialConfig?.envVars),
    };
  });

  const [frameworkPreset, setFrameworkPresetState] = useState<FrameworkPreset>(initialPreset);
  const [packageManager, setPackageManagerState] = useState<PackageManager>(initialPackageManager);
  const [isDirty, setIsDirty] = useState(false);

  // Stable reference to initial config for comparison
  const initialConfigRef = useMemo(() => {
    const base = createEmptyEnvironmentConfig();
    return {
      ...base,
      ...initialConfig,
      envVars: ensureInitialEnvVars(initialConfig?.envVars),
    };
  }, [initialConfig]);

  // Update wrapper that marks dirty and calls onChange
  const updateConfig = useCallback(
    (updater: (prev: EnvironmentConfigDraft) => EnvironmentConfigDraft) => {
      setConfigState((prev) => {
        const next = updater(prev);
        setIsDirty(true);
        onChange?.(next);
        return next;
      });
    },
    [onChange]
  );

  const setEnvName = useCallback(
    (name: string) => {
      updateConfig((prev) => ({ ...prev, envName: name }));
    },
    [updateConfig]
  );

  const setEnvVars = useCallback(
    (envVars: EnvVar[]) => {
      updateConfig((prev) => ({ ...prev, envVars }));
    },
    [updateConfig]
  );

  const setMaintenanceScript = useCallback(
    (script: string) => {
      updateConfig((prev) => ({ ...prev, maintenanceScript: script }));
    },
    [updateConfig]
  );

  const setDevScript = useCallback(
    (script: string) => {
      updateConfig((prev) => ({ ...prev, devScript: script }));
    },
    [updateConfig]
  );

  const setExposedPorts = useCallback(
    (ports: string) => {
      updateConfig((prev) => ({ ...prev, exposedPorts: ports }));
    },
    [updateConfig]
  );

  const setFrameworkPreset = useCallback(
    (preset: FrameworkPreset) => {
      setFrameworkPresetState(preset);
      const presetConfig = getFrameworkPresetConfig(preset, packageManager);
      updateConfig((prev) => ({
        ...prev,
        maintenanceScript: presetConfig.maintenanceScript,
        devScript: presetConfig.devScript,
      }));
    },
    [packageManager, updateConfig]
  );

  const setPackageManager = useCallback(
    (pm: PackageManager) => {
      setPackageManagerState(pm);
      const presetConfig = getFrameworkPresetConfig(frameworkPreset, pm);
      updateConfig((prev) => ({
        ...prev,
        maintenanceScript: presetConfig.maintenanceScript,
        devScript: presetConfig.devScript,
      }));
    },
    [frameworkPreset, updateConfig]
  );

  const applyDetectedFramework = useCallback(
    (
      framework: FrameworkPreset,
      pm: PackageManager,
      detectedScripts?: { maintenanceScript?: string; devScript?: string }
    ) => {
      setFrameworkPresetState(framework);
      setPackageManagerState(pm);

      // If detected scripts are provided, use them; otherwise generate from preset
      const presetConfig = getFrameworkPresetConfig(framework, pm);
      updateConfig((prev) => ({
        ...prev,
        maintenanceScript: detectedScripts?.maintenanceScript ?? presetConfig.maintenanceScript,
        devScript: detectedScripts?.devScript ?? presetConfig.devScript,
      }));
    },
    [updateConfig]
  );

  const resetConfig = useCallback(() => {
    setConfigState(initialConfigRef);
    setFrameworkPresetState(initialPreset);
    setPackageManagerState(initialPackageManager);
    setIsDirty(false);
  }, [initialConfigRef, initialPreset, initialPackageManager]);

  const getConfig = useCallback(() => config, [config]);

  return {
    config,
    frameworkPreset,
    packageManager,
    isDirty,
    setEnvName,
    setEnvVars,
    setMaintenanceScript,
    setDevScript,
    setExposedPorts,
    setFrameworkPreset,
    setPackageManager,
    applyDetectedFramework,
    resetConfig,
    getConfig,
  };
}
