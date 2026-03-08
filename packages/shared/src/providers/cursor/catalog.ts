import type { AgentCatalogEntry } from "../../agent-catalog";

export const CURSOR_CATALOG: AgentCatalogEntry[] = [
  {
    name: "cursor/opus-4.1",
    displayName: "Opus 4.1",
    vendor: "cursor",
    requiredApiKeys: ["CURSOR_API_KEY"],
    tier: "paid",
  },
  {
    name: "cursor/gpt-5",
    displayName: "GPT-5",
    vendor: "cursor",
    requiredApiKeys: ["CURSOR_API_KEY"],
    tier: "paid",
  },
  {
    name: "cursor/sonnet-4",
    displayName: "Sonnet 4",
    vendor: "cursor",
    requiredApiKeys: ["CURSOR_API_KEY"],
    tier: "paid",
  },
  {
    name: "cursor/sonnet-4-thinking",
    displayName: "Sonnet 4 Thinking",
    vendor: "cursor",
    requiredApiKeys: ["CURSOR_API_KEY"],
    tier: "paid",
    tags: ["reasoning"],
  },
];
