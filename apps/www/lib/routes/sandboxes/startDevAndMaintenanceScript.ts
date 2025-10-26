import type { MorphInstance } from "./git";
import { singleQuote } from "./shell";

const WORKSPACE_ROOT = "/root/workspace";
const CMUX_RUNTIME_DIR = "/var/tmp/cmux-scripts";
const MAINTENANCE_WINDOW_NAME = "maintenance";
const MAINTENANCE_SCRIPT_FILENAME = "maintenance.sh";
const DEV_WINDOW_NAME = "dev";
const DEV_SCRIPT_FILENAME = "dev.sh";

export type ScriptIdentifiers = {
  maintenance: {
    windowName: string;
    scriptPath: string;
  };
  dev: {
    windowName: string;
    scriptPath: string;
  };
};

export const allocateScriptIdentifiers = (): ScriptIdentifiers => {
  return {
    maintenance: {
      windowName: MAINTENANCE_WINDOW_NAME,
      scriptPath: `${CMUX_RUNTIME_DIR}/${MAINTENANCE_SCRIPT_FILENAME}`,
    },
    dev: {
      windowName: DEV_WINDOW_NAME,
      scriptPath: `${CMUX_RUNTIME_DIR}/${DEV_SCRIPT_FILENAME}`,
    },
  };
};

