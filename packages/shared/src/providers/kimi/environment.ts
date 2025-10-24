import type {
  EnvironmentContext,
  EnvironmentResult,
} from "../common/environment-result";

const DEFAULT_BASE_URL = "https://api.kimi.com/coding/v1";
const DEFAULT_MODEL_NAME = "kimi-k2-turbo-preview";
const DEFAULT_MAX_CONTEXT_SIZE = "100000";

export async function getKimiEnvironment(
  _ctx: EnvironmentContext
): Promise<EnvironmentResult> {
  const files: EnvironmentResult["files"] = [];
  const env: Record<string, string> = {};
  const startupCommands: string[] = [];

  startupCommands.push("mkdir -p ~/.kimi");
  startupCommands.push("mkdir -p ~/.kimi/logs");
  startupCommands.push("mkdir -p /root/lifecycle");
  startupCommands.push("rm -f /root/lifecycle/kimi-complete-* 2>/dev/null || true");

  if (!process.env.KIMI_BASE_URL) {
    env.KIMI_BASE_URL = DEFAULT_BASE_URL;
  }

  if (!process.env.KIMI_MODEL_NAME) {
    env.KIMI_MODEL_NAME = DEFAULT_MODEL_NAME;
  }

  if (!process.env.KIMI_MODEL_MAX_CONTEXT_SIZE) {
    env.KIMI_MODEL_MAX_CONTEXT_SIZE = DEFAULT_MAX_CONTEXT_SIZE;
  }

  return { files, env, startupCommands };
}
