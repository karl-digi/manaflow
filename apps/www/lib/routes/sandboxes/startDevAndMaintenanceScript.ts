import {
  allocateScriptIdentifiers,
  generateOrchestratorSetupCommand,
  type ScriptIdentifiers,
} from "@cmux/convex/devAndMaintenanceOrchestrator";
import type { MorphInstance } from "./git";
import { singleQuote } from "./shell";

// Re-export types and utilities from the shared module
export { allocateScriptIdentifiers, type ScriptIdentifiers };

export async function runMaintenanceAndDevScripts({
  instance,
  maintenanceScript,
  devScript,
  identifiers,
  convexUrl,
  taskRunJwt,
  isCloudWorkspace,
}: {
  instance: MorphInstance;
  maintenanceScript?: string;
  devScript?: string;
  identifiers?: ScriptIdentifiers;
  convexUrl?: string;
  taskRunJwt?: string;
  isCloudWorkspace?: boolean;
}): Promise<void> {
  if (!convexUrl) {
    throw new Error("Convex URL not supplied but is required");
  }

  if (!taskRunJwt) {
    throw new Error("taskRunJwt not supplied but is required");
  }

  const setupAndRunCommand = generateOrchestratorSetupCommand({
    maintenanceScript,
    devScript,
    identifiers,
    convexUrl,
    taskRunJwt,
    isCloudWorkspace,
  });

  if (!setupAndRunCommand) {
    console.log("[runMaintenanceAndDevScripts] No maintenance or dev scripts provided; skipping start");
    return;
  }

  try {
    const result = await instance.exec(
      `zsh -lc ${singleQuote(setupAndRunCommand)}`,
    );

    const stdout = result.stdout?.trim() ?? "";
    const stderr = result.stderr?.trim() ?? "";

    if (result.exit_code !== 0) {
      const message =
        `Failed to start orchestrator: exit code ${result.exit_code}` +
        (stderr ? ` | stderr: ${stderr}` : "");
      throw new Error(message);
    }

    if (!stdout.includes("[ORCHESTRATOR] Started successfully in background (PID:")) {
      throw new Error("Orchestrator did not confirm successful start");
    }

    console.log(`[runMaintenanceAndDevScripts] Orchestrator started successfully`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[runMaintenanceAndDevScripts] Failed to start orchestrator: ${message}`);
    throw new Error(message);
  }
}
