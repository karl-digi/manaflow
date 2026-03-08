import { api } from "@cmux/convex/api";
import {
  AGENT_CONFIGS,
  type DockerStatus,
  type ProviderRequirementsContext,
  type ProviderStatus as SharedProviderStatus,
} from "@cmux/shared";
import { AGENT_CATALOG } from "@cmux/shared/agent-catalog";
import { checkDockerStatus } from "@cmux/shared/providers/common/check-docker";
import { getConvex } from "./convexClient.js";

export interface AggregatedProviderStatus {
  /** Vendor name: "anthropic", "openai", "google", etc. */
  name: string;
  /** True if ANY agent under this vendor is available */
  isAvailable: boolean;
  /** Per-agent availability within this vendor */
  agents: Array<{ name: string; isAvailable: boolean }>;
}

/**
 * Groups per-agent provider statuses into per-vendor aggregated statuses.
 * Uses AGENT_CATALOG to look up each agent's vendor.
 */
export function aggregateByVendor(
  agentStatuses: SharedProviderStatus[]
): AggregatedProviderStatus[] {
  const vendorMap = new Map<string, AggregatedProviderStatus>();

  for (const status of agentStatuses) {
    const catalogEntry = AGENT_CATALOG.find((e) => e.name === status.name);
    const vendor = catalogEntry?.vendor ?? "unknown";

    let entry = vendorMap.get(vendor);
    if (!entry) {
      entry = { name: vendor, isAvailable: false, agents: [] };
      vendorMap.set(vendor, entry);
    }
    entry.agents.push({
      name: status.name,
      isAvailable: status.isAvailable,
    });
    if (status.isAvailable) {
      entry.isAvailable = true;
    }
  }

  return Array.from(vendorMap.values());
}

type CheckAllProvidersStatusOptions = {
  teamSlugOrId?: string;
};

export async function checkAllProvidersStatus(
  options: CheckAllProvidersStatusOptions = {}
): Promise<{
  providers: SharedProviderStatus[];
  dockerStatus: DockerStatus;
}> {
  // Check Docker status
  const dockerStatus = await checkDockerStatus();

  let apiKeys: ProviderRequirementsContext["apiKeys"] = undefined;

  if (options.teamSlugOrId) {
    try {
      apiKeys = await getConvex().query(api.apiKeys.getAllForAgents, {
        teamSlugOrId: options.teamSlugOrId,
      });
    } catch (error) {
      console.warn(
        `Failed to load API keys for team ${options.teamSlugOrId}:`,
        error
      );
    }
  }

  // Check each provider's specific requirements
  const providerChecks = await Promise.all(
    AGENT_CONFIGS.map(async (agent) => {
      // Use the agent's checkRequirements function if available
      const missingRequirements = agent.checkRequirements
        ? await agent.checkRequirements({
            apiKeys,
            teamSlugOrId: options.teamSlugOrId,
          })
        : [];

      return {
        name: agent.name,
        isAvailable: missingRequirements.length === 0,
        missingRequirements:
          missingRequirements.length > 0 ? missingRequirements : undefined,
      };
    })
  );

  return {
    providers: providerChecks,
    dockerStatus,
  };
}

/**
 * Web-mode variant of checkAllProvidersStatus.
 * Only checks if required API keys are present in Convex - does not check
 * local files, keychains, or Docker status (which don't exist in web deployments).
 */
export async function checkAllProvidersStatusWebMode(options: {
  teamSlugOrId: string;
}): Promise<{
  providers: SharedProviderStatus[];
  dockerStatus: DockerStatus;
}> {
  // In web mode, Docker is managed by cloud provider - always report as ready
  const dockerStatus: DockerStatus = { isRunning: true, version: "web-mode" };

  let apiKeys: Record<string, string> = {};

  try {
    apiKeys =
      (await getConvex().query(api.apiKeys.getAllForAgents, {
        teamSlugOrId: options.teamSlugOrId,
      })) ?? {};
  } catch (error) {
    console.warn(
      `Failed to load API keys for team ${options.teamSlugOrId}:`,
      error
    );
  }

  // Check each agent's required API keys (skip local file checks)
  const providerChecks = AGENT_CONFIGS.map((agent) => {
    const missingRequirements: string[] = [];

    // Check if required API keys are present
    if (agent.apiKeys && agent.apiKeys.length > 0) {
      // Special handling for Claude agents: CLAUDE_CODE_OAUTH_TOKEN OR ANTHROPIC_API_KEY
      // (OAuth token is preferred, but API key works too)
      const isClaudeAgent = agent.name.startsWith("claude/");
      // Special handling for Codex agents: CODEX_AUTH_JSON OR OPENAI_API_KEY
      // (auth.json with OAuth tokens is preferred, but API key works too)
      const isCodexAgent = agent.name.startsWith("codex/");

      if (isClaudeAgent) {
        // Claude agents require either OAuth token or API key (including placeholder for platform credits)
        const hasOAuthToken =
          apiKeys.CLAUDE_CODE_OAUTH_TOKEN &&
          apiKeys.CLAUDE_CODE_OAUTH_TOKEN.trim() !== "";
        const hasApiKey =
          apiKeys.ANTHROPIC_API_KEY && apiKeys.ANTHROPIC_API_KEY.trim() !== "";
        if (!hasOAuthToken && !hasApiKey) {
          missingRequirements.push("Claude OAuth Token or Anthropic API Key");
        }
      } else if (isCodexAgent) {
        const hasAuthJson =
          apiKeys.CODEX_AUTH_JSON && apiKeys.CODEX_AUTH_JSON.trim() !== "";
        const hasApiKey =
          apiKeys.OPENAI_API_KEY && apiKeys.OPENAI_API_KEY.trim() !== "";
        if (!hasAuthJson && !hasApiKey) {
          missingRequirements.push("Codex Auth JSON or OpenAI API Key");
        }
      } else {
        // For other agents, check all required keys
        for (const keyConfig of agent.apiKeys) {
          const keyValue = apiKeys[keyConfig.envVar];
          if (!keyValue || keyValue.trim() === "") {
            missingRequirements.push(keyConfig.displayName);
          }
        }
      }
    }

    return {
      name: agent.name,
      isAvailable: missingRequirements.length === 0,
      missingRequirements:
        missingRequirements.length > 0 ? missingRequirements : undefined,
    };
  });

  return {
    providers: providerChecks,
    dockerStatus,
  };
}
