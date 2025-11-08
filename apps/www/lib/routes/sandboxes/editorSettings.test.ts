import type { EditorSettingsUpload } from "@cmux/shared/editor-settings";
import { describe, expect, it, vi } from "vitest";
import {
  applyEditorSettingsToInstance,
  type EditorSettingsInstance,
} from "./editorSettings";

const baseEditorSettings = (): EditorSettingsUpload => ({
  authFiles: [],
  startupCommands: [],
  sourceEditor: "vscode",
});

describe("applyEditorSettingsToInstance", () => {
  it("skips execution when no files or startup commands provided", async () => {
    const instance = {
      exec: vi.fn(),
    } as unknown as EditorSettingsInstance;

    await applyEditorSettingsToInstance({
      instance,
      editorSettings: baseEditorSettings(),
    });

    expect(instance.exec).not.toHaveBeenCalled();
  });

  it("writes auth files and runs startup commands", async () => {
    const exec = vi.fn().mockResolvedValue({
      exit_code: 0,
      stdout: "",
      stderr: "",
    });
    const editorSettings: EditorSettingsUpload = {
      authFiles: [
        {
          destinationPath: "/root/.config/test/settings.json",
          contentBase64: Buffer.from('{"test":true}', "utf8").toString("base64"),
          mode: "644",
        },
      ],
      startupCommands: ["echo hello"],
      sourceEditor: "vscode",
    };

    await applyEditorSettingsToInstance({
      instance: { exec } as unknown as EditorSettingsInstance,
      editorSettings,
    });

    expect(exec).toHaveBeenCalledTimes(1);
    const [command] = exec.mock.calls[0]!;
    expect(command).toContain("bash -lc");
    expect(command).toContain("CMUX_EDITOR_SETTINGS");
    expect(command).toContain("Startup command");
  });

  it("throws when the remote command fails", async () => {
    const exec = vi.fn().mockResolvedValue({
      exit_code: 1,
      stdout: "",
      stderr: "boom",
    });
    const editorSettings: EditorSettingsUpload = {
      authFiles: [
        {
          destinationPath: "/tmp/test.txt",
          contentBase64: Buffer.from("data", "utf8").toString("base64"),
        },
      ],
      startupCommands: [],
      sourceEditor: "vscode",
    };

    await expect(
      applyEditorSettingsToInstance({
        instance: { exec } as unknown as EditorSettingsInstance,
        editorSettings,
      }),
    ).rejects.toThrow(/Failed to apply editor settings/);
  });
});
