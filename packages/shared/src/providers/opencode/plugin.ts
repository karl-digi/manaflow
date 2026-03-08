/**
 * OpenCode Provider Plugin.
 * Provides OpenCode agent configurations with free and paid models.
 */

import type { ProviderPlugin } from "../plugin-interface";
import { OPENROUTER_API_KEY, OPENROUTER_BASE_URL_KEY } from "../../apiKeys";
import { OPENCODE_CATALOG } from "./catalog";
import { OPENCODE_AGENT_CONFIGS } from "./configs";

export const opencodePlugin: ProviderPlugin = {
  manifest: {
    id: "opencode",
    name: "OpenCode",
    version: "1.0.0",
    description: "OpenCode agents supporting multiple model providers",
    type: "builtin",
  },
  provider: {
    // OpenCode defaults to OpenRouter for its multi-provider support
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    apiFormat: "openai",
    authEnvVars: ["OPENROUTER_API_KEY"],
    apiKeys: [OPENROUTER_API_KEY],
    baseUrlKey: OPENROUTER_BASE_URL_KEY,
  },
  configs: OPENCODE_AGENT_CONFIGS,
  catalog: OPENCODE_CATALOG,
};

export default opencodePlugin;
