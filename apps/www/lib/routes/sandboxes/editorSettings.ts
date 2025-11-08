import {
  EXTENSION_INSTALL_SCRIPT_PATH,
  HOME_DIR,
} from "@cmux/shared/editor-settings/constants";
import type { AuthFile } from "@cmux/shared/worker-schemas";
import type { MorphInstance } from "./git";
import { singleQuote } from "./shell";

const INSTALL_TRIGGER_LOG = `${HOME_DIR}/.cmux/install-extensions-trigger.log`;

const expandHome = (input: string) =>
  input.replace("$HOME", HOME_DIR);

const writeAuthFile = async (
  instance: MorphInstance,
  file: AuthFile,
  destinationPath: string
) => {
  const writeScript = `
set -euo pipefail
DEST=${singleQuote(destinationPath)}
mkdir -p "$(dirname "$DEST")"
cat <<'CMUX_AUTH_FILE' | base64 -d > "$DEST"
${file.contentBase64}
CMUX_AUTH_FILE
${file.mode ? `chmod ${singleQuote(file.mode)} "$DEST"` : ""}
`;

  const result = await instance.exec(`bash -lc ${singleQuote(writeScript)}`);
  if (result.exit_code !== 0) {
    const stderr = (result.stderr || "").slice(0, 200);
    throw new Error(
      `exit=${result.exit_code} stderr=${stderr}`
    );
  }
};

const triggerExtensionInstall = async (instance: MorphInstance) => {
  const command = `
set -euo pipefail
if [ -x ${singleQuote(EXTENSION_INSTALL_SCRIPT_PATH)} ]; then
  nohup ${singleQuote(EXTENSION_INSTALL_SCRIPT_PATH)} >${singleQuote(
    INSTALL_TRIGGER_LOG
  )} 2>&1 &
fi
`;

  const result = await instance.exec(`bash -lc ${singleQuote(command)}`);
  if (result.exit_code !== 0) {
    const stderr = (result.stderr || "").slice(0, 200);
    throw new Error(
      `exit=${result.exit_code} stderr=${stderr}`
    );
  }
};

export const applyEditorSettingsFiles = async ({
  instance,
  files,
}: {
  instance: MorphInstance;
  files: AuthFile[];
}) => {
  if (!files || files.length === 0) {
    return;
  }

  const writtenPaths = new Set<string>();

  for (const file of files) {
    const destination = expandHome(file.destinationPath);
    try {
      await writeAuthFile(instance, file, destination);
      writtenPaths.add(destination);
    } catch (error) {
      console.error(
        `[sandboxes.start] Failed to write auth file ${destination}:`,
        error
      );
    }
  }

  if (writtenPaths.has(EXTENSION_INSTALL_SCRIPT_PATH)) {
    try {
      await triggerExtensionInstall(instance);
    } catch (error) {
      console.error(
        "[sandboxes.start] Failed to trigger extension installation:",
        error
      );
    }
  }
};
