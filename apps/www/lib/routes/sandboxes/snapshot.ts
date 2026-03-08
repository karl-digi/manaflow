import { DEFAULT_MORPH_SNAPSHOT_ID } from "@/lib/utils/morph-defaults";
import {
  DEFAULT_PVE_LXC_SNAPSHOT_ID,
  PVE_LXC_SNAPSHOT_PRESETS,
} from "@/lib/utils/pve-lxc-defaults";
import {
  getActiveSandboxProvider,
  isMorphAvailable,
  isProxmoxAvailable,
} from "@/lib/utils/sandbox-provider";
import type { ConfigProvider } from "@cmux/shared/provider-types";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { api } from "@cmux/convex/api";
import { MORPH_SNAPSHOT_PRESETS } from "@cmux/shared";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { HTTPException } from "hono/http-exception";

import type { getConvex } from "@/lib/utils/get-convex";

export type ConvexClient = ReturnType<typeof getConvex>;

export interface SnapshotResolution {
  team: Awaited<ReturnType<typeof verifyTeamAccess>>;
  resolvedSnapshotId: string;
  /** The sandbox provider to use (may be an unknown/external provider) */
  provider: string;
  resolvedTemplateVmid?: number;
  environmentDataVaultKey?: string;
  environmentMaintenanceScript?: string;
  environmentDevScript?: string;
  /** Selected repositories from the environment (for auto-cloning) */
  environmentSelectedRepos?: string[];
}

/**
 * Get the default snapshot ID based on the active provider
 */
function getDefaultSnapshotId(provider: string): string {
  switch (provider) {
    case "pve-lxc":
      return DEFAULT_PVE_LXC_SNAPSHOT_ID;
    case "pve-vm":
      // NOTE: PVE VM provider is not yet implemented.
      // Temporarily falls back to Morph default until PVE VM support is added.
      return DEFAULT_MORPH_SNAPSHOT_ID;
    case "morph":
    default:
      return DEFAULT_MORPH_SNAPSHOT_ID;
  }
}

/**
 * Check if a snapshot ID is a known default snapshot for any provider
 */
function isKnownDefaultSnapshot(snapshotId: string): boolean {
  // Check Morph snapshots
  const isMorphSnapshot = MORPH_SNAPSHOT_PRESETS.some((preset) =>
    preset.versions.some((v) => v.snapshotId === snapshotId)
  );
  if (isMorphSnapshot) {
    return true;
  }

  // Check PVE LXC templates (canonical snapshot_*)
  const isPveTemplate = PVE_LXC_SNAPSHOT_PRESETS.some((preset) =>
    preset.versions.some((v) => v.snapshotId === snapshotId)
  );
  return isPveTemplate;
}

function resolveProviderForSnapshotId(
  snapshotId: string
): ConfigProvider | null {
  const isMorphSnapshot = MORPH_SNAPSHOT_PRESETS.some((preset) =>
    preset.versions.some((v) => v.snapshotId === snapshotId)
  );
  const isPveSnapshot = PVE_LXC_SNAPSHOT_PRESETS.some((preset) =>
    preset.versions.some((v) => v.snapshotId === snapshotId)
  );

  if (isMorphSnapshot && !isPveSnapshot) {
    return "morph";
  }
  if (isPveSnapshot && !isMorphSnapshot) {
    return "pve-lxc";
  }
  return null;
}

function ensureProviderAvailable(provider: string): void {
  if (provider === "pve-vm") {
    throw new HTTPException(501, {
      message: "PVE VM provider is not supported yet",
    });
  }
  if (provider === "morph" && !isMorphAvailable()) {
    throw new HTTPException(503, {
      message: "Morph provider is not configured",
    });
  }
  if (provider === "pve-lxc" && !isProxmoxAvailable()) {
    throw new HTTPException(503, {
      message: "PVE LXC provider is not configured",
    });
  }
  // Unknown providers (e.g. "e2b") -- no startup validation needed,
  // credentials are managed elsewhere.
}

function isSandboxProvider(value: string | undefined): value is ConfigProvider {
  return value === "morph" || value === "pve-lxc" || value === "pve-vm";
}

