export type CrownStoredCandidate = {
  runId?: string;
  agentName?: string;
  modelName?: string;
  gitDiff: string;
  newBranch?: string | null;
  index?: number;
};

export type ParsedCrownEvaluationPrompt = {
  prompt: string;
  candidates: Array<
    CrownStoredCandidate & {
      runId: string;
      agentName: string;
      index: number;
    }
  >;
};

/**
 * Format: "Task: <prompt>\nCandidates: <JSON array>"
 *
 * Stored in `tasks.crownEvaluationRetryData.evaluationPrompt` so the retry
 * action can reconstruct candidates (including diffs) without relying on the worker.
 */
export function buildCrownEvaluationPrompt(
  prompt: string,
  candidates: CrownStoredCandidate[]
): string {
  return `Task: ${prompt}\nCandidates: ${JSON.stringify(candidates)}`;
}

export function parseCrownEvaluationPrompt(
  evaluationPrompt: string
): ParsedCrownEvaluationPrompt | null {
  try {
    const taskMatch = evaluationPrompt.match(/^Task:\s*(.+?)\nCandidates:\s*/s);
    if (!taskMatch) {
      return null;
    }

    const prompt = taskMatch[1].trim();
    const candidatesJson = evaluationPrompt.slice(taskMatch[0].length);

    const candidates = JSON.parse(candidatesJson);
    if (!Array.isArray(candidates)) {
      return null;
    }

    const normalized = candidates
      .map((candidate: unknown, idx: number) => {
        if (!candidate || typeof candidate !== "object") return null;
        const record = candidate as Record<string, unknown>;
        const runId = typeof record.runId === "string" ? record.runId : null;
        const agentName =
          typeof record.agentName === "string" ? record.agentName : null;
        const gitDiff = typeof record.gitDiff === "string" ? record.gitDiff : null;
        const index = typeof record.index === "number" ? record.index : idx;

        if (!runId || !agentName || gitDiff === null) return null;

        const modelName =
          typeof record.modelName === "string" ? record.modelName : undefined;
        const newBranch =
          typeof record.newBranch === "string" || record.newBranch === null
            ? (record.newBranch as string | null)
            : undefined;

        return {
          runId,
          agentName,
          gitDiff,
          index,
          modelName,
          newBranch,
        };
      })
      .filter(
        (candidate): candidate is NonNullable<typeof candidate> =>
          candidate !== null
      );

    if (normalized.length === 0) return null;
    return { prompt, candidates: normalized };
  } catch {
    return null;
  }
}

