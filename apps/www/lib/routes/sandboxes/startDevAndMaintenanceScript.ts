import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MorphInstance } from "./git";
import { singleQuote } from "./shell";

const CMUX_RUNTIME_DIR = "/var/tmp/cmux-scripts";

const getStartDevAndMaintenanceScript = (): string => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const scriptPath = join(__dirname, "../../../../..", "scripts", "start-dev-and-maintenance.ts");
  return readFileSync(scriptPath, "utf-8");
};
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

type ScriptResult = {
  maintenanceError: string | null;
  devError: string | null;
};

export async function runMaintenanceAndDevScripts({
  instance,
  maintenanceScript,
  devScript,
}: {
  instance: MorphInstance;
  maintenanceScript?: string;
  devScript?: string;
  identifiers?: ScriptIdentifiers;
}): Promise<ScriptResult> {
  if (
    (!maintenanceScript || maintenanceScript.trim().length === 0) &&
    (!devScript || devScript.trim().length === 0)
  ) {
    return {
      maintenanceError: "Both maintenance and dev scripts are empty",
      devError: null,
    };
  }

  // Get the script content and write it to a temp location
  const scriptContent = getStartDevAndMaintenanceScript();
  const scriptPath = `/tmp/cmux-start-dev-and-maintenance-${Date.now()}.ts`;

  // Build command to write script and execute it
  const writeScriptCommand = `cat > ${scriptPath} << 'CMUX_SCRIPT_EOF'\n${scriptContent}\nCMUX_SCRIPT_EOF`;

  let bunCommand = `bun ${scriptPath}`;

  if (maintenanceScript && maintenanceScript.trim().length > 0) {
    bunCommand += ` --maintenance ${singleQuote(maintenanceScript)}`;
  }

  if (devScript && devScript.trim().length > 0) {
    bunCommand += ` --dev ${singleQuote(devScript)}`;
  }

  const command = `${writeScriptCommand} && ${bunCommand} ; EXIT_CODE=$? ; rm -f ${scriptPath} ; exit $EXIT_CODE`;

  try {
    console.log(`[SCRIPT EXECUTION] Running unified script with maintenance='${maintenanceScript?.substring(0, 50)}...' dev='${devScript?.substring(0, 50)}...'`);
    const result = await instance.exec(command);

    console.log(`[SCRIPT EXECUTION] Exit code: ${result.exit_code}`);
    console.log(`[SCRIPT EXECUTION] Stdout length: ${result.stdout?.length || 0}`);
    console.log(`[SCRIPT EXECUTION] Stderr length: ${result.stderr?.length || 0}`);
    console.log(`[SCRIPT EXECUTION] Stdout: ${result.stdout}`);
    console.log(`[SCRIPT EXECUTION] Stderr: ${result.stderr}`);

    if (result.exit_code !== 0) {
      const stderr = result.stderr?.trim() || "";
      const stdout = result.stdout?.trim() || "";
      
      // Try to parse JSON result from stdout
      let scriptResult: ScriptResult | null = null;
      try {
        // Look for JSON object - search for last complete JSON object in output
        const lines = stdout.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (line.startsWith('{') && line.endsWith('}')) {
            try {
              scriptResult = JSON.parse(line);
              if (scriptResult && typeof scriptResult === 'object') {
                break;
              }
            } catch {
              // Not valid JSON, continue searching
            }
          }
        }
      } catch {
        // If JSON parsing fails, use the raw output
      }

      if (scriptResult) {
        return scriptResult;
      }

      // Fallback to error parsing
      const messageParts = [
        `Script execution failed with exit code ${result.exit_code}`,
        stderr ? `stderr: ${stderr}` : null,
        stdout ? `stdout: ${stdout}` : null,
      ].filter((part): part is string => part !== null);

      return {
        maintenanceError: messageParts.join(" | "),
        devError: messageParts.join(" | "),
      };
    } else {
      // Parse successful JSON result
      try {
        // Look for JSON object - search for last complete JSON object in output
        const lines = (result.stdout || '').split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (line.startsWith('{') && line.endsWith('}')) {
            try {
              const scriptResult = JSON.parse(line);
              if (scriptResult && typeof scriptResult === 'object') {
                console.log(`[SCRIPT EXECUTION] Maintenance: ${scriptResult.maintenanceError || 'success'}`);
                console.log(`[SCRIPT EXECUTION] Dev: ${scriptResult.devError || 'success'}`);
                return scriptResult;
              }
            } catch {
              // Not valid JSON, continue searching
            }
          }
        }
      } catch (error) {
        console.log(`[SCRIPT EXECUTION] Failed to parse JSON result: ${error}`);
      }

      console.log(`[SCRIPT EXECUTION VERIFICATION]\n${result.stdout || ""}`);
      return {
        maintenanceError: null,
        devError: null,
      };
    }
  } catch (error) {
    const errorMessage = `Script execution failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(`[SCRIPT EXECUTION ERROR] ${errorMessage}`);
    
    return {
      maintenanceError: errorMessage,
      devError: errorMessage,
    };
  }
}
