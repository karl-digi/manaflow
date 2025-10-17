import { EnvironmentConfiguration } from "@/components/EnvironmentConfiguration";
import { FloatingPane } from "@/components/floating-pane";
import { RepositoryPicker } from "@/components/RepositoryPicker";
import { TitleBar } from "@/components/TitleBar";
import { toMorphVncUrl } from "@/lib/toProxyWorkspaceUrl";
import { DEFAULT_MORPH_SNAPSHOT_ID, MORPH_SNAPSHOT_PRESETS, type MorphSnapshotId } from "@cmux/shared";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  const [headerActions, setHeaderActions] = useState<ReactNode | null>(null);
  const derivedVscodeUrl = useMemo(() => {
    if (!urlInstanceId) return undefined;
    const hostId = urlInstanceId.replace(/_/g, "-");
    return `https://port-39378-${hostId}.http.cloud.morph.so/?folder=/root/workspace`;
  }, [urlInstanceId]);

  const derivedBrowserUrl = useMemo(() => {
    if (!urlInstanceId) return undefined;
    const hostId = urlInstanceId.replace(/_/g, "-");
    const workspaceUrl = `https://port-39378-${hostId}.http.cloud.morph.so/?folder=/root/workspace`;
    return toMorphVncUrl(workspaceUrl) ?? undefined;
  }, [urlInstanceId]);

  useEffect(() => {
    if (step !== "configure") {
      setHeaderActions(null);
    }
  }, [step]);

  return (
    <FloatingPane header={<TitleBar title="Environments" actions={headerActions} />}>
      <div className="flex flex-col grow select-none relative h-full overflow-hidden">
        {step === "select" ? (
          <div className="p-6 max-w-3xl w-full mx-auto overflow-auto">
            <RepositoryPicker
              teamSlugOrId={teamSlugOrId}
              instanceId={urlInstanceId}
              initialSelectedRepos={urlSelectedRepos}
              initialSnapshotId={selectedSnapshotId}
              showHeader={true}
              showContinueButton={true}
              showManualConfigOption={true}
            />
          </div>
        ) : (
          <EnvironmentConfiguration
            selectedRepos={urlSelectedRepos}
            teamSlugOrId={teamSlugOrId}
            instanceId={urlInstanceId}
            vscodeUrl={derivedVscodeUrl}
            browserUrl={derivedBrowserUrl}
            isProvisioning={false}
            onHeaderControlsChange={setHeaderActions}
          />
        )}
      </div>
    </FloatingPane>
  );
}
