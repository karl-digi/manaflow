import type { ProviderRequirementsContext } from "../../agentConfig";

/**
 * Check if MiniMax requirements are met
 * @param context - The requirements context containing API keys and configuration
 * @returns Array of missing requirements (empty if all requirements are met)
 */
export async function checkMiniMaxRequirements(
  context?: ProviderRequirementsContext
): Promise<string[]> {
  const missingRequirements: string[] = [];

  // Check if MiniMax API key is provided
  if (!context?.apiKeys?.MINIMAX_API_KEY) {
    missingRequirements.push(
      "MiniMax API key is required. Please obtain an API key from the MiniMax Developer Platform and set it in the configuration."
    );
  }

  // Check if bunx is available (required for running Claude Code)
  try {
    const { execSync } = await import("node:child_process");
    execSync("which bunx", { stdio: "ignore" });
  } catch {
    missingRequirements.push(
      "bunx is required to run Claude Code. Please install Bun from https://bun.sh"
    );
  }

  // Check Node.js version (Claude Code requires Node.js 18+)
  try {
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);

    if (majorVersion < 18) {
      missingRequirements.push(
        `Node.js 18 or higher is required for Claude Code. Current version: ${nodeVersion}`
      );
    }
  } catch (error) {
    missingRequirements.push(
      "Unable to determine Node.js version. Please ensure Node.js 18+ is installed."
    );
  }

  // Validate API key format if provided
  if (context?.apiKeys?.MINIMAX_API_KEY) {
    const apiKey = context.apiKeys.MINIMAX_API_KEY;

    // Basic validation - MiniMax API keys typically have a specific format
    if (apiKey.length < 20) {
      missingRequirements.push(
        "MiniMax API key appears to be invalid (too short). Please verify your API key."
      );
    }

    // Check if the key looks like a placeholder
    if (apiKey.includes("YOUR_API_KEY") || apiKey.includes("PLACEHOLDER")) {
      missingRequirements.push(
        "MiniMax API key appears to be a placeholder. Please provide a valid API key."
      );
    }
  }

  return missingRequirements;
}