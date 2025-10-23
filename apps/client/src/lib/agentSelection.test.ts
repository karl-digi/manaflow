import { describe, expect, it } from "vitest";
import { AGENT_CONFIGS } from "@cmux/shared/agentConfig";
import {
  DEFAULT_AGENT_SELECTION,
  filterKnownAgents,
  parseStoredAgentSelection,
} from "./agentSelection";

describe("agentSelection", () => {
  it("only includes known agents in the default selection", () => {
    const knownNames = new Set(AGENT_CONFIGS.map((agent) => agent.name));
    const unknownDefault = DEFAULT_AGENT_SELECTION.filter(
      (agent) => !knownNames.has(agent),
    );
    expect(unknownDefault).toHaveLength(0);
  });

  it("filters unknown agent names", () => {
    const result = filterKnownAgents([
      "claude/sonnet-4.5",
      "not/a-real-agent",
    ]);
    expect(result).toEqual(["claude/sonnet-4.5"]);
  });

  it("ignores malformed persisted selections", () => {
    const invalidJsonResult = parseStoredAgentSelection("not json");
    expect(invalidJsonResult).toEqual([]);

    const invalidShapeResult = parseStoredAgentSelection("{\"foo\":true}");
    expect(invalidShapeResult).toEqual([]);
  });

  it("drops unknown agents when parsing persisted selections", () => {
    const payload = JSON.stringify([
      "claude/opus-4.1",
      "unknown/agent",
    ]);
    const parsed = parseStoredAgentSelection(payload);
    expect(parsed).toEqual(["claude/opus-4.1"]);
  });
});