const ORCHESTRATOR_TEMPLATE = `#!/usr/bin/env bun
/**
 * Orchestrator script for running maintenance and dev scripts in sequence.
 * This script runs in the background to avoid Vercel timeouts.
 *
 * Flow:
 * 1. Create both tmux windows upfront
 * 2. Run maintenance script and wait for completion
 * 3. Run dev script (regardless of maintenance outcome)
 */

import { $ } from "bun";

const WORKSPACE_ROOT = "{{WORKSPACE_ROOT}}";
const CMUX_RUNTIME_DIR = "{{CMUX_RUNTIME_DIR}}";
const MAINTENANCE_SCRIPT_PATH = "{{MAINTENANCE_SCRIPT_PATH}}";
const DEV_SCRIPT_PATH = "{{DEV_SCRIPT_PATH}}";
const MAINTENANCE_WINDOW_NAME = "{{MAINTENANCE_WINDOW_NAME}}";
const DEV_WINDOW_NAME = "{{DEV_WINDOW_NAME}}";
const MAINTENANCE_EXIT_CODE_PATH = "{{MAINTENANCE_EXIT_CODE_PATH}}";
const MAINTENANCE_ERROR_LOG_PATH = "{{MAINTENANCE_ERROR_LOG_PATH}}";
const DEV_EXIT_CODE_PATH = "{{DEV_EXIT_CODE_PATH}}";
const DEV_ERROR_LOG_PATH = "{{DEV_ERROR_LOG_PATH}}";
const HAS_MAINTENANCE_SCRIPT = "{{HAS_MAINTENANCE_SCRIPT}}" === "true";
const HAS_DEV_SCRIPT = "{{HAS_DEV_SCRIPT}}" === "true";
const CONVEX_URL = "{{CONVEX_URL}}";
const TASK_RUN_JWT = "{{TASK_RUN_JWT}}";

function getConvexHttpBaseUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }
  const trimmed = url.replace(/\/$/, "");
  return trimmed.replace(".convex.cloud", ".convex.site");
}

async function ensureTmuxSession(): Promise<void> {
  // Check if session exists
  try {
    const result = await $\`tmux has-session -t cmux 2>/dev/null\`.quiet();
    if (result.exitCode === 0) {
      console.log("[ORCHESTRATOR] tmux session already exists");
      return;
    }
  } catch (error) {
    // Session doesn't exist, will create below
  }

  // Create the session
  console.log("[ORCHESTRATOR] Creating tmux session 'cmux'");
  try {
    await $\`tmux new-session -d -s cmux\`;
    console.log("[ORCHESTRATOR] tmux session created successfully");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(\`Failed to create tmux session: \${errorMessage}\`);
  }
}

async function createWindows(): Promise<void> {
  await ensureTmuxSession();

  if (HAS_MAINTENANCE_SCRIPT) {
    try {
      console.log(\`[ORCHESTRATOR] Creating \${MAINTENANCE_WINDOW_NAME} window...\`);
      await $\`tmux new-window -t cmux: -n \${MAINTENANCE_WINDOW_NAME} -d\`;
      console.log(\`[ORCHESTRATOR] \${MAINTENANCE_WINDOW_NAME} window created\`);
    } catch (error) {
      console.error(\`[ORCHESTRATOR] Failed to create \${MAINTENANCE_WINDOW_NAME} window:\`, error);
      throw error;
    }
  }

  if (HAS_DEV_SCRIPT) {
    try {
      console.log(\`[ORCHESTRATOR] Creating \${DEV_WINDOW_NAME} window...\`);
      await $\`tmux new-window -t cmux: -n \${DEV_WINDOW_NAME} -d\`;
      console.log(\`[ORCHESTRATOR] \${DEV_WINDOW_NAME} window created\`);
    } catch (error) {
      console.error(\`[ORCHESTRATOR] Failed to create \${DEV_WINDOW_NAME} window:\`, error);
      throw error;
    }
  }
}

async function runMaintenanceScript(): Promise<{ exitCode: number; error: string | null }> {
  if (!HAS_MAINTENANCE_SCRIPT) {
    console.log("[MAINTENANCE] No maintenance script to run");
    return { exitCode: 0, error: null };
  }

  try {
    console.log("[MAINTENANCE] Starting maintenance script...");

    // Run the script, capture exit code, then exec into new shell
    await $\`tmux send-keys -t cmux:\${MAINTENANCE_WINDOW_NAME} "zsh '\${MAINTENANCE_SCRIPT_PATH}' 2>&1 | tee '\${MAINTENANCE_ERROR_LOG_PATH}'; echo \\\${pipestatus[1]} > '\${MAINTENANCE_EXIT_CODE_PATH}'; exec zsh" C-m\`;

    await Bun.sleep(2000);

    console.log("[MAINTENANCE] Waiting for script to complete...");
    let attempts = 0;
    const maxAttempts = 600; // 10 minutes max
    while (attempts < maxAttempts) {
      const file = Bun.file(MAINTENANCE_EXIT_CODE_PATH);
      if (await file.exists()) {
        break;
      }
      await Bun.sleep(1000);
      attempts++;
    }

    if (attempts >= maxAttempts) {
      console.error("[MAINTENANCE] Script timed out after 10 minutes");
      return {
        exitCode: 124,
        error: "Maintenance script timed out after 10 minutes"
      };
    }

    const exitCodeFile = Bun.file(MAINTENANCE_EXIT_CODE_PATH);
    const exitCodeText = await exitCodeFile.text();
    const exitCode = parseInt(exitCodeText.trim()) || 0;

    console.log(\`[MAINTENANCE] Exit code file content: "\${exitCodeText}"\`);
    console.log(\`[MAINTENANCE] Parsed exit code: \${exitCode}\`);

    await $\`rm -f \${MAINTENANCE_EXIT_CODE_PATH}\`;

    console.log(\`[MAINTENANCE] Script completed with exit code \${exitCode}\`);

    if (exitCode !== 0) {
      console.log(\`[MAINTENANCE] Non-zero exit code detected, reading error log...\`);

      // Read the error log to get actual error details
      let errorDetails = "";
      try {
        const errorLogFile = Bun.file(MAINTENANCE_ERROR_LOG_PATH);
        const logExists = await errorLogFile.exists();
        console.log(\`[MAINTENANCE] Error log exists: \${logExists}\`);

        if (logExists) {
          const logContent = await errorLogFile.text();
          console.log(\`[MAINTENANCE] Error log size: \${logContent.length} chars\`);

          // Get the last 100 lines of output to capture the command and error context
          const lines = logContent.trim().split("\\n");
          console.log(\`[MAINTENANCE] Total lines in log: \${lines.length}\`);

          const relevantLines = lines.slice(-100);
          console.log(\`[MAINTENANCE] Taking last \${relevantLines.length} lines\`);

          errorDetails = relevantLines.join("\\n");
          console.log(\`[MAINTENANCE] Error details length: \${errorDetails.length} chars\`);
          console.log(\`[MAINTENANCE] First 500 chars of error: \${errorDetails.substring(0, 500)}\`);
        }
      } catch (logError) {
        console.error("[MAINTENANCE] Failed to read error log:", logError);
      }

      const errorMessage = errorDetails || \`Maintenance script failed with exit code \${exitCode}\`;
      console.log(\`[MAINTENANCE] Final error message length: \${errorMessage.length} chars\`);

      return {
        exitCode,
        error: errorMessage
      };
    }

    return { exitCode: 0, error: null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(\`[MAINTENANCE] Error: \${errorMessage}\`);
    return {
      exitCode: 1,
      error: \`Maintenance script execution failed: \${errorMessage}\`
    };
  }
}

async function reportErrorToConvex(
  maintenanceError: string | null,
  devError: string | null,
): Promise<void> {
  if (!TASK_RUN_JWT || !CONVEX_URL) {
    console.log("[ORCHESTRATOR] Skipping Convex error reporting: missing configuration");
    return;
  }

  const convexHttpBaseUrl = getConvexHttpBaseUrl(CONVEX_URL);
  if (!convexHttpBaseUrl) {
    console.log("[ORCHESTRATOR] Skipping Convex error reporting: invalid Convex URL");
    return;
  }

  if (!maintenanceError && !devError) {
    console.log("[ORCHESTRATOR] No errors to report");
    return;
  }

  try {
    console.log("[ORCHESTRATOR] Reporting errors to Convex...");

    const requestBody: { maintenanceError?: string; devError?: string } = {};
    if (maintenanceError) {
      requestBody.maintenanceError = maintenanceError;
    }
    if (devError) {
      requestBody.devError = devError;
    }

    console.log(\`[ORCHESTRATOR] Calling Convex HTTP action with body: \${JSON.stringify(requestBody, null, 2)}\`);

    const response = await fetch(\`\${convexHttpBaseUrl}/taskRuns/update-environment-error\`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": \`Bearer \${TASK_RUN_JWT}\`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log(\`[ORCHESTRATOR] Convex response status: \${response.status}\`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(\`[ORCHESTRATOR] Failed to report errors to Convex: \${response.status}\`);
      console.error(\`[ORCHESTRATOR] Response body: \${errorText}\`);
    } else {
      const responseData = await response.text();
      console.log(\`[ORCHESTRATOR] Successfully reported errors to Convex: \${responseData}\`);
    }
  } catch (error) {
    console.error(\`[ORCHESTRATOR] Exception while reporting errors to Convex:\`, error);
  }
}

async function startDevScript(): Promise<{ error: string | null }> {
  if (!HAS_DEV_SCRIPT) {
    console.log("[DEV] No dev script to run");
    return { error: null };
  }

  try {
    console.log("[DEV] Starting dev script...");

    // Run the script and capture exit code (don't exec zsh after since dev script may be long-running)
    await $\`tmux send-keys -t cmux:\${DEV_WINDOW_NAME} "zsh '\${DEV_SCRIPT_PATH}' 2>&1 | tee '\${DEV_ERROR_LOG_PATH}'; echo \\\${pipestatus[1]} > '\${DEV_EXIT_CODE_PATH}'" C-m\`;

    await Bun.sleep(2000);

    const windowCheck = await $\`tmux list-windows -t cmux\`.text();
    if (!windowCheck.includes(DEV_WINDOW_NAME)) {
      const error = "Dev window not found after starting script";
      console.error(\`[DEV] ERROR: \${error}\`);
      return { error };
    }

    console.log("[DEV] Checking for early exit...");

    // Wait for the script to potentially error out during startup
    await Bun.sleep(3000);

    // Check if an exit code was written (indicating the script finished)
    const exitCodeFile = Bun.file(DEV_EXIT_CODE_PATH);
    const exitCodeExists = await exitCodeFile.exists();
    console.log(\`[DEV] Exit code file exists: \${exitCodeExists}\`);

    if (exitCodeExists) {
      const exitCodeText = await exitCodeFile.text();
      const exitCode = parseInt(exitCodeText.trim()) || 0;

      console.log(\`[DEV] Exit code file content: "\${exitCodeText}"\`);
      console.log(\`[DEV] Parsed exit code: \${exitCode}\`);

      await $\`rm -f \${DEV_EXIT_CODE_PATH}\`;

      if (exitCode !== 0) {
        console.error(\`[DEV] Script exited early with code \${exitCode}\`);
        console.log(\`[DEV] Non-zero exit code detected, reading error log...\`);

        // Read the error log to get actual error details
        let errorDetails = "";
        try {
          const errorLogFile = Bun.file(DEV_ERROR_LOG_PATH);
          const logExists = await errorLogFile.exists();
          console.log(\`[DEV] Error log exists: \${logExists}\`);

          if (logExists) {
            const logContent = await errorLogFile.text();
            console.log(\`[DEV] Error log size: \${logContent.length} chars\`);

            // Get the last 100 lines of output to capture the command and error context
            const lines = logContent.trim().split("\\n");
            console.log(\`[DEV] Total lines in log: \${lines.length}\`);

            const relevantLines = lines.slice(-100);
            console.log(\`[DEV] Taking last \${relevantLines.length} lines\`);

            errorDetails = relevantLines.join("\\n");
            console.log(\`[DEV] Error details length: \${errorDetails.length} chars\`);
            console.log(\`[DEV] First 500 chars of error: \${errorDetails.substring(0, 500)}\`);
          }
        } catch (logError) {
          console.error("[DEV] Failed to read error log:", logError);
        }

        const errorMessage = errorDetails || \`Dev script failed with exit code \${exitCode}\`;
        console.log(\`[DEV] Final error message length: \${errorMessage.length} chars\`);

        return { error: errorMessage };
      } else {
        console.log(\`[DEV] Exit code is 0, no error to report\`);
      }
    } else {
      console.log(\`[DEV] No exit code file found, script is still running\`);
    }

    console.log("[DEV] Script started successfully");
    return { error: null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(\`[DEV] Error: \${errorMessage}\`);
    return {
      error: \`Dev script execution failed: \${errorMessage}\`
    };
  }
}

(async () => {
  try {
    console.log("[ORCHESTRATOR] Starting orchestrator...");
    console.log(\`[ORCHESTRATOR] CONVEX_URL: \${CONVEX_URL}\`);
    console.log(\`[ORCHESTRATOR] TASK_RUN_JWT present: \${!!TASK_RUN_JWT}\`);

    await createWindows();

    const maintenanceResult = await runMaintenanceScript();
    if (maintenanceResult.error) {
      console.error(\`[ORCHESTRATOR] Maintenance completed with error: \${maintenanceResult.error}\`);
    } else {
      console.log("[ORCHESTRATOR] Maintenance completed successfully");
    }

    const devResult = await startDevScript();
    if (devResult.error) {
      console.error(\`[ORCHESTRATOR] Dev script failed: \${devResult.error}\`);
    } else {
      console.log("[ORCHESTRATOR] Dev script started successfully");
    }

    // Report any errors to Convex
    console.log(\`[ORCHESTRATOR] Checking if should report errors - maintenance: \${!!maintenanceResult.error}, dev: \${!!devResult.error}\`);
    if (maintenanceResult.error || devResult.error) {
      await reportErrorToConvex(maintenanceResult.error, devResult.error);
    } else {
      console.log("[ORCHESTRATOR] No errors to report");
    }

    if (devResult.error) {
      process.exit(1);
    }

    console.log("[ORCHESTRATOR] Orchestrator completed successfully");
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(\`[ORCHESTRATOR] Fatal error: \${errorMessage}\`);

    // Report fatal errors to Convex (these are early setup failures, categorized as devError)
    await reportErrorToConvex(null, \`Orchestrator fatal error: \${errorMessage}\`);

    process.exit(1);
  }
})();
`;

