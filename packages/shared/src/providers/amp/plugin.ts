/**
 * Sourcegraph AMP Provider Plugin.
 * Provides AMP agent configurations.
 */

import type { ProviderPlugin } from "../plugin-interface";
import { AMP_API_KEY } from "../../apiKeys";
import { AMP_CATALOG } from "./catalog";
import { AMP_AGENT_CONFIGS } from "./configs";

export const ampPlugin: ProviderPlugin = {
  manifest: {
    id: "amp",
    name: "Sourcegraph AMP",
    version: "1.0.0",
    description: "AMP agents from Sourcegraph",
    type: "builtin",
  },
  provider: {
    defaultBaseUrl: "https://sourcegraph.com",
    apiFormat: "passthrough",
    authEnvVars: ["AMP_API_KEY"],
    apiKeys: [AMP_API_KEY],
  },
  configs: AMP_AGENT_CONFIGS,
  catalog: AMP_CATALOG,
};

export default ampPlugin;
