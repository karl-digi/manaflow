import { describe, expect, it } from "vitest";

import {
  buildCrownEvaluationPrompt,
  parseCrownEvaluationPrompt,
} from "./retryData";

describe("crown retryData", () => {
  it("roundtrips a prompt + candidates", () => {
    const prompt = "Fix the bug";
    const evaluationPrompt = buildCrownEvaluationPrompt(prompt, [
      {
        runId: "run_1",
        agentName: "agent-a",
        modelName: "model-a",
        gitDiff: "diff --git a/x b/x",
        newBranch: "branch-a",
        index: 0,
      },
      {
        runId: "run_2",
        agentName: "agent-b",
        gitDiff: "diff --git a/y b/y",
        newBranch: null,
        index: 1,
      },
    ]);

    const parsed = parseCrownEvaluationPrompt(evaluationPrompt);
    expect(parsed).not.toBeNull();
    expect(parsed?.prompt).toBe(prompt);
    expect(parsed?.candidates).toHaveLength(2);
    expect(parsed?.candidates[0]?.runId).toBe("run_1");
    expect(parsed?.candidates[1]?.runId).toBe("run_2");
  });

  it("returns null for invalid formats", () => {
    expect(parseCrownEvaluationPrompt("")).toBeNull();
    expect(parseCrownEvaluationPrompt("Task: x")).toBeNull();
    expect(parseCrownEvaluationPrompt("Task: x\nCandidates: nope")).toBeNull();
  });

  it("filters candidates missing required fields", () => {
    const evaluationPrompt = `Task: test\nCandidates: ${JSON.stringify([
      { runId: "ok", agentName: "a", gitDiff: "diff", index: 0 },
      { runId: "missingDiff", agentName: "b" },
      { agentName: "missingRunId", gitDiff: "diff" },
    ])}`;

    const parsed = parseCrownEvaluationPrompt(evaluationPrompt);
    expect(parsed?.candidates).toHaveLength(1);
    expect(parsed?.candidates[0]?.runId).toBe("ok");
  });
});

