type ProviderRequirementsContext = {
  apiKeys?: Record<string, string>;
  teamSlugOrId?: string;
};

type OpencodeRequirementOptions = {
  requireAuth?: boolean;
};

function isRequirementOptions(opt: unknown): opt is OpencodeRequirementOptions {
  return typeof opt === "object" && opt !== null && "requireAuth" in opt;
}

export async function checkOpencodeRequirements(
  options?: OpencodeRequirementOptions | ProviderRequirementsContext
): Promise<string[]> {
  const requireAuth = isRequirementOptions(options)
    ? (options.requireAuth ?? true)
    : true;

  if (!requireAuth) {
    return [];
  }

  const { access } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");

  const missing: string[] = [];

  try {
    // Check for auth.json
    await access(join(homedir(), ".local", "share", "opencode", "auth.json"));
  } catch {
    missing.push(".local/share/opencode/auth.json file");
  }

  return missing;
}

/**
 * Creates a requirements checker with pre-configured options.
 * Note: The context parameter is intentionally unused for free models
 * since they don't require authentication credentials from user settings.
 */
export function createOpencodeRequirementsChecker(
  options: OpencodeRequirementOptions
): (context?: ProviderRequirementsContext) => Promise<string[]> {
  return (_context) => checkOpencodeRequirements(options);
}
