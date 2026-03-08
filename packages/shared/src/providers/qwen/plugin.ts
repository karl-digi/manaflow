/**
 * Qwen Provider Plugin.
 * Provides Qwen Code agent configurations via ModelStudio and OpenRouter.
 */

import type { ProviderPlugin } from "../plugin-interface";
import { MODEL_STUDIO_API_KEY, MODEL_STUDIO_BASE_URL_KEY } from "../../apiKeys";
import { QWEN_CATALOG } from "./catalog";
import { QWEN_AGENT_CONFIGS } from "./configs";

export const qwenPlugin: ProviderPlugin = {
  manifest: {
    id: "qwen",
    name: "Qwen",
    version: "1.0.0",
    description: "Qwen Code agents via Alibaba ModelStudio and OpenRouter",
    type: "builtin",
  },
  provider: {
    // Primary provider is ModelStudio (Alibaba Cloud DashScope)
    defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    apiFormat: "openai",
    authEnvVars: ["MODEL_STUDIO_API_KEY"],
    apiKeys: [MODEL_STUDIO_API_KEY],
    baseUrlKey: MODEL_STUDIO_BASE_URL_KEY,
  },
  configs: QWEN_AGENT_CONFIGS,
  catalog: QWEN_CATALOG,
};

export default qwenPlugin;
