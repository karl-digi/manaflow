import { env } from "./www-env";
import { CONFIG_PROVIDERS, DEFAULT_SANDBOX_PROVIDER, type ConfigProvider } from "@cmux/shared/provider-types";

/**
 * Configuration for the active sandbox provider.
 * `provider` is a string so unknown/external providers (e.g. "e2b") don't
 * require changes here -- the server starts and defers to other layers.
 */
export interface SandboxProviderConfig {
  provider: string;
  /** For Morph: API key; For Proxmox: not used here */
  apiKey?: string;
  /** For Proxmox: API URL */
  apiUrl?: string;
  /** For Proxmox: API token */
  apiToken?: string;
  /** For Proxmox: node name */
  node?: string;
}

function isConfigProvider(value: string): value is ConfigProvider {
  return (CONFIG_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Resolve the DEFAULT_SANDBOX_PROVIDER with matching credentials when available.
 * Uses the same explicit-provider branches so credentials are attached correctly.
 */
function resolveDefault(): SandboxProviderConfig {
  const provider: string = DEFAULT_SANDBOX_PROVIDER;

  if ((provider === "pve-lxc" || provider === "pve-vm") && env.PVE_API_URL && env.PVE_API_TOKEN) {
    return {
      provider,
      apiUrl: env.PVE_API_URL,
      apiToken: env.PVE_API_TOKEN,
      node: env.PVE_NODE,
    };
  }

  if (provider === "morph" && env.MORPH_API_KEY) {
    return {
      provider: "morph",
      apiKey: env.MORPH_API_KEY,
    };
  }

  return { provider };
}

/**
 * Determines which sandbox provider to use based on available environment variables.
 *
 * Selection priority:
 * 1. If SANDBOX_PROVIDER is a known config provider (morph/pve-lxc/pve-vm), use it
 * 2. If SANDBOX_PROVIDER is unknown (e.g. "e2b"), fall back to DEFAULT_SANDBOX_PROVIDER
 * 3. If SANDBOX_PROVIDER is unset, auto-detect from credentials (MORPH_API_KEY / PVE_*)
 * 4. Fall back to DEFAULT_SANDBOX_PROVIDER
 */
export function getActiveSandboxProvider(): SandboxProviderConfig {
  const explicitProvider = env.SANDBOX_PROVIDER;

  // Explicit provider selection
  if (explicitProvider === "pve-lxc") {
    if (!env.PVE_API_URL || !env.PVE_API_TOKEN) {
      throw new Error(
        "PVE provider selected but PVE_API_URL or PVE_API_TOKEN is not set."
      );
    }
    return {
      provider: "pve-lxc",
      apiUrl: env.PVE_API_URL,
      apiToken: env.PVE_API_TOKEN,
      node: env.PVE_NODE,
    };
  }

  if (explicitProvider === "pve-vm") {
    if (!env.PVE_API_URL || !env.PVE_API_TOKEN) {
      throw new Error(
        "SANDBOX_PROVIDER=pve-vm but PVE_API_URL or PVE_API_TOKEN is not set."
      );
    }
    return {
      provider: "pve-vm",
      apiUrl: env.PVE_API_URL,
      apiToken: env.PVE_API_TOKEN,
      node: env.PVE_NODE,
    };
  }

  if (explicitProvider === "morph") {
    if (!env.MORPH_API_KEY) {
      throw new Error("SANDBOX_PROVIDER=morph but MORPH_API_KEY is not set.");
    }
    return {
      provider: "morph",
      apiKey: env.MORPH_API_KEY,
    };
  }

  // Unknown/external provider (e.g. "e2b", "modal", "daytona") --
  // the www sandbox provisioning layer only knows morph / pve-lxc / pve-vm,
  // so skip credential auto-detect and fall back to DEFAULT_SANDBOX_PROVIDER.
  // The raw SANDBOX_PROVIDER value is still available via env.SANDBOX_PROVIDER
  // for layers that handle it (e.g. Convex devbox).
  if (explicitProvider && !isConfigProvider(explicitProvider)) {
    console.warn(
      `Unknown SANDBOX_PROVIDER="${explicitProvider}", falling back to "${DEFAULT_SANDBOX_PROVIDER}"`,
    );
    return resolveDefault();
  }

  // No explicit provider set -- auto-detect from credentials
  if (env.MORPH_API_KEY) {
    return {
      provider: "morph",
      apiKey: env.MORPH_API_KEY,
    };
  }

  if (env.PVE_API_URL && env.PVE_API_TOKEN) {
    return {
      provider: "pve-lxc",
      apiUrl: env.PVE_API_URL,
      apiToken: env.PVE_API_TOKEN,
      node: env.PVE_NODE,
    };
  }

  // No credentials detected -- fall back to the project-wide default.
  return resolveDefault();
}

/**
 * Check if Morph provider is available
 */
export function isMorphAvailable(): boolean {
  return Boolean(env.MORPH_API_KEY);
}

/**
 * Check if Proxmox provider is available
 */
export function isProxmoxAvailable(): boolean {
  return Boolean(env.PVE_API_URL && env.PVE_API_TOKEN);
}

/**
 * Get a list of all available sandbox providers
 */
export function getAvailableSandboxProviders(): Array<Extract<ConfigProvider, "morph" | "pve-lxc">> {
  const providers: Array<Extract<ConfigProvider, "morph" | "pve-lxc">> = [];
  if (isMorphAvailable()) {
    providers.push("morph");
  }
  if (isProxmoxAvailable()) {
    providers.push("pve-lxc");
  }
  return providers;
}
