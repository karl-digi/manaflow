export async function checkKimiRequirements(): Promise<string[]> {
  const missing: string[] = [];

  if (!process.env.KIMI_API_KEY) {
    missing.push("KIMI_API_KEY is not set");
  }

  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    await execFileAsync("uvx", ["--version"]);
  } catch {
    missing.push("uvx (from uv) is not installed or not on PATH");
  }

  return missing;
}
