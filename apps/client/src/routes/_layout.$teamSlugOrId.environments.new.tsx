import { EnvironmentConfiguration } from "@/components/EnvironmentConfiguration";
import { FloatingPane } from "@/components/floating-pane";
import { RepositoryPicker } from "@/components/RepositoryPicker";
import { TitleBar } from "@/components/TitleBar";
import {
  DEFAULT_MORPH_SNAPSHOT_ID,
  MORPH_SNAPSHOT_PRESETS,
  type MorphSnapshotId,
} from "@cmux/shared";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { usePendingEnvironment } from "@/lib/pendingEnvironmentsStore";

const morphSnapshotIds = MORPH_SNAPSHOT_PRESETS.map(
  (preset) => preset.id
) as [MorphSnapshotId, ...MorphSnapshotId[]];

const searchSchema = z.object({
  step: z.enum(["select", "configure"]).default("select"),
  selectedRepos: z.array(z.string()).default([]),
  instanceId: z.string().optional(),
  connectionLogin: z.string().optional(),
  repoSearch: z.string().optional(),
  snapshotId: z.enum(morphSnapshotIds).default(DEFAULT_MORPH_SNAPSHOT_ID),
});

export const Route = createFileRoute("/_layout/$teamSlugOrId/environments/new")(
  {
    component: EnvironmentsPage,
    validateSearch: searchSchema,
  }
);

function EnvironmentsPage() {
  const { teamSlugOrId } = Route.useParams();
  const searchParams = Route.useSearch();
  const pending = usePendingEnvironment(teamSlugOrId);

  const step = searchParams.step ?? pending?.step ?? "select";
  const shouldFallbackToPending = searchParams.step === undefined && pending != null;

  const selectedRepos = shouldFallbackToPending
    ? pending.selectedRepos
    : searchParams.selectedRepos ?? pending?.selectedRepos ?? [];

  const selectedSnapshotId = shouldFallbackToPending
    ? pending?.snapshotId ?? DEFAULT_MORPH_SNAPSHOT_ID
    : searchParams.snapshotId ?? pending?.snapshotId ?? DEFAULT_MORPH_SNAPSHOT_ID;

  const instanceId = shouldFallbackToPending
    ? pending?.instanceId
    : searchParams.instanceId ?? pending?.instanceId;

  const derivedVscodeUrl = useMemo(() => {
    if (shouldFallbackToPending && pending?.vscodeUrl) {
      return pending.vscodeUrl;
    }
    if (!instanceId) return undefined;
    const hostId = instanceId.replace(/_/g, "-");
    return `https://port-39378-${hostId}.http.cloud.morph.so/?folder=/root/workspace`;
  }, [instanceId, pending, shouldFallbackToPending]);

  return (
    <FloatingPane header={<TitleBar title="Environments" />}>
      <div className="flex flex-col grow select-none relative h-full overflow-hidden">
        {step === "select" ? (
          <div className="p-6 max-w-3xl w-full mx-auto overflow-auto">
            <RepositoryPicker
              teamSlugOrId={teamSlugOrId}
              instanceId={instanceId ?? undefined}
              initialSelectedRepos={selectedRepos}
              initialSnapshotId={selectedSnapshotId}
              showHeader={true}
              showContinueButton={true}
              showManualConfigOption={true}
            />
          </div>
        ) : (
          <EnvironmentConfiguration
            selectedRepos={selectedRepos}
            teamSlugOrId={teamSlugOrId}
            instanceId={instanceId ?? undefined}
            vscodeUrl={derivedVscodeUrl}
            isProvisioning={false}
            initialEnvName={pending?.envName ?? ""}
            initialMaintenanceScript={pending?.maintenanceScript ?? ""}
            initialDevScript={pending?.devScript ?? ""}
            initialExposedPorts={pending?.exposedPorts ?? ""}
            initialEnvVars={pending?.envVars}
          />
        )}
      </div>
    </FloatingPane>
  );
}
