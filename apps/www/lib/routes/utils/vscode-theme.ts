import type { MorphCloudClient } from "morphcloud";

type MorphInstance = Awaited<
  ReturnType<MorphCloudClient["instances"]["start"]>
>;

export async function applyVSCodeTheme(
  instance: MorphInstance,
  theme: "dark" | "light" | "system",
): Promise<void> {
  const stopResult = await instance.exec(
    "sudo systemctl stop cmux-openvscode || true",
  );
  if (stopResult.exit_code !== 0) {
    console.error(
      "[vscode-theme] Failed to stop cmux-openvscode",
      stopResult.stderr,
    );
  }

  const configureCmd =
    `sudo -u cmux env VSCODE_THEME=${theme} /opt/cmux/bin/configure-openvscode`;
  const configureResult = await instance.exec(configureCmd);
  if (configureResult.exit_code !== 0) {
    throw new Error(
      `[vscode-theme] configure-openvscode failed: ${configureResult.stderr}`,
    );
  }

  const startResult = await instance.exec(
    "sudo systemctl start cmux-openvscode",
  );
  if (startResult.exit_code !== 0) {
    throw new Error(
      `[vscode-theme] Failed to start cmux-openvscode: ${startResult.stderr}`,
    );
  }
}
