import type { AgentCatalogEntry } from "../../agent-catalog";

export const QWEN_CATALOG: AgentCatalogEntry[] = [
  {
    name: "qwen/qwen3-coder:free",
    displayName: "Qwen3 Coder (Free)",
    vendor: "qwen",
    requiredApiKeys: ["OPENROUTER_API_KEY"],
    tier: "free",
    tags: ["free"],
  },
  {
    name: "qwen/qwen3-coder-plus",
    displayName: "Qwen3 Coder Plus",
    vendor: "qwen",
    requiredApiKeys: ["MODEL_STUDIO_API_KEY"],
    tier: "paid",
  },
];
