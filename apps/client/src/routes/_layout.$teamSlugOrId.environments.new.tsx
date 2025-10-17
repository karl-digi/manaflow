import { EnvironmentConfiguration } from "@/components/EnvironmentConfiguration";
import { FloatingPane } from "@/components/floating-pane";
import { RepositoryPicker } from "@/components/RepositoryPicker";
import { TitleBar } from "@/components/TitleBar";
import {
  getDraftByInstance,
  getSelectionDraft,
} from "@/lib/pendingEnvironmentStorage";
import { DEFAULT_MORPH_SNAPSHOT_ID, MORPH_SNAPSHOT_PRESETS, type MorphSnapshotId } from "@cmux/shared";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";

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
  const searchParams = Route.useSearch();
  const step = searchParams.step ?? "select";
  const urlSelectedRepos = searchParams.selectedRepos ?? [];
  const urlInstanceId = searchParams.instanceId;
  const selectedSnapshotId = searchParams.snapshotId ?? DEFAULT_MORPH_SNAPSHOT_ID;
  const { teamSlugOrId } = Route.useParams();
  const selectionDraft = useMemo(
    () => getSelectionDraft(teamSlugOrId),
    [teamSlugOrId]
  );
  const configurationDraft = useMemo(
    () => (urlInstanceId ? getDraftByInstance(urlInstanceId) : undefined),
    [urlInstanceId]
  );
  const derivedSelectedRepos =
    urlSelectedRepos.length > 0
      ? urlSelectedRepos
      : configurationDraft?.selectedRepos?.length
        ? configurationDraft.selectedRepos
        : selectionDraft?.selectedRepos ?? [];
  const effectiveSnapshotId =
    configurationDraft?.snapshotId ??
    selectionDraft?.snapshotId ??
    selectedSnapshotId;
  const initialEnvName = configurationDraft?.envName ?? "";
  const initialMaintenanceScript = configurationDraft?.maintenanceScript ?? "";
  const initialDevScript = configurationDraft?.devScript ?? "";
  const initialExposedPorts = configurationDraft?.exposedPorts ?? "";
  const initialEnvVars = configurationDraft?.envVars;
  const derivedVscodeUrl = useMemo(() => {
    if (!urlInstanceId) return undefined;
    const hostId = urlInstanceId.replace(/_/g, "-");
    return `https://port-39378-${hostId}.http.cloud.morph.so/?folder=/root/workspace`;
  }, [urlInstanceId]);

  return (
    <FloatingPane header={<TitleBar title="Environments" />}>
      <div className="flex flex-col grow select-none relative h-full overflow-hidden">
        {step === "select" ? (
          <div className="p-6 max-w-3xl w-full mx-auto overflow-auto">
            <RepositoryPicker
              key={`select-${teamSlugOrId}`}
              teamSlugOrId={teamSlugOrId}
              instanceId={urlInstanceId}
              initialSelectedRepos={derivedSelectedRepos}
              initialSnapshotId={effectiveSnapshotId}
              showHeader={true}
              showContinueButton={true}
              showManualConfigOption={true}
            />
          </div>
        ) : (
          <EnvironmentConfiguration
            key={`configure-${urlInstanceId ?? "pending"}`}
            selectedRepos={derivedSelectedRepos}
            teamSlugOrId={teamSlugOrId}
            instanceId={urlInstanceId}
            vscodeUrl={derivedVscodeUrl}
            isProvisioning={false}
            initialEnvName={initialEnvName}
            initialMaintenanceScript={initialMaintenanceScript}
            initialDevScript={initialDevScript}
            initialExposedPorts={initialExposedPorts}
            initialEnvVars={initialEnvVars}
          />
        )}
      </div>
    </FloatingPane>
  );
}
