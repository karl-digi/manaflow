import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

type EditorId = "vscode" | "cursor" | "windsurf";

const EDITOR_CLI_CONFIGS: Record<
  EditorId,
  { command: string; macAppName: string; macBinName: string }
> = {
  vscode: {
    command: "code",
    macAppName: "Visual Studio Code",
    macBinName: "code",
  },
  cursor: {
    command: "cursor",
    macAppName: "Cursor",
    macBinName: "cursor",
  },
  windsurf: {
    command: "windsurf",
    macAppName: "Windsurf",
    macBinName: "windsurf",
  },
};

export function macAppBin(appName: string, bin: string): string {
  if (process.platform !== "darwin") {
    return "";
  }
  return path.join(
    "/Applications",
    `${appName}.app`,
    "Contents",
    "Resources",
    "app",
    "bin",
    bin
  );
}

async function pathExists(target: string): Promise<boolean> {
  if (!target) {
    return false;
  }
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execAsync(`command -v ${command}`);
    return true;
  } catch {
    return false;
  }
}

export async function findEditorExecutable(
  editorId: EditorId
): Promise<string | null> {
  const config = EDITOR_CLI_CONFIGS[editorId];

  if (await commandExists(config.command)) {
    return config.command;
  }

  if (process.platform === "darwin") {
    const appBinPath = macAppBin(config.macAppName, config.macBinName);
    if (await pathExists(appBinPath)) {
      return appBinPath;
    }
  }

  return null;
}

export async function editorExists(editorId: EditorId): Promise<boolean> {
  return (await findEditorExecutable(editorId)) !== null;
}
