/**
 * OpenAI Provider Plugin.
 * Provides Codex agent configurations.
 */

import type { ProviderPlugin } from "../plugin-interface";
import {
  CODEX_AUTH_JSON,
  OPENAI_API_KEY,
  OPENAI_BASE_URL_KEY,
} from "../../apiKeys";
import { CODEX_CATALOG } from "./catalog";
import { CODEX_AGENT_CONFIGS } from "./configs";

export const openaiPlugin: ProviderPlugin = {
  manifest: {
    id: "openai",
    name: "OpenAI",
    version: "1.0.0",
    description: "Codex agents powered by OpenAI's GPT models",
    type: "builtin",
  },
  provider: {
    defaultBaseUrl: "https://api.openai.com/v1",
    apiFormat: "openai",
    authEnvVars: ["OPENAI_API_KEY"],
    apiKeys: [OPENAI_API_KEY, CODEX_AUTH_JSON],
    baseUrlKey: OPENAI_BASE_URL_KEY,
  },
  configs: CODEX_AGENT_CONFIGS,
  catalog: CODEX_CATALOG,
};

export default openaiPlugin;
