import { describe, expect, it } from "vitest";
import { createProvisioningRegistry, type ProvisioningContext } from "./tasks";

type RecordedCommand = {
  label: string;
  command: string;
};

function createRecordingContext(commands: RecordedCommand[]): ProvisioningContext {
  return {
    vm: {
      vmId: "test-vm",
      exec: async () => "",
      snapshot: async () => ({ snapshotId: "snapshot-test" }),
      fs: {
        writeTextFile: async () => {},
        readTextFile: async () => "",
      },
    },
    outputs: new Map(),
    log: () => {},
    recordTiming: () => {},
    run: async (label: string, command: string) => {
      commands.push({ label, command });
      return "";
    },
  };
}

describe("snapshot provisioning tasks", () => {
  it("verify task checks VS Code and VNC binaries", async () => {
    const registry = createProvisioningRegistry();
    const verifyTask = registry.getTask("verify");
    expect(verifyTask).toBeDefined();

    const commands: RecordedCommand[] = [];
    const ctx = createRecordingContext(commands);

    await verifyTask?.func(ctx);

    const verifyScript = commands.find((cmd) => cmd.label === "verify")?.command ?? "";
    expect(verifyScript).toContain("vncserver -version");
    expect(verifyScript).toContain("code-server-oss --version");
    expect(verifyScript).toContain("Google Chrome");
  });

  it("start-desktop task boots VNC and cmux-code", async () => {
    const registry = createProvisioningRegistry();
    const startDesktopTask = registry.getTask("start-desktop");
    expect(startDesktopTask).toBeDefined();

    const commands: RecordedCommand[] = [];
    const ctx = createRecordingContext(commands);

    await startDesktopTask?.func(ctx);

    const startScript =
      commands.find((cmd) => cmd.label === "start-desktop")?.command ?? "";
    expect(startScript).toContain("vncserver :1");
    expect(startScript).toContain("code-server-oss");
    expect(startScript).toContain("cmux-start-chrome");
  });
});
