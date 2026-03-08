/**
 * Anthropic Provider Plugin.
 * Provides Claude Code agent configurations.
 */

import type { ProviderPlugin } from "../plugin-interface";
import {
  ANTHROPIC_API_KEY,
  ANTHROPIC_BASE_URL_KEY,
  CLAUDE_CODE_OAUTH_TOKEN,
} from "../../apiKeys";
import { CLAUDE_CATALOG } from "./catalog";
import { CLAUDE_AGENT_CONFIGS } from "./configs";

export const anthropicPlugin: ProviderPlugin = {
  manifest: {
    id: "anthropic",
    name: "Anthropic",
    version: "1.0.0",
    description: "Claude Code agents powered by Anthropic's Claude models",
    type: "builtin",
  },
  provider: {
    defaultBaseUrl: "https://api.anthropic.com",
    apiFormat: "anthropic",
    authEnvVars: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
    apiKeys: [CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY],
    baseUrlKey: ANTHROPIC_BASE_URL_KEY,
  },
  configs: CLAUDE_AGENT_CONFIGS,
  catalog: CLAUDE_CATALOG,
};

export default anthropicPlugin;
