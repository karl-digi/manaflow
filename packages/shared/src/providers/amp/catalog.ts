import type { AgentCatalogEntry } from "../../agent-catalog";

export const AMP_CATALOG: AgentCatalogEntry[] = [
  {
    name: "amp",
    displayName: "AMP",
    vendor: "amp",
    requiredApiKeys: ["AMP_API_KEY"],
    tier: "paid",
  },
  {
    name: "amp/gpt-5",
    displayName: "AMP GPT-5",
    vendor: "amp",
    requiredApiKeys: ["AMP_API_KEY"],
    tier: "paid",
  },
];