export const resolveTeamAndSnapshot = async ({
  req,
  convex,
  teamSlugOrId,
  environmentId,
  snapshotId,
}: {
  req: Request;
  convex: ConvexClient;
  teamSlugOrId: string;
  environmentId?: string;
  snapshotId?: string;
}): Promise<SnapshotResolution> => {
  const team = await verifyTeamAccess({ req, teamSlugOrId });

  const provider = (() => {
    try {
      return getActiveSandboxProvider().provider;
    } catch {
      if (isMorphAvailable()) {
        return "morph";
      }
      if (isProxmoxAvailable()) {
        return "pve-lxc";
      }
      throw new HTTPException(500, {
        message: "No sandbox provider configured",
      });
    }
  })();
  const defaultSnapshotId = getDefaultSnapshotId(provider);

  if (environmentId) {
    const environmentDoc = await convex.query(api.environments.get, {
      teamSlugOrId,
      id: typedZid("environments").parse(environmentId),
    });

    if (!environmentDoc) {
      throw new HTTPException(403, {
        message: "Environment not found or not accessible",
      });
    }

    const snapshotId = environmentDoc.snapshotId ?? defaultSnapshotId;
    const environmentProvider =
      (isSandboxProvider(environmentDoc.snapshotProvider)
        ? environmentDoc.snapshotProvider
        : undefined) ??
      (snapshotId ? resolveProviderForSnapshotId(snapshotId) : null) ??
      provider;

    ensureProviderAvailable(environmentProvider);
    return {
      team,
      provider: environmentProvider,
      resolvedSnapshotId: snapshotId,
      resolvedTemplateVmid: environmentDoc.templateVmid ?? undefined,
      environmentDataVaultKey: environmentDoc.dataVaultKey ?? undefined,
      environmentMaintenanceScript: environmentDoc.maintenanceScript ?? undefined,
      environmentDevScript: environmentDoc.devScript ?? undefined,
      environmentSelectedRepos: environmentDoc.selectedRepos ?? undefined,
    };
  }

  if (snapshotId) {
    const resolvedSnapshotProvider = resolveProviderForSnapshotId(snapshotId);
    const snapshotProvider = resolvedSnapshotProvider ?? provider;

    const environments = await convex.query(api.environments.list, {
      teamSlugOrId,
    });
    const matchedEnvironment = environments.find(
      (environment) => environment.snapshotId === snapshotId
    );

    if (matchedEnvironment) {
      const environmentProvider =
        (isSandboxProvider(matchedEnvironment.snapshotProvider)
          ? matchedEnvironment.snapshotProvider
          : undefined) ??
        (matchedEnvironment.snapshotId
          ? resolveProviderForSnapshotId(matchedEnvironment.snapshotId)
          : null) ??
        provider;
      ensureProviderAvailable(environmentProvider);
      return {
        team,
        provider: environmentProvider,
        resolvedSnapshotId:
          matchedEnvironment.snapshotId ?? getDefaultSnapshotId(environmentProvider),
        resolvedTemplateVmid: matchedEnvironment.templateVmid ?? undefined,
      };
    }

    if (isKnownDefaultSnapshot(snapshotId)) {
      const defaultProvider = resolvedSnapshotProvider ?? snapshotProvider;
      ensureProviderAvailable(defaultProvider);
      return {
        team,
        provider: defaultProvider,
        resolvedSnapshotId: snapshotId,
      };
    }

    const snapshotVersion = await convex.query(
      api.environmentSnapshots.findBySnapshotId,
      {
        teamSlugOrId,
        snapshotId,
        snapshotProvider: resolvedSnapshotProvider ?? undefined,
      }
    );

    if (!snapshotVersion) {
      throw new HTTPException(403, {
        message: "Forbidden: Snapshot does not belong to this team",
      });
    }

    const versionProvider =
      (isSandboxProvider(snapshotVersion.snapshotProvider)
        ? snapshotVersion.snapshotProvider
        : undefined) ??
      (snapshotVersion.snapshotId
        ? resolveProviderForSnapshotId(snapshotVersion.snapshotId)
        : null) ??
      resolvedSnapshotProvider ??
      provider;

    ensureProviderAvailable(versionProvider);
    return {
      team,
      provider: versionProvider,
      resolvedSnapshotId:
        snapshotVersion.snapshotId ?? getDefaultSnapshotId(versionProvider),
      resolvedTemplateVmid: snapshotVersion.templateVmid ?? undefined,
    };
  }

  ensureProviderAvailable(provider);
  return {
    team,
    provider,
    resolvedSnapshotId: defaultSnapshotId,
  };
};
