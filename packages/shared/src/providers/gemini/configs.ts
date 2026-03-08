import type { AgentConfig } from "../../agentConfig";
import { GEMINI_API_KEY } from "../../apiKeys";
import { checkGeminiRequirements } from "./check-requirements";
import { startGeminiCompletionDetector } from "./completion-detector";
import { GEMINI_TELEMETRY_OUTFILE_TEMPLATE } from "./telemetry";
import { getGeminiEnvironment } from "./environment";

// Factory types and implementation
interface GeminiModelSpec {
  nameSuffix: string;
  modelApiName: string;
}

function createGeminiConfig(spec: GeminiModelSpec): AgentConfig {
  return {
    name: `gemini/${spec.nameSuffix}`,
    command: "gemini",
    args: [
      "--model",
      spec.modelApiName,
      "--yolo",
      "--telemetry",
      "--telemetry-target=local",
      "--telemetry-otlp-endpoint=",
      `--telemetry-outfile=${GEMINI_TELEMETRY_OUTFILE_TEMPLATE}`,
      "--telemetry-log-prompts",
      "--prompt-interactive",
      "$PROMPT",
    ],
    environment: getGeminiEnvironment,
    apiKeys: [GEMINI_API_KEY],
    checkRequirements: checkGeminiRequirements,
    completionDetector: startGeminiCompletionDetector,
  };
}

const GEMINI_MODEL_SPECS: GeminiModelSpec[] = [
  { nameSuffix: "3.1-pro-preview", modelApiName: "gemini-3.1-pro-preview" },
  { nameSuffix: "3-pro-preview", modelApiName: "gemini-3-pro-preview" },
  { nameSuffix: "2.5-flash", modelApiName: "gemini-2.5-flash" },
  { nameSuffix: "2.5-pro", modelApiName: "gemini-2.5-pro" },
];

export const GEMINI_AGENT_CONFIGS: AgentConfig[] =
  GEMINI_MODEL_SPECS.map(createGeminiConfig);
