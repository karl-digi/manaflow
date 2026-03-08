import type { AgentConfig } from "../../agentConfig";
import { CURSOR_API_KEY } from "../../apiKeys";
import { checkCursorRequirements } from "./check-requirements";
import { getCursorEnvironment } from "./environment";

// Factory types and implementation
interface CursorModelSpec {
  model: string;
}

function createCursorConfig(spec: CursorModelSpec): AgentConfig {
  return {
    name: `cursor/${spec.model}`,
    command: "/root/.local/bin/cursor-agent",
    args: ["--force", "--model", spec.model, "$PROMPT"],
    environment: getCursorEnvironment,
    checkRequirements: checkCursorRequirements,
    apiKeys: [CURSOR_API_KEY],
    waitForString: "Ready",
  };
}

const CURSOR_MODEL_SPECS: CursorModelSpec[] = [
  { model: "opus-4.1" },
  { model: "gpt-5" },
  { model: "sonnet-4" },
  { model: "sonnet-4-thinking" },
];

export const CURSOR_AGENT_CONFIGS: AgentConfig[] =
  CURSOR_MODEL_SPECS.map(createCursorConfig);
