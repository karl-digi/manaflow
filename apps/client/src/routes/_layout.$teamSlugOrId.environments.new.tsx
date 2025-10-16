import { EnvironmentConfiguration } from "@/components/EnvironmentConfiguration";
import { FloatingPane } from "@/components/floating-pane";
import { RepositoryPicker } from "@/components/RepositoryPicker";
import { TitleBar } from "@/components/TitleBar";
import {
  createEnvironmentDraft,
  getEnvironmentDraft,
  type EnvironmentDraft,
} from "@/lib/environmentDraftStorage";
import {
  DEFAULT_MORPH_SNAPSHOT_ID,
  MORPH_SNAPSHOT_PRESETS,
  type MorphSnapshotId,
} from "@cmux/shared";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
  draftId: z.string().optional(),
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
  const navigate = useNavigate();
  const { teamSlugOrId } = Route.useParams();

  const step = searchParams.step ?? "select";
  const searchSelectedRepos = searchParams.selectedRepos ?? [];
  const searchInstanceId = searchParams.instanceId;
  const searchSnapshotId =
    searchParams.snapshotId ?? DEFAULT_MORPH_SNAPSHOT_ID;
  const searchDraftId = searchParams.draftId;
  const searchConnectionLogin = searchParams.connectionLogin;
  const searchRepoSearch = searchParams.repoSearch;

  const hasInitializedDraft = useRef(false);

  const [draft, setDraft] = useState<EnvironmentDraft | undefined>(() => {
    if (typeof window === "undefined" || !searchDraftId) {
      return undefined;
    }
    return getEnvironmentDraft(searchDraftId);
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!searchDraftId) {
      if (hasInitializedDraft.current) {
        return;
      }
      hasInitializedDraft.current = true;
      const newDraftId =
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `draft-${Date.now().toString(16)}-${Math.random()
              .toString(16)
              .slice(2)}`;
      const baseDraft = createEnvironmentDraft({
        id: newDraftId,
        teamSlugOrId,
        step,
        selectedRepos: searchSelectedRepos,
        snapshotId: searchSnapshotId,
        instanceId: searchInstanceId ?? undefined,
        connectionLogin: searchConnectionLogin,
        repoSearch: searchRepoSearch,
        envName: "",
        maintenanceScript: "",
        devScript: "",
        exposedPorts: "",
        envVars: [],
        vscodeUrl: undefined,
      });
      setDraft(baseDraft);
      void navigate({
        to: "/$teamSlugOrId/environments/new",
        params: { teamSlugOrId },
        search: () => ({
          step,
          selectedRepos: searchSelectedRepos,
          instanceId: searchInstanceId,
          connectionLogin: searchConnectionLogin,
          repoSearch: searchRepoSearch,
          snapshotId: searchSnapshotId,
          draftId: newDraftId,
        }),
        replace: true,
      });
      return;
    }
    if (!hasInitializedDraft.current) {
      hasInitializedDraft.current = true;
    }
  }, [
    navigate,
    searchConnectionLogin,
    searchDraftId,
    searchInstanceId,
    searchRepoSearch,
    searchSelectedRepos,
    searchSnapshotId,
    step,
    teamSlugOrId,
  ]);

  useEffect(() => {
    if (typeof window === "undefined" || !searchDraftId) {
      return;
    }
    const stored = getEnvironmentDraft(searchDraftId);
    if (stored) {
      setDraft(stored);
      return;
    }
    const fallback = createEnvironmentDraft({
      id: searchDraftId,
      teamSlugOrId,
      step,
      selectedRepos: searchSelectedRepos,
      snapshotId: searchSnapshotId,
      instanceId: searchInstanceId ?? undefined,
      connectionLogin: searchConnectionLogin,
      repoSearch: searchRepoSearch,
      envName: "",
      maintenanceScript: "",
      devScript: "",
      exposedPorts: "",
      envVars: [],
      vscodeUrl: undefined,
    });
    setDraft(fallback);
  }, [
    searchDraftId,
    searchSelectedRepos,
    searchSnapshotId,
    searchInstanceId,
    searchConnectionLogin,
    searchRepoSearch,
    step,
    teamSlugOrId,
  ]);

  const draftId = draft?.id ?? searchDraftId;
  const effectiveSelectedRepos = draft?.selectedRepos ?? searchSelectedRepos;
  const effectiveSnapshotId = draft?.snapshotId ?? searchSnapshotId;
  const effectiveInstanceId = draft?.instanceId ?? searchInstanceId;
  const draftVscodeUrl = draft?.vscodeUrl;

  const derivedVscodeUrl = useMemo(() => {
    if (effectiveInstanceId) {
      const hostId = effectiveInstanceId.replace(/_/g, "-");
      return `https://port-39378-${hostId}.http.cloud.morph.so/?folder=/root/workspace`;
    }
    return draftVscodeUrl;
  }, [draftVscodeUrl, effectiveInstanceId]);

  return (
    <FloatingPane header={<TitleBar title="Environments" />}>
      <div className="flex flex-col grow select-none relative h-full overflow-hidden">
        {step === "select" ? (
          <div className="p-6 max-w-3xl w-full mx-auto overflow-auto">
            <RepositoryPicker
              teamSlugOrId={teamSlugOrId}
              instanceId={effectiveInstanceId}
              draftId={draftId}
              initialSelectedRepos={effectiveSelectedRepos}
              initialSnapshotId={effectiveSnapshotId}
              showHeader={true}
              showContinueButton={true}
              showManualConfigOption={true}
            />
          </div>
        ) : (
          <EnvironmentConfiguration
            selectedRepos={effectiveSelectedRepos}
            teamSlugOrId={teamSlugOrId}
            instanceId={effectiveInstanceId}
            vscodeUrl={derivedVscodeUrl}
            isProvisioning={false}
            draftId={draftId}
            initialEnvName={draft?.envName ?? ""}
            initialMaintenanceScript={draft?.maintenanceScript ?? ""}
            initialDevScript={draft?.devScript ?? ""}
            initialExposedPorts={draft?.exposedPorts ?? ""}
            initialEnvVars={draft?.envVars}
          />
        )}
      </div>
    </FloatingPane>
  );
}
