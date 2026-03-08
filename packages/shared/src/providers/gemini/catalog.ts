import type { AgentCatalogEntry } from "../../agent-catalog";

export const GEMINI_CATALOG: AgentCatalogEntry[] = [
  {
    name: "gemini/3.1-pro-preview",
    displayName: "3.1 Pro Preview",
    vendor: "google",
    requiredApiKeys: ["GEMINI_API_KEY"],
    tier: "paid",
    tags: ["latest", "recommended"],
  },
  {
    name: "gemini/3-pro-preview",
    displayName: "3 Pro Preview",
    vendor: "google",
    requiredApiKeys: ["GEMINI_API_KEY"],
    tier: "paid",
    tags: ["recommended"],
  },
  {
    name: "gemini/2.5-flash",
    displayName: "2.5 Flash",
    vendor: "google",
    requiredApiKeys: ["GEMINI_API_KEY"],
    tier: "paid",
  },
  {
    name: "gemini/2.5-pro",
    displayName: "2.5 Pro",
    vendor: "google",
    requiredApiKeys: ["GEMINI_API_KEY"],
    tier: "paid",
  },
];
