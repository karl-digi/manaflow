import type { AuthFile } from "@cmux/shared/worker-schemas";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MorphInstance } from "./git";
import { singleQuote } from "./shell";

const OPENVSCODE_USER_DIR = "/root/.openvscode-server/data/User";
const OPENVSCODE_PROFILE_DIR = `${OPENVSCODE_USER_DIR}/profiles/default-profile`;
const OPENVSCODE_MACHINE_DIR = "/root/.openvscode-server/data/Machine";
const OPENVSCODE_SNIPPETS_DIR = `${OPENVSCODE_USER_DIR}/snippets`;
const CMUX_INTERNAL_DIR = "/root/.cmux";
const EXTENSION_LIST_PATH = `${CMUX_INTERNAL_DIR}/user-extensions.txt`;
const OPENVSCODE_EXT_DIR = "/root/.openvscode-server/extensions";

function buildExtensionInstallCommand(listPath: string): string {
  const scriptBody = [
    "set -euo pipefail",
    `EXT_LIST="${listPath}"`,
    `EXT_DIR="${OPENVSCODE_EXT_DIR}"`,
    `USER_DIR="${OPENVSCODE_USER_DIR}"`,
    "mkdir -p /root/.cmux",
    'LOG_FILE="/root/.cmux/install-extensions.log"',
    'touch "$LOG_FILE"',
    'if [ ! -s "$EXT_LIST" ]; then echo "No extensions to install (list empty)" >>"$LOG_FILE"; exit 0; fi',
    'CLI_PATH="${OPENVSCODE_CLI:-}"',
    'if [ -z "$CLI_PATH" ] && [ -x /app/openvscode-server/bin/openvscode-server ]; then',
    '  CLI_PATH="/app/openvscode-server/bin/openvscode-server"',
    "fi",
    'if [ -z "$CLI_PATH" ] && [ -x /app/openvscode-server/bin/remote-cli/openvscode-server ]; then',
    '  CLI_PATH="/app/openvscode-server/bin/remote-cli/openvscode-server"',
    "fi",
    'if [ -z "$CLI_PATH" ]; then CLI_PATH="$(command -v openvscode-server || true)"; fi',
    'if [ -z "$CLI_PATH" ]; then echo "openvscode CLI not found in PATH or standard locations" >>"$LOG_FILE"; exit 0; fi',
    'echo "Installing extensions with $CLI_PATH" >>"$LOG_FILE"',
    'chmod +x "$CLI_PATH" || true',
    'mkdir -p "$EXT_DIR" "$USER_DIR"',
    'ext=""',
    'installed_any=0',
    'pids=()',
    'had_failure=0',
    'while IFS= read -r ext; do',
    '  [ -z "$ext" ] && continue',
    '  installed_any=1',
    '  echo "-> Installing $ext" >>"$LOG_FILE"',
    '  (',
    '    if "$CLI_PATH" --install-extension "$ext" --force --extensions-dir "$EXT_DIR" --user-data-dir "$USER_DIR" >>"$LOG_FILE" 2>&1; then',
    '      echo "✓ Installed $ext" >>"$LOG_FILE"',
    "    else",
    '      echo "Failed to install $ext" >>"$LOG_FILE"',
    "      exit 1",
    "    fi",
    '  ) &',
    '  pids+=("$!")',
    "done < \"$EXT_LIST\"",
    'if [ "$installed_any" -eq 0 ]; then',
    '  echo "No valid extension identifiers found" >>"$LOG_FILE"',
    "fi",
    'for pid in "${pids[@]}"; do',
    '  if ! wait "$pid"; then',
    '    had_failure=1',
    "  fi",
    "done",
    'if [ "$had_failure" -ne 0 ]; then',
    '  echo "One or more extensions failed to install" >>"$LOG_FILE"',
    "fi",
  ].join("\n");

  return [
    "set -euo pipefail",
    'INSTALL_SCRIPT="$(mktemp /tmp/cmux-install-extensions-XXXXXX.sh)"',
    'trap \'rm -f "$INSTALL_SCRIPT"\' EXIT',
    'cat <<\'EOF\' >"$INSTALL_SCRIPT"',
    scriptBody,
    "EOF",
    'bash "$INSTALL_SCRIPT"',
  ].join("\n");
}

const getApplyEditorSettingsScript = (): string => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const scriptPath = join(__dirname, "applyEditorSettingsScript.ts");
  return readFileSync(scriptPath, "utf-8");
};

/**
 * Apply editor settings to a Morph cloud workspace instance.
 * This includes settings.json, keybindings.json, snippets, and extensions.
 */
export const applyEditorSettings = async ({
  instance,
  authFiles,
}: {
  instance: MorphInstance;
  authFiles: AuthFile[];
}): Promise<void> => {
  if (!authFiles || authFiles.length === 0) {
    console.log("[applyEditorSettings] No editor settings to apply");
    return;
  }

  console.log(
    `[applyEditorSettings] Applying ${authFiles.length} editor setting files`
  );

  const applyScript = getApplyEditorSettingsScript();
  const scriptPath = `/tmp/cmux-apply-editor-settings-${Date.now()}.ts`;

  // Serialize authFiles as JSON
  const authFilesJson = JSON.stringify(authFiles);

  // Build environment variables
  const envVars: Record<string, string> = {
    CMUX_AUTH_FILES: authFilesJson,
  };

  const envString = Object.entries(envVars)
    .map(([key, value]) => `export ${key}=${singleQuote(value)}`)
    .join("\n");

  const command = `
set -e
${envString}
cat > ${scriptPath} << 'CMUX_APPLY_EDITOR_EOF'
${applyScript}
CMUX_APPLY_EDITOR_EOF
bun run ${scriptPath}
EXIT_CODE=$?
rm -f ${scriptPath}
exit $EXIT_CODE
`;

  console.log("[applyEditorSettings] Executing editor settings script");
  const applyRes = await instance.exec(`bash -c ${singleQuote(command)}`);

  if (applyRes.stdout) {
    console.log(
      `[applyEditorSettings] stdout:\n${applyRes.stdout.slice(0, 1000)}`
    );
  }

  if (applyRes.stderr) {
    console.log(
      `[applyEditorSettings] stderr:\n${applyRes.stderr.slice(0, 1000)}`
    );
  }

  console.log(`[applyEditorSettings] exit code: ${applyRes.exit_code}`);

  if (applyRes.exit_code !== 0) {
    throw new Error(
      `Failed to apply editor settings with exit code ${applyRes.exit_code}`
    );
  }

  // Check if we have extensions to install
  const extensionListFile = authFiles.find(
    (f) => f.destinationPath === EXTENSION_LIST_PATH
  );

  if (extensionListFile) {
    console.log("[applyEditorSettings] Starting extension installation");

    // Trigger extension installation in background
    const installScriptPath = "/root/.cmux/install-extensions-background.sh";
    const backgroundInstallCommand = `
if [ -f "${installScriptPath}" ]; then
  nohup "${installScriptPath}" >/dev/null 2>&1 &
  echo "Extension installation started in background"
else
  echo "Extension install script not found"
fi
`;

    const installRes = await instance.exec(
      `bash -c ${singleQuote(backgroundInstallCommand)}`
    );

    if (installRes.stdout) {
      console.log(`[applyEditorSettings] install trigger: ${installRes.stdout}`);
    }
  }

  console.log("[applyEditorSettings] Editor settings applied successfully");
};
