import { EnvironmentConfiguration } from "@/components/EnvironmentConfiguration";
import { FloatingPane } from "@/components/floating-pane";
import { RepositoryPicker } from "@/components/RepositoryPicker";
import { TitleBar } from "@/components/TitleBar";
import { toMorphVncUrl } from "@/lib/toProxyWorkspaceUrl";
import {
  getEnvironmentDraft,
  makeEnvironmentDraftKey,
} from "@/stores/environmentDraftStore";
import { DEFAULT_MORPH_SNAPSHOT_ID, MORPH_SNAPSHOT_PRESETS, type MorphSnapshotId } from "@cmux/shared";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";

const morphSnapshotIds = MORPH_SNAPSHOT_PRESETS.map(
  (preset) => preset.id
) as [MorphSnapshotId, ...MorphSnapshotId[]];

const searchSchema = z.object({
  step: z.enum(["select", "configure"]).optional(),
  selectedRepos: z.array(z.string()).optional(),
  instanceId: z.string().optional(),
  connectionLogin: z.string().optional(),
  repoSearch: z.string().optional(),
  snapshotId: z.enum(morphSnapshotIds).optional(),
});

export const Route = createFileRoute("/_layout/$teamSlugOrId/environments/new")(
  {
    component: EnvironmentsPage,
    validateSearch: searchSchema,
  }
);

function EnvironmentsPage() {
  const searchParams = Route.useSearch();
  const { teamSlugOrId } = Route.useParams();
  const draftKey = useMemo(
    () => makeEnvironmentDraftKey({ teamSlugOrId, mode: "new" }),
    [teamSlugOrId]
  );
  const persistedDraft = useMemo(
    () => (draftKey ? getEnvironmentDraft(draftKey) : undefined),
    [draftKey]
  );
  const step = searchParams.step ?? persistedDraft?.step ?? "select";
  const selectedRepos =
    searchParams.selectedRepos ?? persistedDraft?.selectedRepos ?? [];
  const effectiveInstanceId =
    searchParams.instanceId ?? persistedDraft?.instanceId;
  const selectedSnapshotId =
    searchParams.snapshotId ??
    persistedDraft?.snapshotId ??
    DEFAULT_MORPH_SNAPSHOT_ID;
  const [headerActions, setHeaderActions] = useState<ReactNode | null>(null);
  const derivedVscodeUrl = useMemo(() => {
    if (!effectiveInstanceId) return undefined;
    const hostId = effectiveInstanceId.replace(/_/g, "-");
    return `https://port-39378-${hostId}.http.cloud.morph.so/?folder=/root/workspace`;
  }, [effectiveInstanceId]);

  const derivedBrowserUrl = useMemo(() => {
    if (!effectiveInstanceId) return undefined;
    const hostId = effectiveInstanceId.replace(/_/g, "-");
    const workspaceUrl = `https://port-39378-${hostId}.http.cloud.morph.so/?folder=/root/workspace`;
    return toMorphVncUrl(workspaceUrl) ?? undefined;
  }, [effectiveInstanceId]);

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
              instanceId={effectiveInstanceId}
              initialSelectedRepos={selectedRepos}
              initialSnapshotId={selectedSnapshotId}
              showHeader={true}
              showContinueButton={true}
              showManualConfigOption={true}
              draftKey={draftKey}
            />
          </div>
        ) : (
          <EnvironmentConfiguration
            selectedRepos={selectedRepos}
            teamSlugOrId={teamSlugOrId}
            instanceId={effectiveInstanceId}
            vscodeUrl={derivedVscodeUrl}
            browserUrl={derivedBrowserUrl}
            isProvisioning={false}
            draftKey={draftKey}
            onHeaderControlsChange={setHeaderActions}
          />
        )}
      </div>
    </FloatingPane>
  );
}
