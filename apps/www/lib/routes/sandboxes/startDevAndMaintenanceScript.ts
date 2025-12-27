import type { MorphInstance } from "./git";
import { singleQuote } from "./shell";

const WORKSPACE_ROOT = "/root/workspace";
const CMUX_RUNTIME_DIR = "/var/tmp/cmux-scripts";
const MAINTENANCE_WINDOW_NAME = "maintenance";
const MAINTENANCE_SCRIPT_FILENAME = "maintenance.sh";
const DEV_WINDOW_NAME = "dev";
const DEV_SCRIPT_FILENAME = "dev.sh";
const PTY_SERVER_URL = "http://localhost:39383";

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

/**
 * Report environment errors to Convex
 */
async function reportErrorToConvex(
  convexUrl: string,
  taskRunJwt: string,
  maintenanceError: string | null,
  devError: string | null,
): Promise<void> {
  if (!maintenanceError && !devError) {
    return;
  }

  try {
    console.log("[runMaintenanceAndDevScripts] Reporting errors to Convex...");
    const body: Record<string, string> = {};
    if (maintenanceError) {
      body.maintenanceError = maintenanceError;
    }
    if (devError) {
      body.devError = devError;
    }

    const response = await fetch(
      `${convexUrl}/http/api/task-runs/report-environment-error`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${taskRunJwt}`,
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[runMaintenanceAndDevScripts] Failed to report errors to Convex: ${response.status}`,
        errorText,
      );
    } else {
      console.log("[runMaintenanceAndDevScripts] Successfully reported errors to Convex");
    }
  } catch (error) {
    console.error("[runMaintenanceAndDevScripts] Exception while reporting errors to Convex:", error);
  }
}

