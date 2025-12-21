/**
 * Environment configuration types - shared between client and www apps.
 *
 * These types support the multi-repo environment workflow where:
 * - Workspace root is one level ABOVE the repo roots (e.g., /root/workspace/)
 * - Multiple repos are cloned as subdirectories (e.g., /root/workspace/repo1/, /root/workspace/repo2/)
 * - This differs from preview.new where repo root === workspace root (single repo only)
 */

import type { MorphSnapshotId } from "../morph-snapshots";

/** Package manager types for script generation */
export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

/** Framework preset types for auto-detection and script generation */
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

/** Single environment variable with secret flag */
export type EnvVar = {
  name: string;
  value: string;
  isSecret: boolean;
};

/**
 * Ensures env vars array has at least one empty row for input.
 * Returns a new array with an empty row appended if needed.
 */
export function ensureInitialEnvVars(initial?: EnvVar[]): EnvVar[] {
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
}

/**
 * Configuration draft for a single environment.
 * Used during the environment creation/editing flow.
 */
export interface EnvironmentConfigDraft {
  /** Display name for the environment */
  envName: string;
  /** Environment variables to apply */
  envVars: EnvVar[];
  /** Script to run for maintenance/dependency installation */
  maintenanceScript: string;
  /** Script to run to start the dev server */
  devScript: string;
  /** Comma-separated ports to expose from the container */
  exposedPorts: string;
}

/**
 * Metadata about the environment being configured.
 * Contains info about repos, sandbox instance, and snapshot preset.
 */
export interface EnvironmentDraftMetadata {
  /**
   * List of selected repositories in "owner/repo" format.
   * For multi-repo support, this can contain multiple entries.
   * Each repo is cloned to a subdirectory of the workspace root.
   */
  selectedRepos: string[];
  /** Morph VM instance ID if already provisioned */
  instanceId?: string;
  /** Snapshot preset ID for the base image */
  snapshotId?: MorphSnapshotId;
}

/**
 * Creates an empty environment config draft with default values.
 */
export function createEmptyEnvironmentConfig(): EnvironmentConfigDraft {
  return {
    envName: "",
    envVars: ensureInitialEnvVars(),
    maintenanceScript: "",
    devScript: "",
    exposedPorts: "",
  };
}

/**
 * Full environment draft including step tracking and timestamps.
 */
export interface EnvironmentDraft extends EnvironmentDraftMetadata {
  /** Current step in the environment creation flow */
  step: "select" | "configure";
  /** Configuration values being edited */
  config: EnvironmentConfigDraft;
  /** Last update timestamp for staleness detection */
  lastUpdatedAt: number;
}

/**
 * Configuration steps for the workspace configuration phase.
 * These are shown after initial setup in the sidebar.
 */
export type ConfigStep =
  | "scripts"       // Maintenance + dev scripts configuration
  | "env-vars"      // Environment variables
  | "run-scripts"   // Run scripts in VS Code terminal
  | "browser-setup"; // Configure browser for auth, etc.

/**
 * All configuration steps in order for iteration.
 */
export const ALL_CONFIG_STEPS: readonly ConfigStep[] = [
  "scripts",
  "env-vars",
  "run-scripts",
  "browser-setup",
] as const;

/**
 * Layout phases for the environment configuration flow.
 * Controls the UI transition between full-page setup and split-panel workspace config.
 */
export type LayoutPhase =
  | "initial-setup"    // Full-page framework/scripts/env-vars setup
  | "transitioning"    // Animating to split layout
  | "workspace-config"; // Split layout with sidebar + preview

/**
 * Framework preset configuration with generated scripts.
 */
export interface FrameworkPresetConfig {
  name: string;
  maintenanceScript: string;
  devScript: string;
  icon: FrameworkIconKey;
}

/**
 * Icon keys for framework logos.
 */
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

/**
 * Template for generating framework-specific scripts.
 */
interface FrameworkScriptTemplate {
  name: string;
  devScriptName: "dev" | "start";
  icon: FrameworkIconKey;
}

