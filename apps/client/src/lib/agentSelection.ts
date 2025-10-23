import { AGENT_CONFIGS } from "@cmux/shared/agentConfig";
import { z } from "zod";

const DEFAULT_AGENT_NAMES = [
  "claude/sonnet-4.5",
  "claude/opus-4.1",
  "codex/gpt-5-codex-high",
];

const KNOWN_AGENT_NAMES = new Set(AGENT_CONFIGS.map((agent) => agent.name));

const AGENT_SELECTION_SCHEMA = z.array(z.string());

export const DEFAULT_AGENT_SELECTION = DEFAULT_AGENT_NAMES.filter((agent) =>
  KNOWN_AGENT_NAMES.has(agent),
);

export const isKnownAgentName = (agentName: string): boolean =>
  KNOWN_AGENT_NAMES.has(agentName);

export const filterKnownAgents = (agents: string[]): string[] =>
  agents.filter((agent) => KNOWN_AGENT_NAMES.has(agent));

export const parseStoredAgentSelection = (stored: string | null): string[] => {
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    const result = AGENT_SELECTION_SCHEMA.safeParse(parsed);
    if (!result.success) {
      console.warn("Invalid stored agent selection", result.error);
      return [];
    }
    return filterKnownAgents(result.data);
  } catch (error) {
    console.warn("Failed to parse stored agent selection", error);
    return [];
  }
};

export const persistAgentSelection = (agents: string[]): void => {
  try {
    const isDefaultSelection =
      DEFAULT_AGENT_SELECTION.length > 0 &&
      agents.length === DEFAULT_AGENT_SELECTION.length &&
      agents.every(
        (agent, index) => agent === DEFAULT_AGENT_SELECTION[index],
      );

    if (agents.length === 0 || isDefaultSelection) {
      localStorage.removeItem("selectedAgents");
    } else {
      localStorage.setItem("selectedAgents", JSON.stringify(agents));
    }
  } catch (error) {
    console.warn("Failed to persist agent selection", error);
  }
};