// Helper to report errors to Convex from parent (outside orchestrator)
async function reportErrorToConvexHttp({
  convexUrl,
  taskRunJwt,
  maintenanceError,
  devError,
}: {
  convexUrl?: string;
  taskRunJwt?: string;
  maintenanceError?: string | null;
  devError?: string | null;
}): Promise<void> {
  if (!taskRunJwt || !convexUrl) {
    console.log("[runMaintenanceAndDevScripts] Skipping Convex error reporting: missing configuration");
    return;
  }

  const convexHttpBaseUrl = convexUrl
    .replace(/\/$/, "")
    .replace(".convex.cloud", ".convex.site");

  if (!maintenanceError && !devError) {
    return;
  }

  try {
    const requestBody: { maintenanceError?: string; devError?: string } = {};
    if (maintenanceError) {
      requestBody.maintenanceError = maintenanceError;
    }
    if (devError) {
      requestBody.devError = devError;
    }

    const response = await fetch(`${convexHttpBaseUrl}/taskRuns/update-environment-error`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${taskRunJwt}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[runMaintenanceAndDevScripts] Failed to report errors to Convex: ${response.status} ${errorText}`);
    } else {
      console.log(`[runMaintenanceAndDevScripts] Successfully reported errors to Convex`);
    }
  } catch (error) {
    console.error(`[runMaintenanceAndDevScripts] Exception while reporting errors to Convex:`, error);
  }
}

export async function runMaintenanceAndDevScripts({
  instance,
  maintenanceScript,
  devScript,
  identifiers,
  convexUrl,
  taskRunJwt,
}: {
  instance: MorphInstance;
  maintenanceScript?: string;
  devScript?: string;
  identifiers?: ScriptIdentifiers;
  convexUrl?: string;
  taskRunJwt?: string;
}): Promise<void> {
  const ids = identifiers ?? allocateScriptIdentifiers();

  const hasMaintenanceScript = Boolean(maintenanceScript?.trim().length);
  const hasDevScript = Boolean(devScript?.trim().length);
  if (!hasMaintenanceScript && !hasDevScript) {
    console.log("[runMaintenanceAndDevScripts] No maintenance or dev scripts provided; skipping");
    return;
  }

  // Generate unique run IDs for this execution
  const runId = `${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const orchestratorScriptPath = `${CMUX_RUNTIME_DIR}/orchestrator_${runId}.ts`;
  const maintenanceExitCodePath = `${CMUX_RUNTIME_DIR}/maintenance_${runId}.exit-code`;
  const maintenanceErrorLogPath = `${CMUX_RUNTIME_DIR}/maintenance_${runId}.log`;
  const devExitCodePath = `${CMUX_RUNTIME_DIR}/dev_${runId}.exit-code`;
  const devErrorLogPath = `${CMUX_RUNTIME_DIR}/dev_${runId}.log`;

  // Create maintenance script if provided
  const maintenanceScriptContent = hasMaintenanceScript
    ? `#!/bin/zsh
set -eux
cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \\$(date) ==="
${maintenanceScript}
echo "=== Maintenance Script Completed at \\$(date) ==="
`
    : null;

  // Create dev script if provided
  const devScriptContent = hasDevScript
    ? `#!/bin/zsh
set -ux
cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \\$(date) ==="
${devScript}
`
    : null;

  // Generate orchestrator script by replacing placeholders
  const orchestratorScript = ORCHESTRATOR_TEMPLATE
    .replace(/{{WORKSPACE_ROOT}}/g, WORKSPACE_ROOT)
    .replace(/{{CMUX_RUNTIME_DIR}}/g, CMUX_RUNTIME_DIR)
    .replace(/{{MAINTENANCE_SCRIPT_PATH}}/g, ids.maintenance.scriptPath)
    .replace(/{{DEV_SCRIPT_PATH}}/g, ids.dev.scriptPath)
    .replace(/{{MAINTENANCE_WINDOW_NAME}}/g, ids.maintenance.windowName)
    .replace(/{{DEV_WINDOW_NAME}}/g, ids.dev.windowName)
    .replace(/{{MAINTENANCE_EXIT_CODE_PATH}}/g, maintenanceExitCodePath)
    .replace(/{{MAINTENANCE_ERROR_LOG_PATH}}/g, maintenanceErrorLogPath)
    .replace(/{{DEV_EXIT_CODE_PATH}}/g, devExitCodePath)
    .replace(/{{DEV_ERROR_LOG_PATH}}/g, devErrorLogPath)
    .replace(/{{HAS_MAINTENANCE_SCRIPT}}/g, String(maintenanceScriptContent !== null))
    .replace(/{{HAS_DEV_SCRIPT}}/g, String(devScriptContent !== null))
    .replace(/{{CONVEX_URL}}/g, convexUrl || '')
    .replace(/{{TASK_RUN_JWT}}/g, taskRunJwt || '');

  // Create the command that sets up all scripts and starts the orchestrator in background
  const setupAndRunCommand = `set -eu
mkdir -p ${CMUX_RUNTIME_DIR}

# Write maintenance script if provided
${maintenanceScriptContent ? `cat > ${ids.maintenance.scriptPath} <<'MAINTENANCE_SCRIPT_EOF'
${maintenanceScriptContent}
MAINTENANCE_SCRIPT_EOF
chmod +x ${ids.maintenance.scriptPath}
rm -f ${maintenanceExitCodePath}` : ''}

# Write dev script if provided
${devScriptContent ? `cat > ${ids.dev.scriptPath} <<'DEV_SCRIPT_EOF'
${devScriptContent}
DEV_SCRIPT_EOF
chmod +x ${ids.dev.scriptPath}` : ''}

# Write orchestrator script
cat > ${orchestratorScriptPath} <<'ORCHESTRATOR_EOF'
${orchestratorScript}
ORCHESTRATOR_EOF
chmod +x ${orchestratorScriptPath}

# Start orchestrator as a background process (fire-and-forget)
# Redirect output to log file
nohup bun ${orchestratorScriptPath} > ${CMUX_RUNTIME_DIR}/orchestrator_${runId}.log 2>&1 &
ORCHESTRATOR_PID=$!

# Give it a moment to start
sleep 1

# Verify the process is still running
if kill -0 $ORCHESTRATOR_PID 2>/dev/null; then
  echo "[ORCHESTRATOR] Started successfully in background (PID: $ORCHESTRATOR_PID)"
else
  echo "[ORCHESTRATOR] ERROR: Process failed to start or exited immediately" >&2
  exit 1
fi
`;

  let result;
  try {
    result = await instance.exec(`zsh -lc ${singleQuote(setupAndRunCommand)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to start orchestrator: ${message}`);
  }

  const stdout = result.stdout?.trim() || "";
  const stderr = result.stderr?.trim() || "";

  if (result.exit_code !== 0) {
    const base = `Failed to start orchestrator: exit code ${result.exit_code}`;
    const detailed = stderr ? `${base} | stderr: ${stderr}` : base;

    // Try to read the orchestrator log file to get more details
    const orchestratorLogPath = `${CMUX_RUNTIME_DIR}/orchestrator_${runId}.log`;
    let logContent = "";
    try {
      const logResult = await instance.exec(`cat ${orchestratorLogPath} 2>/dev/null || echo "Log file not found"`);
      if (logResult.stdout) {
        logContent = logResult.stdout.trim();
        // Get last 100 lines
        const lines = logContent.split("\n");
        const relevantLines = lines.slice(-100);
        logContent = relevantLines.join("\n");
      }
    } catch (logError) {
      console.error(`[runMaintenanceAndDevScripts] Failed to read orchestrator log:`, logError);
    }

    const fullError = logContent
      ? `${detailed}\n\nOrchestrator log:\n${logContent}`
      : detailed;

    // Report to Convex and return (don't throw - orchestrator is fire-and-forget)
    console.error(`[runMaintenanceAndDevScripts] ${detailed}`);
    await reportErrorToConvexHttp({
      convexUrl,
      taskRunJwt,
      devError: fullError,
    });
    return;
  }

  if (!stdout.includes("[ORCHESTRATOR] Started successfully in background (PID:")) {
    const errorMsg = "Orchestrator did not confirm successful start";

    // Report to Convex and return (don't throw - orchestrator is fire-and-forget)
    console.error(`[runMaintenanceAndDevScripts] ${errorMsg}`);
    await reportErrorToConvexHttp({
      convexUrl,
      taskRunJwt,
      devError: errorMsg,
    });
    return;
  }

  console.log(`[runMaintenanceAndDevScripts] Orchestrator started successfully`);
}