const FRAMEWORK_SCRIPT_TEMPLATES: Record<FrameworkPreset, FrameworkScriptTemplate> = {
  other: { name: "Other", devScriptName: "dev", icon: "other" },
  next: { name: "Next.js", devScriptName: "dev", icon: "next" },
  vite: { name: "Vite", devScriptName: "dev", icon: "vite" },
  remix: { name: "Remix", devScriptName: "dev", icon: "remix" },
  nuxt: { name: "Nuxt", devScriptName: "dev", icon: "nuxt" },
  sveltekit: { name: "SvelteKit", devScriptName: "dev", icon: "svelte" },
  angular: { name: "Angular", devScriptName: "start", icon: "angular" },
  cra: { name: "Create React App", devScriptName: "start", icon: "react" },
  vue: { name: "Vue", devScriptName: "dev", icon: "vue" },
};

/**
 * Get the install command for a package manager.
 */
export function getInstallCommand(pm: PackageManager): string {
  switch (pm) {
    case "bun":
      return "bun install";
    case "pnpm":
      return "pnpm install";
    case "yarn":
      return "yarn install";
    case "npm":
    default:
      return "npm install";
  }
}

/**
 * Get the run command for a package manager and script name.
 */
export function getRunCommand(pm: PackageManager, scriptName: string): string {
  switch (pm) {
    case "bun":
      return `bun run ${scriptName}`;
    case "pnpm":
      return `pnpm run ${scriptName}`;
    case "yarn":
      return `yarn ${scriptName}`;
    case "npm":
    default:
      return `npm run ${scriptName}`;
  }
}

/**
 * Get the full configuration for a framework preset with the specified package manager.
 */
export function getFrameworkPresetConfig(
  preset: FrameworkPreset,
  packageManager: PackageManager = "npm"
): FrameworkPresetConfig {
  const template = FRAMEWORK_SCRIPT_TEMPLATES[preset];
  if (preset === "other") {
    return {
      name: template.name,
      maintenanceScript: "",
      devScript: "",
      icon: template.icon,
    };
  }
  return {
    name: template.name,
    maintenanceScript: getInstallCommand(packageManager),
    devScript: getRunCommand(packageManager, template.devScriptName),
    icon: template.icon,
  };
}

/**
 * Get all framework presets with npm as the default package manager.
 */
export function getAllFrameworkPresets(): Record<FrameworkPreset, FrameworkPresetConfig> {
  return {
    other: getFrameworkPresetConfig("other", "npm"),
    next: getFrameworkPresetConfig("next", "npm"),
    vite: getFrameworkPresetConfig("vite", "npm"),
    remix: getFrameworkPresetConfig("remix", "npm"),
    nuxt: getFrameworkPresetConfig("nuxt", "npm"),
    sveltekit: getFrameworkPresetConfig("sveltekit", "npm"),
    angular: getFrameworkPresetConfig("angular", "npm"),
    cra: getFrameworkPresetConfig("cra", "npm"),
    vue: getFrameworkPresetConfig("vue", "npm"),
  };
}

/**
 * Parse environment variables from a text block (e.g., .env file content).
 * Handles:
 * - Comments (# or //)
 * - export VAR=value and set VAR=value syntax
 * - Quoted values (single or double quotes)
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

    if (eqIdx === -1) {
      continue;
    }

    const key = cleanLine.slice(0, eqIdx).trim();
    let value = cleanLine.slice(eqIdx + 1).trim();

    // Remove surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Validate key (no whitespace)
    if (key && !/\s/.test(key)) {
      results.push({ name: key, value });
    }
  }

  return results;
}

/**
 * Workspace directory structure for multi-repo environments.
 *
 * In multi-repo mode:
 * - workspaceRoot: /root/workspace/
 * - repos are cloned to: /root/workspace/{repo-name}/
 *
 * This differs from preview.new single-repo mode:
 * - workspaceRoot === repoRoot: /root/workspace/ contains the repo directly
 */
export const MULTI_REPO_WORKSPACE_ROOT = "/root/workspace";
