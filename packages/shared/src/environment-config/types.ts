/**
 * Shared environment configuration types used across www, client, and electron apps.
 *
 * These types support the multi-repo environment workflow where:
 * - Workspace root is /root/workspace (one level above repo roots)
 * - Multiple repositories can be cloned into /root/workspace/{repoName}
 * - Environment variables, scripts, and exposed ports are shared across all repos
 */

export type EnvVar = {
  name: string;
  value: string;
  isSecret: boolean;
};

export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

export type FrameworkPreset =
  | "other"
  | "next"
  | "vite"
  | "remix"
  | "nuxt"
  | "sveltekit"
  | "angular"
  | "cra"
  | "vue";

export type FrameworkIconKey =
  | "other"
  | "next"
  | "vite"
  | "remix"
  | "nuxt"
  | "svelte"
  | "angular"
  | "react"
  | "vue";

export type FrameworkPresetConfig = {
  name: string;
  maintenanceScript: string;
  devScript: string;
  icon: FrameworkIconKey;
};

/**
 * Environment configuration draft - used during setup/configuration phase
 */
export interface EnvironmentConfigDraft {
  envName: string;
  envVars: EnvVar[];
  maintenanceScript: string;
  devScript: string;
  exposedPorts: string;
}

/**
 * Metadata about the environment being created
 */
export interface EnvironmentDraftMetadata {
  selectedRepos: string[];
  instanceId?: string;
  snapshotId?: string;
}

/**
 * Configuration steps in the workspace configuration phase
 */
export const ALL_CONFIG_STEPS = [
  "scripts", // maintenance + dev scripts
  "env-vars", // environment variables
  "run-scripts", // run scripts in terminal
  "browser-setup", // browser configuration
] as const;

export type ConfigStep = (typeof ALL_CONFIG_STEPS)[number];

/**
 * Layout phases for the environment configuration flow
 */
export type LayoutPhase = "initial-setup" | "transitioning" | "workspace-config";

/**
 * Sandbox instance information
 */
export interface SandboxInstance {
  instanceId: string;
  vscodeUrl: string;
  workerUrl: string;
  vncUrl?: string;
  provider: string;
}

/**
 * Ensure there's always an empty row at the end of env vars
 */
export const ensureInitialEnvVars = (initial?: EnvVar[]): EnvVar[] => {
  const base = (initial ?? []).map((item) => ({
    name: item.name,
    value: item.value,
    isSecret: item.isSecret ?? true,
  }));
  if (base.length === 0) {
    return [{ name: "", value: "", isSecret: true }];
  }
  const last = base[base.length - 1];
  if (!last || last.name.trim().length > 0 || last.value.trim().length > 0) {
    base.push({ name: "", value: "", isSecret: true });
  }
  return base;
};

/**
 * Create an empty environment config
 */
export const createEmptyEnvironmentConfig = (): EnvironmentConfigDraft => ({
  envName: "",
  envVars: ensureInitialEnvVars(),
  maintenanceScript: "",
  devScript: "",
  exposedPorts: "",
});

/**
 * Parse .env file format into env var array
 */
export function parseEnvBlock(text: string): Array<{ name: string; value: string }> {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const results: Array<{ name: string; value: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.length === 0 ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("//")
    ) {
      continue;
    }

    const cleanLine = trimmed.replace(/^export\s+/, "").replace(/^set\s+/, "");
    const eqIdx = cleanLine.indexOf("=");

    if (eqIdx === -1) continue;

    const key = cleanLine.slice(0, eqIdx).trim();
    let value = cleanLine.slice(eqIdx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && !/\s/.test(key)) {
      results.push({ name: key, value });
    }
  }

  return results;
}

/**
 * Constants
 */
export const MASKED_ENV_VALUE = "••••••••••••••••";

/**
 * The workspace root path inside sandboxes
 * This is one level above repo roots to support multiple repositories
 */
export const WORKSPACE_ROOT = "/root/workspace";
