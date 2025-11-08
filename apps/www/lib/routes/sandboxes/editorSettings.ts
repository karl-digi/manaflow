import type { EditorSettingsUpload } from "@cmux/shared/editor-settings";
import type { MorphInstance } from "./git";
import { singleQuote } from "./shell";

type InstanceExecutor = Pick<MorphInstance, "exec">;
export type EditorSettingsInstance = InstanceExecutor;

const encodeFilesPayload = (files: EditorSettingsUpload["authFiles"]): string => {
  const normalized = files.map((file) => ({
    destinationPath: file.destinationPath,
    contentBase64: file.contentBase64,
    mode: file.mode,
  }));
  return Buffer.from(JSON.stringify(normalized), "utf8").toString("base64");
};

export async function applyEditorSettingsToInstance({
  instance,
  editorSettings,
}: {
  instance: InstanceExecutor;
  editorSettings: EditorSettingsUpload;
}): Promise<void> {
  const authFiles = editorSettings.authFiles ?? [];
  const startupCommands =
    editorSettings.startupCommands?.filter((cmd) => cmd && cmd.trim().length > 0) ??
    [];

  if (authFiles.length === 0 && startupCommands.length === 0) {
    return;
  }

  const scriptLines: string[] = ["set -euo pipefail"];

  if (authFiles.length > 0) {
    const filesPayload = encodeFilesPayload(authFiles);
    scriptLines.push(
      `python3 - <<'CMUX_EDITOR_SETTINGS'
import base64
import json
import os
import pathlib

payload = "${filesPayload}"
files = json.loads(base64.b64decode(payload).decode("utf-8")) if payload else []
home = os.path.expanduser("~") or "/root"
written = 0

for file in files:
    dest = (file.get("destinationPath") or "").replace("$HOME", home)
    if not dest:
        continue
    path = pathlib.Path(dest)
    path.parent.mkdir(parents=True, exist_ok=True)
    data_b64 = file.get("contentBase64") or ""
    data = base64.b64decode(data_b64) if data_b64 else b""
    path.write_bytes(data)
    mode = file.get("mode")
    if mode:
        try:
            path.chmod(int(mode, 8))
        except Exception:
            pass
    written += 1

print(f"[sandboxes.editor-settings] Wrote {written} editor file(s)")
CMUX_EDITOR_SETTINGS`,
    );
  }

  if (startupCommands.length > 0) {
    startupCommands.forEach((command, index) => {
      const prefix = `[sandboxes.editor-settings] Startup command ${index + 1}/${startupCommands.length}`;
      scriptLines.push(`echo ${singleQuote(`${prefix}: ${command}`)}`);
      scriptLines.push(`if ! bash -lc ${singleQuote(command)}; then`);
      scriptLines.push(
        `  echo ${singleQuote(`[sandboxes.editor-settings] Startup command failed: ${command}`)} >&2`,
      );
      scriptLines.push("  exit 1");
      scriptLines.push("fi");
    });
  }

  const script = scriptLines.join("\n");
  const result = await instance.exec(`bash -lc ${singleQuote(script)}`);

  if (result.exit_code !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    const stdout = result.stdout?.trim() ?? "";
    throw new Error(
      `[sandboxes.editor-settings] Failed to apply editor settings (exit ${result.exit_code}): ${stderr || stdout
      }`,
    );
  }
}
