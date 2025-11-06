import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

export type AutoUpdatePreference = {
  includeDrafts: boolean;
};

const PREFERENCE_FILE = "auto-update-preference.json";

export const DEFAULT_AUTO_UPDATE_PREFERENCE: AutoUpdatePreference = Object.freeze(
  {
    includeDrafts: false,
  }
) as AutoUpdatePreference;

function preferenceFilePath(): string {
  return path.join(app.getPath("userData"), PREFERENCE_FILE);
}

export async function readAutoUpdatePreference(): Promise<AutoUpdatePreference> {
  try {
    const file = preferenceFilePath();
    const raw = await fs.readFile(file, { encoding: "utf8" });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed?.includeDrafts === "boolean") {
      return { includeDrafts: parsed.includeDrafts };
    }
  } catch {
    // ignore and fallback to default
  }
  return { ...DEFAULT_AUTO_UPDATE_PREFERENCE };
}

export async function writeAutoUpdatePreference(
  preference: AutoUpdatePreference
): Promise<void> {
  try {
    const file = preferenceFilePath();
    const dir = path.dirname(file);
    await fs.mkdir(dir, { recursive: true });
    const payload = JSON.stringify(
      { includeDrafts: Boolean(preference.includeDrafts) },
      null,
      2
    );
    await fs.writeFile(file, payload, { encoding: "utf8" });
  } catch {
    // ignore write failures; preference will fall back to default
  }
}
