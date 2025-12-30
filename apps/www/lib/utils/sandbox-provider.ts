import { env } from "./www-env";

/**
 * Supported sandbox providers (unified naming)
 * Note: "proxmox" is kept for backwards compatibility and maps to "pve-lxc"
 */
export type SandboxProvider = "morph" | "pve-lxc" | "pve-vm" | "proxmox";

/**
 * Configuration for the active sandbox provider
 */
export interface SandboxProviderConfig {
  provider: SandboxProvider;
  /** For Morph: API key; For Proxmox: not used here */
  apiKey?: string;
  /** For Proxmox: API URL */
  apiUrl?: string;
  /** For Proxmox: API token */
  apiToken?: string;
  /** For Proxmox: node name */
  node?: string;
}

/**
 * Determines which sandbox provider to use based on available environment variables.
 *
 * Selection priority:
 * 1. If SANDBOX_PROVIDER is explicitly set, use that provider
 * 2. If MORPH_API_KEY is set, use Morph (original provider)
 * 3. If PVE_API_URL and PVE_API_TOKEN are set, use Proxmox
 * 4. Throw error if no provider is configured
 */
export function getActiveSandboxProvider(): SandboxProviderConfig {
  const explicitProvider = env.SANDBOX_PROVIDER;

  // Explicit provider selection (support both "proxmox" and "pve-lxc")
  if (explicitProvider === "proxmox" || explicitProvider === "pve-lxc") {
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

  // Auto-detect: Morph takes priority if both are set
  if (env.MORPH_API_KEY) {
    return {
      provider: "morph",
      apiKey: env.MORPH_API_KEY,
    };
  }

  // Check for Proxmox VE LXC (auto-detect defaults to LXC)
  if (env.PVE_API_URL && env.PVE_API_TOKEN) {
    return {
      provider: "pve-lxc",
      apiUrl: env.PVE_API_URL,
      apiToken: env.PVE_API_TOKEN,
      node: env.PVE_NODE,
    };
  }

  throw new Error(
    "No sandbox provider configured. Set either MORPH_API_KEY or (PVE_API_URL + PVE_API_TOKEN)."
  );
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
export function getAvailableSandboxProviders(): ("morph" | "pve-lxc")[] {
  const providers: ("morph" | "pve-lxc")[] = [];
  if (isMorphAvailable()) {
    providers.push("morph");
  }
  if (isProxmoxAvailable()) {
    providers.push("pve-lxc");
  }
  return providers;
}
