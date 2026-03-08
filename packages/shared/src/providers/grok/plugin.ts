/**
 * Grok Provider Plugin.
 * Provides Grok Code agent configurations via xAI API.
 */

import type { ProviderPlugin } from "../plugin-interface";
import { XAI_API_KEY, XAI_BASE_URL_KEY } from "../../apiKeys";
import { GROK_CATALOG } from "./catalog";
import { GROK_AGENT_CONFIGS } from "./configs";

export const grokPlugin: ProviderPlugin = {
  manifest: {
    id: "grok",
    name: "Grok",
    version: "1.0.0",
    description: "Grok Code agents via xAI API",
    type: "builtin",
  },
  provider: {
    defaultBaseUrl: "https://api.x.ai/v1",
    apiFormat: "openai",
    authEnvVars: ["XAI_API_KEY"],
    apiKeys: [XAI_API_KEY],
    baseUrlKey: XAI_BASE_URL_KEY,
  },
  configs: GROK_AGENT_CONFIGS,
  catalog: GROK_CATALOG,
};

export default grokPlugin;
