import { DEFAULT_MORPH_SNAPSHOT_ID } from "@/lib/utils/morph-defaults";
import {
  DEFAULT_PVE_LXC_SNAPSHOT_ID,
  PVE_LXC_SNAPSHOT_PRESETS,
} from "@/lib/utils/pve-lxc-defaults";
import {
  getActiveSandboxProvider,
  type SandboxProvider,
} from "@/lib/utils/sandbox-provider";
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
  /** The sandbox provider to use */
  provider: SandboxProvider;
  resolvedTemplateVmid?: number;
  environmentDataVaultKey?: string;
  environmentMaintenanceScript?: string;
  environmentDevScript?: string;
}

/**
 * Get the default snapshot ID based on the active provider
 */
function getDefaultSnapshotId(provider: SandboxProvider): string {
  switch (provider) {
    case "pve-lxc":
      return DEFAULT_PVE_LXC_SNAPSHOT_ID;
    case "pve-vm":
      // TODO: Add default PVE VM snapshot when implemented
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

  // Determine the active provider
  const providerConfig = getActiveSandboxProvider();
  const provider = providerConfig.provider;
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

    const snapshotId =
      environmentDoc.snapshotId ?? environmentDoc.morphSnapshotId ?? defaultSnapshotId;
    return {
      team,
      provider,
      resolvedSnapshotId: snapshotId,
      resolvedTemplateVmid: environmentDoc.templateVmid ?? undefined,
      environmentDataVaultKey: environmentDoc.dataVaultKey ?? undefined,
      environmentMaintenanceScript: environmentDoc.maintenanceScript ?? undefined,
      environmentDevScript: environmentDoc.devScript ?? undefined,
    };
  }

  if (snapshotId) {
    if (isKnownDefaultSnapshot(snapshotId)) {
      return {
        team,
        provider,
        resolvedSnapshotId: snapshotId,
      };
    }

    const environments = await convex.query(api.environments.list, {
      teamSlugOrId,
    });
    const matchedEnvironment = environments.find((environment) =>
      (environment.snapshotId ?? environment.morphSnapshotId) === snapshotId
    );

    if (matchedEnvironment) {
      return {
        team,
        provider,
        resolvedSnapshotId:
          matchedEnvironment.snapshotId ??
          matchedEnvironment.morphSnapshotId ??
          defaultSnapshotId,
        resolvedTemplateVmid: matchedEnvironment.templateVmid ?? undefined,
      };
    }

    const snapshotVersion = await convex.query(
      api.environmentSnapshots.findBySnapshotId,
      {
        teamSlugOrId,
        snapshotId,
        snapshotProvider: provider,
      }
    );

    if (!snapshotVersion) {
      throw new HTTPException(403, {
        message: "Forbidden: Snapshot does not belong to this team",
      });
    }

    return {
      team,
      provider,
      resolvedSnapshotId:
        snapshotVersion.snapshotId ??
        snapshotVersion.morphSnapshotId ??
        defaultSnapshotId,
      resolvedTemplateVmid: snapshotVersion.templateVmid ?? undefined,
    };
  }

  return {
    team,
    provider,
    resolvedSnapshotId: defaultSnapshotId,
  };
};