/**
 * Run maintenance and dev scripts using terminal PTY.
 *
 * This function creates PTY sessions via the cmux-pty server running inside the sandbox
 * and sends commands to run the maintenance and dev scripts.
 */
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
  isCloudWorkspace?: boolean;
}): Promise<void> {
  const ids = identifiers ?? allocateScriptIdentifiers();

  const hasMaintenanceScript = Boolean(
    maintenanceScript && maintenanceScript.trim().length > 0,
  );
  const hasDevScript = Boolean(devScript && devScript.trim().length > 0);

  if (!hasMaintenanceScript && !hasDevScript) {
    console.log("[runMaintenanceAndDevScripts] No maintenance or dev scripts provided; skipping start");
    return;
  }

  // Generate unique run ID for this execution
  const runId = `${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const maintenanceErrorLogPath = `${CMUX_RUNTIME_DIR}/maintenance_${runId}.log`;
  const devErrorLogPath = `${CMUX_RUNTIME_DIR}/dev_${runId}.log`;

  // Create maintenance script content if provided
  const maintenanceScriptContent = hasMaintenanceScript
    ? `#!/bin/zsh
set -eu

# Source system profile for environment variables (RUSTUP_HOME, etc.)
[[ -f /etc/profile ]] && source /etc/profile

cd ${WORKSPACE_ROOT}

echo "=== Maintenance Script Started at \\$(date) ==="
${maintenanceScript}
echo "=== Maintenance Script Completed at \\$(date) ==="
`
    : null;

  // Create dev script content if provided
  const devScriptContent = hasDevScript
    ? `#!/bin/zsh
set -u

# Source system profile for environment variables (RUSTUP_HOME, etc.)
[[ -f /etc/profile ]] && source /etc/profile

cd ${WORKSPACE_ROOT}

echo "=== Dev Script Started at \\$(date) ==="
${devScript}
`
    : null;

  let maintenanceError: string | null = null;
  let devError: string | null = null;

  try {
    console.log("[runMaintenanceAndDevScripts] Setting up scripts via terminal PTY...");

    // Create the runtime directory and write script files
    const setupScriptsCommand = `set -eu
mkdir -p ${CMUX_RUNTIME_DIR}
${maintenanceScriptContent ? `cat > ${ids.maintenance.scriptPath} <<'MAINTENANCE_SCRIPT_EOF'
${maintenanceScriptContent}
MAINTENANCE_SCRIPT_EOF
chmod +x ${ids.maintenance.scriptPath}` : ''}
${devScriptContent ? `cat > ${ids.dev.scriptPath} <<'DEV_SCRIPT_EOF'
${devScriptContent}
DEV_SCRIPT_EOF
chmod +x ${ids.dev.scriptPath}` : ''}
echo "Scripts written successfully"
`;

    const setupResult = await instance.exec(`bash -c ${singleQuote(setupScriptsCommand)}`);
    if (setupResult.exit_code !== 0) {
      throw new Error(`Failed to write script files: ${setupResult.stderr || setupResult.stdout}`);
    }
    console.log("[runMaintenanceAndDevScripts] Script files written successfully");

    // Run maintenance script if provided
    if (hasMaintenanceScript) {
      console.log("[runMaintenanceAndDevScripts] Creating PTY session for maintenance script...");

      // Create PTY session for maintenance
      const createMaintenanceSessionCmd = `curl -sf -X POST ${PTY_SERVER_URL}/sessions \
        -H "Content-Type: application/json" \
        -d '{"shell":"/bin/zsh","cwd":"${WORKSPACE_ROOT}","name":"${ids.maintenance.windowName}","metadata":{"location":"panel","type":"maintenance","managed":true}}'`;

      const createMaintenanceResult = await instance.exec(createMaintenanceSessionCmd);
      if (createMaintenanceResult.exit_code !== 0) {
        throw new Error(`Failed to create maintenance PTY session: ${createMaintenanceResult.stderr || createMaintenanceResult.stdout}`);
      }

      // Parse the session ID from the response
      let maintenanceSessionId: string;
      try {
        const sessionInfo = JSON.parse(createMaintenanceResult.stdout || "{}");
        maintenanceSessionId = sessionInfo.id;
        if (!maintenanceSessionId) {
          throw new Error("No session ID in response");
        }
      } catch {
        throw new Error(`Failed to parse maintenance session response: ${createMaintenanceResult.stdout}`);
      }

      console.log(`[runMaintenanceAndDevScripts] Maintenance PTY session created: ${maintenanceSessionId}`);

      // Send command to run the maintenance script with error logging
      const maintenanceCommand = `${ids.maintenance.scriptPath} 2>&1 | tee ${maintenanceErrorLogPath}`;
      const escapedMaintenanceCommand = JSON.stringify({ data: maintenanceCommand + "\n" });

      const sendMaintenanceResult = await instance.exec(
        `curl -sf -X POST ${PTY_SERVER_URL}/sessions/${maintenanceSessionId}/input -H "Content-Type: application/json" -d ${singleQuote(escapedMaintenanceCommand)}`
      );

      if (sendMaintenanceResult.exit_code !== 0) {
        maintenanceError = `Failed to send maintenance script to PTY: ${sendMaintenanceResult.stderr || sendMaintenanceResult.stdout}`;
        console.error(`[runMaintenanceAndDevScripts] ${maintenanceError}`);
      } else {
        console.log("[runMaintenanceAndDevScripts] Maintenance script sent to PTY session");

        // Wait for maintenance script to complete by checking if the process is still running
        // Poll every 2 seconds for up to 10 minutes
        console.log("[runMaintenanceAndDevScripts] Waiting for maintenance script to complete...");
        const maxWaitMs = 10 * 60 * 1000; // 10 minutes
        const pollIntervalMs = 2000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitMs) {
          await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

          // Check if the session is still alive and has an active process
          const checkResult = await instance.exec(
            `curl -sf ${PTY_SERVER_URL}/sessions/${maintenanceSessionId}/capture 2>/dev/null | tail -c 500`
          );

          // Look for completion message in output
          if (checkResult.stdout?.includes("Maintenance Script Completed at")) {
            console.log("[runMaintenanceAndDevScripts] Maintenance script completed successfully");
            break;
          }

          // Also check for shell prompt to indicate script has finished
          // Check if the last line looks like a shell prompt (ends with $ or %)
          const lastLines = (checkResult.stdout || "").trim().split("\n").slice(-3).join("\n");
          if (lastLines.match(/[$%#]\s*$/)) {
            // Check the error log for completion or errors
            const logCheckResult = await instance.exec(`tail -5 ${maintenanceErrorLogPath} 2>/dev/null || true`);
            if (logCheckResult.stdout?.includes("Maintenance Script Completed at")) {
              console.log("[runMaintenanceAndDevScripts] Maintenance script completed successfully");
              break;
            }
          }
        }

        if (Date.now() - startTime >= maxWaitMs) {
          maintenanceError = "Maintenance script timed out after 10 minutes";
          console.error(`[runMaintenanceAndDevScripts] ${maintenanceError}`);
        }
      }
    }

    // Run dev script if provided
    if (hasDevScript) {
      console.log("[runMaintenanceAndDevScripts] Creating PTY session for dev script...");

      // Create PTY session for dev
      const createDevSessionCmd = `curl -sf -X POST ${PTY_SERVER_URL}/sessions \
        -H "Content-Type: application/json" \
        -d '{"shell":"/bin/zsh","cwd":"${WORKSPACE_ROOT}","name":"${ids.dev.windowName}","metadata":{"location":"panel","type":"dev","managed":true}}'`;

      const createDevResult = await instance.exec(createDevSessionCmd);
      if (createDevResult.exit_code !== 0) {
        devError = `Failed to create dev PTY session: ${createDevResult.stderr || createDevResult.stdout}`;
        console.error(`[runMaintenanceAndDevScripts] ${devError}`);
      } else {
        // Parse the session ID from the response
        let devSessionId: string;
        try {
          const sessionInfo = JSON.parse(createDevResult.stdout || "{}");
          devSessionId = sessionInfo.id;
          if (!devSessionId) {
            throw new Error("No session ID in response");
          }
        } catch {
          devError = `Failed to parse dev session response: ${createDevResult.stdout}`;
          console.error(`[runMaintenanceAndDevScripts] ${devError}`);
        }

        if (devSessionId!) {
          console.log(`[runMaintenanceAndDevScripts] Dev PTY session created: ${devSessionId}`);

          // Send command to run the dev script with error logging
          const devCommand = `${ids.dev.scriptPath} 2>&1 | tee ${devErrorLogPath}`;
          const escapedDevCommand = JSON.stringify({ data: devCommand + "\n" });

          const sendDevResult = await instance.exec(
            `curl -sf -X POST ${PTY_SERVER_URL}/sessions/${devSessionId}/input -H "Content-Type: application/json" -d ${singleQuote(escapedDevCommand)}`
          );

          if (sendDevResult.exit_code !== 0) {
            devError = `Failed to send dev script to PTY: ${sendDevResult.stderr || sendDevResult.stdout}`;
            console.error(`[runMaintenanceAndDevScripts] ${devError}`);
          } else {
            console.log("[runMaintenanceAndDevScripts] Dev script sent to PTY session");

            // Wait a few seconds and check for early exit
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Check if dev script crashed immediately
            const checkDevResult = await instance.exec(`tail -20 ${devErrorLogPath} 2>/dev/null || true`);
            const devOutput = checkDevResult.stdout || "";

            // Look for common error patterns that indicate immediate failure
            if (devOutput.includes("command not found") ||
                devOutput.includes("No such file") ||
                devOutput.includes("Permission denied") ||
                devOutput.includes("error:") ||
                devOutput.includes("Error:")) {
              // Check if this is a real error (script exited) vs just output
              const captureResult = await instance.exec(
                `curl -sf ${PTY_SERVER_URL}/sessions/${devSessionId}/capture 2>/dev/null | tail -c 200`
              );
              const lastLines = (captureResult.stdout || "").trim().split("\n").slice(-3).join("\n");
              if (lastLines.match(/[$%#]\s*$/)) {
                devError = `Dev script failed: ${devOutput.slice(0, 500)}`;
                console.error(`[runMaintenanceAndDevScripts] ${devError}`);
              }
            }

            if (!devError) {
              console.log("[runMaintenanceAndDevScripts] Dev script started successfully");
            }
          }
        }
      }
    }

    // Report any errors to Convex
    if ((maintenanceError || devError) && convexUrl && taskRunJwt) {
      await reportErrorToConvex(convexUrl, taskRunJwt, maintenanceError, devError);
    }

    if (maintenanceError || devError) {
      console.log("[runMaintenanceAndDevScripts] Completed with errors");
    } else {
      console.log("[runMaintenanceAndDevScripts] Completed successfully");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[runMaintenanceAndDevScripts] Failed: ${message}`);

    // Report error to Convex
    if (convexUrl && taskRunJwt) {
      await reportErrorToConvex(convexUrl, taskRunJwt, message, null);
    }

    throw new Error(message);
  }
}
