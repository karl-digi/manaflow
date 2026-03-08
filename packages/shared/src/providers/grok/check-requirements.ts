export async function checkGrokRequirements(): Promise<string[]> {
  const xaiApiKey = process.env.XAI_API_KEY;
  if (!xaiApiKey) {
    return ["XAI_API_KEY is not set"];
  }
  return [];
}
