import type { ProviderRequirementsContext } from "../../agentConfig";

export async function checkMinimaxRequirements(
  context?: ProviderRequirementsContext,
): Promise<string[]> {
  const missing: string[] = [];

  // Check if MiniMax API key is provided
  if (!context?.apiKeys?.MINIMAX_API_KEY) {
    missing.push("MiniMax API key (MINIMAX_API_KEY)");
  }

  return missing;
}
