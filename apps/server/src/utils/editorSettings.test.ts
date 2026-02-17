import { describe, expect, it } from "vitest";
import {
  deduplicateExtensions,
  formatExtensionSpec,
  getEditorSettingsUpload,
  parseExtensionSpec,
} from "./editorSettings";

describe("parseExtensionSpec", () => {
  it("parses extension ID without version", () => {
    const result = parseExtensionSpec("ms-python.python");
    expect(result).toEqual({ id: "ms-python.python" });
  });

  it("parses extension ID with version", () => {
    const result = parseExtensionSpec("anthropic.claude-code@2.1.44");
    expect(result).toEqual({ id: "anthropic.claude-code", version: "2.1.44" });
  });

  it("handles extension ID ending with @", () => {
    // Edge case: trailing @ should not be treated as version separator
    const result = parseExtensionSpec("some.extension@");
    expect(result).toEqual({ id: "some.extension@" });
  });

  it("handles extension ID starting with @", () => {
    // Edge case: leading @ should not be treated as version separator
    const result = parseExtensionSpec("@scoped/pkg");
    expect(result).toEqual({ id: "@scoped/pkg" });
  });

  it("handles version with multiple parts", () => {
    const result = parseExtensionSpec("foo.bar@1.2.3-beta.1");
    expect(result).toEqual({ id: "foo.bar", version: "1.2.3-beta.1" });
  });
});

describe("formatExtensionSpec", () => {
  it("formats extension without version", () => {
    const result = formatExtensionSpec({ id: "ms-python.python" });
    expect(result).toBe("ms-python.python");
  });

  it("formats extension with version", () => {
    const result = formatExtensionSpec({ id: "anthropic.claude-code", version: "2.1.44" });
    expect(result).toBe("anthropic.claude-code@2.1.44");
  });
});

describe("deduplicateExtensions", () => {
  it("removes simple duplicates", () => {
    const result = deduplicateExtensions([
      "ms-python.python",
      "foo.bar",
      "ms-python.python",
    ]);
    expect(result).toEqual(["foo.bar", "ms-python.python"]);
  });

  it("prefers versioned over unversioned for same ID", () => {
    const result = deduplicateExtensions([
      "anthropic.claude-code",
      "anthropic.claude-code@2.1.44",
      "foo.bar",
    ]);
    expect(result).toEqual(["anthropic.claude-code@2.1.44", "foo.bar"]);
  });

  it("keeps first versioned when multiple versions exist", () => {
    const result = deduplicateExtensions([
      "anthropic.claude-code@2.1.44",
      "anthropic.claude-code@2.0.13",
      "foo.bar",
    ]);
    expect(result).toEqual(["anthropic.claude-code@2.1.44", "foo.bar"]);
  });

  it("handles case-insensitive ID matching", () => {
    const result = deduplicateExtensions([
      "MS-Python.Python",
      "ms-python.python@1.0.0",
    ]);
    // Versioned should win, preserving original case
    expect(result).toEqual(["ms-python.python@1.0.0"]);
  });

  it("preserves unversioned when no versioned exists", () => {
    const result = deduplicateExtensions([
      "foo.bar",
      "foo.bar",
      "baz.qux",
    ]);
    expect(result).toEqual(["baz.qux", "foo.bar"]);
  });

  it("handles versioned appearing before unversioned", () => {
    const result = deduplicateExtensions([
      "anthropic.claude-code@2.1.44",
      "anthropic.claude-code",
    ]);
    expect(result).toEqual(["anthropic.claude-code@2.1.44"]);
  });

  it("returns sorted by ID", () => {
    const result = deduplicateExtensions([
      "zulu.ext",
      "alpha.ext",
      "mike.ext",
    ]);
    expect(result).toEqual(["alpha.ext", "mike.ext", "zulu.ext"]);
  });
});

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

  it("preserves versioned extensions in output", async () => {
    const upload = await getEditorSettingsUpload({
      extensions: "anthropic.claude-code@2.1.44\nfoo.bar\n",
    });

    const authFiles = upload?.authFiles ?? [];
    const extensionList = authFiles.find(
      (f) => f.destinationPath === "/root/.cmux/user-extensions.txt"
    );

    const content = Buffer.from(extensionList?.contentBase64 ?? "", "base64").toString("utf8");
    expect(content).toBe("anthropic.claude-code@2.1.44\nfoo.bar\n");
  });

  it("deduplicates with versioned taking precedence", async () => {
    const upload = await getEditorSettingsUpload({
      extensions: "anthropic.claude-code\nanthropic.claude-code@2.1.44\nfoo.bar\n",
    });

    const authFiles = upload?.authFiles ?? [];
    const extensionList = authFiles.find(
      (f) => f.destinationPath === "/root/.cmux/user-extensions.txt"
    );

    const content = Buffer.from(extensionList?.contentBase64 ?? "", "base64").toString("utf8");
    expect(content).toBe("anthropic.claude-code@2.1.44\nfoo.bar\n");
  });

  it("generates installer script with version-aware behavior", async () => {
    const upload = await getEditorSettingsUpload({
      extensions: "anthropic.claude-code@2.1.44\nfoo.bar\n",
    });

    const authFiles = upload?.authFiles ?? [];
    const installScript = authFiles.find(
      (f) => f.destinationPath === "/root/.cmux/install-extensions-background.sh"
    );

    const content = Buffer.from(installScript?.contentBase64 ?? "", "base64").toString("utf8");

    // Verify script contains version-aware installation logic
    expect(content).toContain("INSTALLED_CACHE");
    expect(content).toContain("is_installed");
    expect(content).toContain("get_installed_version");
    expect(content).toContain("has_version");
    expect(content).toContain("SKIP");
    expect(content).toContain("PIN");
    expect(content).toContain("INSTALL");

    // Verify it checks for existing installation before installing unversioned
    expect(content).toContain('if is_installed "$ext_id"');

    // Verify versioned entries use --force for pinning
    expect(content).toContain('--install-extension "$ext" --force');

    // Verify unversioned entries don't use --force
    expect(content).toContain('--install-extension "$ext_id" --extensions-dir');
    expect(content).not.toContain('--install-extension "$ext_id" --force');
  });
});
