import type { ProviderRequirementsContext } from "../../agentConfig.js";

export async function checkGeminiRequirements(
  context?: ProviderRequirementsContext
): Promise<string[]> {
  const { access, readFile } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");

  const missing: string[] = [];
  const geminiDir = join(homedir(), ".gemini");

  try {
    // Check for settings.json (required)
    await access(join(geminiDir, "settings.json"));
  } catch {
    missing.push(".gemini/settings.json file");
  }

  // Check for authentication files
  const authFiles = [
    "oauth_creds.json",
    "google_accounts.json",
    "google_account_id",
  ];

  let hasAuth = false;
  const apiKeyFromSettings = context?.apiKeys?.GEMINI_API_KEY;
  if (typeof apiKeyFromSettings === "string" && apiKeyFromSettings.trim()) {
    hasAuth = true;
  }
  for (const file of authFiles) {
    try {
      await access(join(geminiDir, file));
      hasAuth = true;
    } catch {
      // Continue checking
    }
  }

  if (!hasAuth) {
    // Also check for GEMINI_API_KEY in .env files
    const envPaths = [join(geminiDir, ".env"), join(homedir(), ".env")];
    let hasApiKey = false;

    for (const envPath of envPaths) {
      try {
        const content = await readFile(envPath, "utf-8");
        if (content.includes("GEMINI_API_KEY=")) {
          hasApiKey = true;
          break;
        }
      } catch {
        // Continue checking
      }
    }

    if (!hasApiKey && !process.env.GEMINI_API_KEY) {
      missing.push("Gemini authentication (no OAuth or API key found)");
    }
  }

  return missing;
}
