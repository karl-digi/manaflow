/**
 * Framework preset configurations for different JavaScript/TypeScript frameworks.
 * These are used to auto-fill maintenance and dev scripts.
 */

import type {
  FrameworkPreset,
  FrameworkPresetConfig,
  FrameworkIconKey,
  PackageManager,
} from "./types";

type FrameworkScriptTemplate = {
  name: string;
  devScriptName: "dev" | "start";
  icon: FrameworkIconKey;
};

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
 * Default presets using npm for backward compatibility
 */
export const FRAMEWORK_PRESETS: Record<FrameworkPreset, FrameworkPresetConfig> = {
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

/**
 * Get all available framework preset keys
 */
export function getFrameworkPresetOptions(): FrameworkPreset[] {
  return Object.keys(FRAMEWORK_PRESETS) as FrameworkPreset[];
}
