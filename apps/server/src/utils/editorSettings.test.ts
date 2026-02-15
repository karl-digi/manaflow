import { describe, expect, it } from "vitest";
import { getEditorSettingsUpload } from "./editorSettings";

describe("getEditorSettingsUpload (user-uploaded)", () => {
  it("includes extension installer auth files and startup command", async () => {
    const upload = await getEditorSettingsUpload({
      extensions: "ms-python.python\n\nfoo.bar\nms-python.python\n",
    });

    expect(upload).not.toBeNull();
    expect(upload?.startupCommands).toEqual([
      'bash "/root/.cmux/install-extensions-background.sh" || true',
    ]);

    const authFiles = upload?.authFiles ?? [];

    const extensionList = authFiles.find(
      (f) => f.destinationPath === "/root/.cmux/user-extensions.txt"
    );
    expect(extensionList).toBeDefined();
    expect(
      Buffer.from(extensionList?.contentBase64 ?? "", "base64").toString("utf8")
    ).toBe("foo.bar\nms-python.python\n");

    expect(
      authFiles.some(
        (f) => f.destinationPath === "/root/.cmux/install-extensions-background.sh"
      )
    ).toBe(true);
    expect(
      authFiles.some((f) => f.destinationPath === "/etc/profile.d/cmux-extensions.sh")
    ).toBe(true);
  });
});

