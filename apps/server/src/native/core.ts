import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface NativeCoreModule {
  getTime?: () => Promise<string>;
}

function tryLoadNative(): NativeCoreModule | null {
  try {
    const nodeRequire = createRequire(import.meta.url);
    const here = path.dirname(fileURLToPath(import.meta.url));
    const plat = process.platform;
    const arch = process.arch;

    const dirCandidates = [
      process.env.CMUX_NATIVE_CORE_DIR,
      typeof (process as unknown as { resourcesPath?: string }).resourcesPath ===
        "string"
        ? path.join(
          (process as unknown as { resourcesPath: string }).resourcesPath,
          "native",
          "core"
        )
        : undefined,
      fileURLToPath(new URL("../../native/core/", import.meta.url)),
      path.resolve(here, "../../../server/native/core"),
      path.resolve(here, "../../../../apps/server/native/core"),
      path.resolve(process.cwd(), "../server/native/core"),
      path.resolve(process.cwd(), "../../apps/server/native/core"),
      path.resolve(process.cwd(), "apps/server/native/core"),
      path.resolve(process.cwd(), "server/native/core"),

    ];

    for (const maybeDir of dirCandidates) {
      const nativeDir = maybeDir ?? "";
      if (!nativeDir) continue;
      try {
        const files = fs.readdirSync(nativeDir);
        const nodes = files.filter((f) => f.endsWith(".node"));
        const preferred =
          nodes.find((f) => f.includes(plat) && f.includes(arch)) || nodes[0];

        if (!preferred) continue;
        const mod = nodeRequire(
          path.join(nativeDir, preferred)
        ) as unknown as NativeCoreModule;
        if (mod && typeof mod.getTime === "function") return mod;
      } catch {
        // try next
      }
    }
    return null;
  } catch {
    return null;
  }
}

let cached: NativeCoreModule | null = null;

function loadNative(): NativeCoreModule | null {
  if (!cached) cached = tryLoadNative();
  return cached;
}

export async function getRustTime(): Promise<string> {
  const mod = loadNative();
  if (mod?.getTime) return mod.getTime();
  throw new Error("@cmux/native-core not built or failed to load");
}
