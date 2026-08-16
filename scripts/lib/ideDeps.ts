import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const extensionSchema = z.object({
  publisher: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
});

const ideDepsSchema = z.object({
  extensions: z.array(extensionSchema),
  packages: z.record(z.string(), z.string().min(1)),
});

const packageOverridesSchema = z.record(z.string().min(1), z.string().min(1));

export type IdeDeps = z.infer<typeof ideDepsSchema>;
export type IdeExtension = z.infer<typeof extensionSchema>;
export type IdePackageOverrides = z.infer<typeof packageOverridesSchema>;

export async function readIdeDeps(repoRoot: string): Promise<IdeDeps> {
  const depsPath = join(repoRoot, "configs/ide-deps.json");
  const raw = await readFile(depsPath, "utf8");
  const parsed = ideDepsSchema.parse(JSON.parse(raw));
  return parsed;
}

export async function writeIdeDeps(
  repoRoot: string,
  deps: IdeDeps,
): Promise<void> {
  const depsPath = join(repoRoot, "configs/ide-deps.json");
  const serialized = JSON.stringify(deps, null, 2) + "\n";
  await writeFile(depsPath, serialized);
}

export function formatExtensions(extensions: IdeExtension[]): string[] {
  return extensions.map(
    (ext) => `${ext.publisher}|${ext.name}|${ext.version}`,
  );
}

export function isRemotePackageSource(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function formatPackageInstallSpec(
  packageName: string,
  value: string,
): string {
  return isRemotePackageSource(value) ? value : `${packageName}@${value}`;
}

// bun add -g fails extracting @anthropic-ai/claude-code@2.1.89 on linux/amd64
// ("Fail extracting tarball"). Keep this list in sync with
// scripts/snapshot/helpers.py:NPM_GLOBAL_INSTALL_PACKAGES.
export const NPM_GLOBAL_INSTALL_PACKAGES = new Set<string>([
  "@anthropic-ai/claude-code",
]);

export function selectGlobalPackageInstaller(
  packageName: string,
  value: string,
): "npm" | "bun" {
  if (
    isRemotePackageSource(value) ||
    NPM_GLOBAL_INSTALL_PACKAGES.has(packageName)
  ) {
    return "npm";
  }
  return "bun";
}

export function formatGlobalPackageInstallLines(deps: IdeDeps): string {
  const lines = Object.entries(deps.packages).map(([packageName, value]) => {
    const installer = selectGlobalPackageInstaller(packageName, value);
    return `${installer}|${packageName}|${formatPackageInstallSpec(packageName, value)}`;
  });
  return `${lines.join("\n")}\n`;
}

export function parsePackageOverrides(raw: string): IdePackageOverrides {
  const parsed = packageOverridesSchema.parse(JSON.parse(raw));
  const normalizedEntries = Object.entries(parsed).map(([packageName, value]) => {
    const normalizedPackageName = packageName.trim();
    const normalizedValue = value.trim();

    if (normalizedPackageName.length === 0) {
      throw new Error("Package override names must not be empty.");
    }

    if (normalizedValue.length === 0) {
      throw new Error(
        `Package override for ${normalizedPackageName} must not be empty.`,
      );
    }

    return [normalizedPackageName, normalizedValue] as const;
  });

  return Object.fromEntries(normalizedEntries);
}

export function applyPackageOverrides(
  deps: IdeDeps,
  overrides: IdePackageOverrides,
): boolean {
  let changed = false;

  for (const [packageName, value] of Object.entries(overrides)) {
    if (deps.packages[packageName] !== value) {
      deps.packages[packageName] = value;
      changed = true;
    }
  }

  return changed;
}

function replaceExtensionsBlock(
  text: string,
  extensions: IdeExtension[],
  fileLabel: string,
): string {
  const regex = /(done <<'EXTENSIONS'\n)([\s\S]*?)(\n\s*EXTENSIONS)/;
  const match = text.match(regex);
  if (!match) {
    throw new Error(`Expected EXTENSIONS heredoc in ${fileLabel}.`);
  }
  const existingBlock = match[2] ?? "";
  const existingLines = existingBlock
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const indentMatch = existingLines[0]?.match(/^(\s*)/);
  const entryIndent = indentMatch?.[1] ?? "";
  const newBlock = formatExtensions(extensions)
    .map((line) => `${entryIndent}${line}`)
    .join("\n");
  return text.replace(regex, `$1${newBlock}$3`);
}

export async function applyIdeDepsPins(
  repoRoot: string,
  deps: IdeDeps,
): Promise<{ dockerfileChanged: boolean; snapshotChanged: boolean }> {
  const dockerfilePath = join(repoRoot, "Dockerfile");
  const snapshotPath = join(repoRoot, "scripts/snapshot.py");

  const [dockerfileText, snapshotText] = await Promise.all([
    readFile(dockerfilePath, "utf8"),
    readFile(snapshotPath, "utf8"),
  ]);

  const hasDynamicDockerExtensions =
    dockerfileText.includes("/tmp/ide-deps.json") &&
    dockerfileText.includes("extensions=\"$(node");
  const hasDynamicSnapshotExtensions = snapshotText.includes("{extensions_blob}");

  let updatedDockerfile = dockerfileText;
  if (!hasDynamicDockerExtensions) {
    try {
      updatedDockerfile = replaceExtensionsBlock(
        dockerfileText,
        deps.extensions,
        "Dockerfile",
      );
    } catch {
      updatedDockerfile = dockerfileText;
    }
  }

  let updatedSnapshot = snapshotText;
  if (!hasDynamicSnapshotExtensions) {
    try {
      updatedSnapshot = replaceExtensionsBlock(
        snapshotText,
        deps.extensions,
        "scripts/snapshot.py",
      );
    } catch {
      updatedSnapshot = snapshotText;
    }
  }

  const dockerfileChanged = updatedDockerfile !== dockerfileText;
  const snapshotChanged = updatedSnapshot !== snapshotText;

  if (dockerfileChanged) {
    await writeFile(dockerfilePath, updatedDockerfile);
  }
  if (snapshotChanged) {
    await writeFile(snapshotPath, updatedSnapshot);
  }

  return { dockerfileChanged, snapshotChanged };
}
