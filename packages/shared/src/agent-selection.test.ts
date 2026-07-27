import { describe, expect, it } from "vitest";
import { resolveAgentSelection } from "./agent-selection";

describe("resolveAgentSelection", () => {
  it("resolves Codex base models to their default effort without changing the public agent name", () => {
    const resolved = resolveAgentSelection({
      agentName: "codex/gpt-5.5",
    });

    expect(resolved.assignedAgentName).toBe("codex/gpt-5.5");
    expect(resolved.selectedVariant).toBe("medium");
    expect(resolved.agentConfig.name).toBe("codex/gpt-5.5");
    expect(resolved.agentConfig.args).toContain("--model");
    expect(resolved.agentConfig.args).toContain("gpt-5.5");
    expect(resolved.agentConfig.args).toContain(
      'model_reasoning_effort="medium"',
    );
  });

  it("normalizes legacy Codex suffix agent names into base model plus variant", () => {
    const resolved = resolveAgentSelection({
      agentName: "codex/gpt-5.5-xhigh",
      applyDefaultVariant: false,
    });

    expect(resolved.assignedAgentName).toBe("codex/gpt-5.5");
    expect(resolved.selectedVariant).toBe("xhigh");
    expect(resolved.agentConfig.name).toBe("codex/gpt-5.5");
  });

  it("rejects unsupported Claude effort combinations", () => {
    expect(() =>
      resolveAgentSelection({
        agentName: "claude/opus-4.5",
        selectedVariant: "max",
      }),
    ).toThrow(/does not support effort variants/);
  });
});
