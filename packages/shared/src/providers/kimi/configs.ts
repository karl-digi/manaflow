import type { AgentConfig } from "../../agentConfig";
import { KIMI_API_KEY } from "../../apiKeys";
import { checkKimiRequirements } from "./check-requirements";
import { startKimiCompletionDetector } from "./completion-detector";
import { getKimiEnvironment } from "./environment";

export const KIMI_K2_TURBO_PREVIEW_CONFIG: AgentConfig = {
  name: "kimi/kimi-k2-turbo-preview",
  command: "bash",
  args: [
    "-lc",
    'uvx kimi-cli@latest --command "$PROMPT" --yolo; status=$?; marker="/root/lifecycle/kimi-complete-${CMUX_TASK_RUN_ID:-unknown}"; touch "$marker" || true; touch /root/lifecycle/done.txt || true; exit $status',
  ],
  environment: getKimiEnvironment,
  apiKeys: [KIMI_API_KEY],
  checkRequirements: checkKimiRequirements,
  completionDetector: startKimiCompletionDetector,
};
