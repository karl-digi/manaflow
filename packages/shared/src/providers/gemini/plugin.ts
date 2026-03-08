/**
 * Google Gemini Provider Plugin.
 * Provides Gemini CLI agent configurations.
 */

import type { ProviderPlugin } from "../plugin-interface";
import { GEMINI_API_KEY, GEMINI_BASE_URL_KEY } from "../../apiKeys";
import { GEMINI_CATALOG } from "./catalog";
import { GEMINI_AGENT_CONFIGS } from "./configs";

export const geminiPlugin: ProviderPlugin = {
  manifest: {
    id: "gemini",
    name: "Google Gemini",
    version: "1.0.0",
    description: "Gemini CLI agents powered by Google's Gemini models",
    type: "builtin",
  },
  provider: {
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiFormat: "openai",
    authEnvVars: ["GEMINI_API_KEY"],
    apiKeys: [GEMINI_API_KEY],
    baseUrlKey: GEMINI_BASE_URL_KEY,
  },
  configs: GEMINI_AGENT_CONFIGS,
  catalog: GEMINI_CATALOG,
};

export default geminiPlugin;
