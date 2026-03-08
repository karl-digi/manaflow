import type { AgentConfig } from "../../agentConfig";
import { XAI_API_KEY } from "../../apiKeys";
import { checkGrokRequirements } from "./check-requirements";
import { startGrokCompletionDetector } from "./completion-detector";
import { getGrokEnvironment } from "./environment";

interface GrokModelSpec {
  nameSuffix: string;
  modelApiName: string;
}

function createGrokConfig(spec: GrokModelSpec): AgentConfig {
  return {
    name: `grok/${spec.nameSuffix}`,
    command: "grok",
    args: [
      "--telemetry",
      "--telemetry-target=local",
      "--telemetry-otlp-endpoint=",
      "--telemetry-outfile=/tmp/grok-telemetry-$CMUX_TASK_RUN_ID.log",
      "--telemetry-log-prompts",
      "--prompt-interactive",
      "$PROMPT",
      "--yolo",
      "--model",
      spec.modelApiName,
    ],
    environment: getGrokEnvironment,
    apiKeys: [
      {
        ...XAI_API_KEY,
        mapToEnvVar: "OPENAI_API_KEY",
      },
    ],
    checkRequirements: checkGrokRequirements,
    completionDetector: startGrokCompletionDetector,
  };
}

const GROK_MODEL_SPECS: GrokModelSpec[] = [
  { nameSuffix: "grok-code-fast-1", modelApiName: "grok-code-fast-1" },
  { nameSuffix: "grok-4-latest", modelApiName: "grok-4-latest" },
  { nameSuffix: "grok-3-latest", modelApiName: "grok-3-latest" },
  { nameSuffix: "grok-3-fast", modelApiName: "grok-3-fast" },
];

export const GROK_AGENT_CONFIGS: AgentConfig[] =
  GROK_MODEL_SPECS.map(createGrokConfig);
