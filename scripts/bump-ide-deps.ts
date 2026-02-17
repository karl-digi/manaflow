#!/usr/bin/env bun

import { z } from "zod";
import {
  applyIdeDepsPins,
  readIdeDeps,
  writeIdeDeps,
  type IdeDeps,
} from "./lib/ideDeps";

const channelSchema = z.enum(["stable", "latest", "beta"]);
type Channel = z.infer<typeof channelSchema>;

const npmTagResponseSchema = z.object({
  version: z.string().min(1),
});

function parseArgs(argv: string[]): { channel: Channel } {
  let channelOverride: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--channel" && index + 1 < argv.length) {
      channelOverride = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--channel=")) {
      const [, value] = arg.split("=", 2);
      channelOverride = value;
    }
  }

  return {
    channel: channelSchema.parse(channelOverride ?? "stable"),
  };
}

async function fetchDistTag(
  packageName: string,
  channel: Channel,
): Promise<string | null> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(channel)}`;
  const res = await fetch(url);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(
      `Failed to fetch npm info for ${packageName}@${channel}: ${res.status}`,
    );
  }
  const raw = await res.json();
  const parsed = npmTagResponseSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data.version;
  }
  if (typeof raw.version === "string" && raw.version.trim().length > 0) {
    return raw.version;
  }
  return null;
}

async function getPackageVersion(
  packageName: string,
  channel: Channel,
): Promise<string> {
  const requestedVersion = await fetchDistTag(packageName, channel);
  if (requestedVersion) {
    console.log(`[${packageName}] Using ${channel}: ${requestedVersion}`);
    return requestedVersion;
  }

  if (channel !== "latest") {
    console.warn(
      `[${packageName}] Channel '${channel}' not found, falling back to 'latest'`,
    );
    const latestVersion = await fetchDistTag(packageName, "latest");
    if (latestVersion) {
      console.log(`[${packageName}] Using latest: ${latestVersion}`);
      return latestVersion;
    }
  }

  throw new Error(
    `[${packageName}] Failed to resolve '${channel}' dist-tag (latest fallback unavailable)`,
  );
}

const marketplaceVersionPropertySchema = z.object({
  key: z.string(),
  value: z.string(),
});

const marketplaceVersionSchema = z.object({
  version: z.string().min(1),
  properties: z.array(marketplaceVersionPropertySchema).optional(),
});

const marketplaceResponseSchema = z.object({
  results: z.array(
    z.object({
      extensions: z.array(
        z.object({
          versions: z.array(marketplaceVersionSchema),
        }),
      ),
    }),
  ),
});

// Flags for VS Code Marketplace API:
// 0x1 = IncludeVersions, 0x2 = IncludeFiles, 0x80 = IncludeLatestVersionOnly (negated by pageSize)
// 0x100 = IncludeVersionProperties, 0x200 = ExcludeNonValidated, 0x800 = IncludeAssetUri
// We need 0x100 for version properties (to check PreRelease flag)
// Using 2359 = 0x937 which includes version properties
const marketplaceFlags = 2359;

function isPreReleaseVersion(
  version: z.infer<typeof marketplaceVersionSchema>,
): boolean {
  const props = version.properties ?? [];
  return props.some(
    (p) =>
      p.key === "Microsoft.VisualStudio.Code.PreRelease" && p.value === "true",
  );
}

async function fetchLatestExtensionVersion(
  publisher: string,
  name: string,
): Promise<string> {
  const body = {
    filters: [
      {
        criteria: [
          {
            filterType: 7,
            value: `${publisher}.${name}`,
          },
        ],
        // Request enough versions to find a stable one (pre-release versions may be at the top)
        pageSize: 100,
      },
    ],
    flags: marketplaceFlags,
  };

  const res = await fetch(
    "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json;api-version=3.0-preview.1",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    throw new Error(
      `Failed to fetch marketplace info for ${publisher}.${name}: ${res.status}`,
    );
  }

  const data = marketplaceResponseSchema.parse(await res.json());
  const versions = data.results[0]?.extensions[0]?.versions ?? [];
  if (versions.length === 0) {
    throw new Error(
      `No versions returned for marketplace extension ${publisher}.${name}`,
    );
  }

  // Find the first non-pre-release version (stable)
  // Versions are returned in order (newest first), so first stable = latest stable
  const stableVersion = versions.find((v) => !isPreReleaseVersion(v));
  if (stableVersion) {
    console.log(
      `[${publisher}.${name}] Using stable: ${stableVersion.version}`,
    );
    return stableVersion.version;
  }

  // If no stable version found, fall back to latest (which may be pre-release)
  const latestVersion = versions[0]?.version;
  if (!latestVersion) {
    throw new Error(
      `No versions found for marketplace extension ${publisher}.${name}`,
    );
  }
  console.warn(
    `[${publisher}.${name}] No stable version found, using pre-release: ${latestVersion}`,
  );
  return latestVersion;
}

async function bumpPackages(
  deps: IdeDeps,
  channel: Channel,
): Promise<void> {
  const packageNames = Object.keys(deps.packages);
  const latestEntries = await Promise.all(
    packageNames.map(async (name) => {
      const version = await getPackageVersion(name, channel);
      return { name, version };
    }),
  );

  for (const { name, version } of latestEntries) {
    deps.packages[name] = version;
  }
}

async function bumpExtensions(deps: IdeDeps): Promise<void> {
  const latestVersions = await Promise.all(
    deps.extensions.map(async (ext) => {
      const version = await fetchLatestExtensionVersion(
        ext.publisher,
        ext.name,
      );
      return version;
    }),
  );

  if (latestVersions.length !== deps.extensions.length) {
    throw new Error(
      `Marketplace version count mismatch: expected ${deps.extensions.length}, got ${latestVersions.length}`,
    );
  }

  for (let i = 0; i < deps.extensions.length; i += 1) {
    const ext = deps.extensions[i];
    const latestVersion = latestVersions[i];
    if (!latestVersion) {
      throw new Error(
        `Missing latest version for extension ${ext.publisher}.${ext.name}`,
      );
    }
    ext.version = latestVersion;
  }
}

async function main(): Promise<void> {
  const { channel } = parseArgs(process.argv.slice(2));
  console.log(`[bump-ide-deps] Channel: ${channel}`);

  const repoRoot = process.cwd();
  const deps = await readIdeDeps(repoRoot);
  const originalDeps: IdeDeps = structuredClone(deps);

  await Promise.all([bumpPackages(deps, channel), bumpExtensions(deps)]);

  const originalString = JSON.stringify(originalDeps);
  const updatedString = JSON.stringify(deps);
  const depsChanged = originalString !== updatedString;

  if (depsChanged) {
    await writeIdeDeps(repoRoot, deps);
    console.log("Updated configs/ide-deps.json");
  } else {
    console.log("configs/ide-deps.json already up to date.");
  }

  const { dockerfileChanged, snapshotChanged } = await applyIdeDepsPins(
    repoRoot,
    deps,
  );

  if (dockerfileChanged || snapshotChanged) {
    console.log(
      `Synced pins: Dockerfile=${dockerfileChanged}, snapshot=${snapshotChanged}`,
    );
  } else if (depsChanged) {
    console.log("Dockerfile and snapshot already in sync.");
  }
}

main().catch((error) => {
  console.error("bump-ide-deps failed:", error);
  process.exit(1);
});
