import { EnvironmentSetupFlow } from "@/components/environment";
import { FloatingPane } from "@/components/floating-pane";
import { RepositoryPicker } from "@/components/RepositoryPicker";
import { TitleBar } from "@/components/TitleBar";
import { resolveEnvironmentSetupInitialLayoutPhase } from "@/lib/environment-setup-layout-phase";
import { resolveCanonicalSandboxSnapshotId } from "@/lib/sandbox-config-snapshot";
import {
  clearEnvironmentDraft,
  persistEnvironmentDraftMetadata,
  useEnvironmentDraft,
} from "@/state/environment-draft-store";
import {
  getApiConfigSandboxOptions,
  postApiMorphSetupInstanceMutation,
} from "@cmux/www-openapi-client/react-query";
import { useMutation as useRQMutation, useQuery as useRQQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { z } from "zod";

const searchSchema = z.object({
  step: z.enum(["select", "configure"]).default("select"),
  selectedRepos: z.array(z.string()).default([]),
  instanceId: z.string().optional(),
  connectionLogin: z.string().optional(),
  repoSearch: z.string().optional(),
  // snapshotId is now optional - will be set to provider's default when undefined
  snapshotId: z.string().optional(),
});

const haveSameRepos = (
  a: readonly string[],
  b: readonly string[],
): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  const counts = new Map<string, number>();
  for (const repo of a) {
    counts.set(repo, (counts.get(repo) ?? 0) + 1);
  }
  for (const repo of b) {
    const next = counts.get(repo);
    if (!next) {
      return false;
    }
    if (next === 1) {
      counts.delete(repo);
    } else {
      counts.set(repo, next - 1);
    }
  }
  return counts.size === 0;
};

export const Route = createFileRoute("/_layout/$teamSlugOrId/environments/new")(
  {
    component: EnvironmentsPage,
    validateSearch: searchSchema,
  }
);

function EnvironmentsPage() {
  const searchParams = Route.useSearch();
  const stepFromSearch = searchParams.step ?? "select";
  const urlSelectedRepos = searchParams.selectedRepos ?? [];
  const urlInstanceId = searchParams.instanceId;
  // snapshotId is optional - will be set dynamically from sandbox config API
  const searchSnapshotId = searchParams.snapshotId;
  const { teamSlugOrId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const draft = useEnvironmentDraft(teamSlugOrId);
  const [headerActions, setHeaderActions] = useState<ReactNode | null>(null);
  const skipDraftHydrationRef = useRef(false);
  const provisioningTriggeredRef = useRef(false);
  const successHandledRef = useRef(false);
  const loggedErrorRef = useRef<unknown>(null);
  const [provisionRetryKey, setProvisionRetryKey] = useState(0);

  // Fetch sandbox config to normalize snapshotId to canonical form
  const { data: sandboxConfig } = useRQQuery(getApiConfigSandboxOptions());

  // If we have a draft, use it - don't clear on navigation
  // Only clear via explicit discard (handleDiscardAndExit or handleResetDraft)
  const activeStep = draft?.step ?? stepFromSearch;
  const activeSelectedRepos = draft?.selectedRepos ?? urlSelectedRepos;
  const activeInstanceId = draft?.instanceId ?? urlInstanceId;
  const initialLayoutPhase = resolveEnvironmentSetupInitialLayoutPhase({
    activeStep,
    activeInstanceId,
    draftLayoutPhase: draft?.layoutPhase,
  });
  // Normalize snapshotId to canonical form (e.g., "4vcpu_8gb_32gb" -> "snapshot_xxx")
  const rawSnapshotId = draft?.snapshotId ?? searchSnapshotId;
  const activeSnapshotId = useMemo(() => {
    if (!sandboxConfig) return rawSnapshotId;
    return resolveCanonicalSandboxSnapshotId(sandboxConfig, rawSnapshotId);
  }, [sandboxConfig, rawSnapshotId]);

  // Setup instance mutation for background provisioning
  const setupInstanceMutation = useRQMutation(postApiMorphSetupInstanceMutation());

  // Trigger provisioning when on configure step without instanceId
  // Note: setupInstanceMutation is intentionally excluded from deps to prevent infinite loops.
  // The mutation object changes on every render, which would cause the effect to re-fire.
  // Combined with resetting provisioningTriggeredRef on error, this created a DDoS-like loop.
  useEffect(() => {
    if (activeStep !== "configure") {
      provisioningTriggeredRef.current = false;
      successHandledRef.current = false;
      loggedErrorRef.current = null;
      return;
    }

    // Skip if already have instanceId, already triggered, or mutation is in-flight
    // Note: isPending check prevents duplicate calls when user navigates away and back quickly
    if (activeInstanceId || provisioningTriggeredRef.current || setupInstanceMutation.isPending) {
      return;
    }

    provisioningTriggeredRef.current = true;

    // Don't use onSuccess/onError callbacks here - since setupInstanceMutation is excluded from deps
    // (to prevent infinite loops), callbacks would capture stale closures. Use separate effects below.
    setupInstanceMutation.mutate({
      body: {
        teamSlugOrId,
        selectedRepos: activeSelectedRepos,
        snapshotId: activeSnapshotId,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setupInstanceMutation excluded to prevent infinite loops
  }, [
    activeStep,
    activeInstanceId,
    activeSelectedRepos,
    activeSnapshotId,
    teamSlugOrId,
    provisionRetryKey,
  ]);

  // Handle provisioning success - react to mutation data instead of using onSuccess callback
  useEffect(() => {
    const data = setupInstanceMutation.data;
    if (data && !successHandledRef.current) {
      successHandledRef.current = true;
      // Update URL with instanceId
      void navigate({
        search: (prev) => ({
          ...prev,
          instanceId: data.instanceId,
        }),
        replace: true,
      });
      // Update draft with instanceId (preserves current step)
      persistEnvironmentDraftMetadata(
        teamSlugOrId,
        {
          selectedRepos: activeSelectedRepos,
          instanceId: data.instanceId,
          snapshotId: activeSnapshotId,
        },
        { resetConfig: false },
      );
      console.log("Instance provisioned:", data.instanceId);
      console.log("Cloned repos:", data.clonedRepos);
    }
  }, [setupInstanceMutation.data, navigate, teamSlugOrId, activeSelectedRepos, activeSnapshotId]);

  // Handle provisioning error - react to mutation error instead of using onError callback
  useEffect(() => {
    const error = setupInstanceMutation.error;
    if (error && error !== loggedErrorRef.current) {
      loggedErrorRef.current = error;
      console.error("Failed to provision instance:", error);
      const message =
        error instanceof Error ? error.message : "Failed to provision instance";
      toast.error(message);
      // Don't reset provisioningTriggeredRef here - it causes infinite retry loops
      // when combined with effect dependencies. Use Retry provisioning instead.
    }
  }, [setupInstanceMutation.error]);

  const handleRetryProvisioning = useCallback(() => {
    setupInstanceMutation.reset();
    provisioningTriggeredRef.current = false;
    successHandledRef.current = false;
    loggedErrorRef.current = null;
    setProvisionRetryKey((key) => key + 1);
  }, [setupInstanceMutation]);

  useEffect(() => {
    if (activeStep !== "configure") {
      setHeaderActions(null);
    }
  }, [activeStep]);

  useEffect(() => {
    if (activeStep !== "configure" || draft || skipDraftHydrationRef.current) {
      return;
    }
    persistEnvironmentDraftMetadata(
      teamSlugOrId,
      {
        selectedRepos: activeSelectedRepos,
        instanceId: activeInstanceId,
        snapshotId: activeSnapshotId,
      },
      { resetConfig: false, step: "configure" },
    );
  }, [
    activeInstanceId,
    activeSelectedRepos,
    activeSnapshotId,
    activeStep,
    draft,
    teamSlugOrId,
  ]);

  const handleStartConfigure = useCallback(
    (payload: {
      selectedRepos: string[];
      instanceId?: string;
      snapshotId?: string;
    }) => {
      const existingRepos = draft?.selectedRepos ?? [];
      const reposChanged = !haveSameRepos(existingRepos, payload.selectedRepos);
      const snapshotChanged = draft?.snapshotId !== payload.snapshotId;
      const shouldResetConfig = !draft || reposChanged || snapshotChanged;

      // If repos or snapshot changed, we need a NEW instance with the new repos
      // Clear instanceId to trigger re-provisioning
      const needsNewInstance = reposChanged || snapshotChanged;
      const resolvedInstanceId = needsNewInstance ? undefined : payload.instanceId;

      // Also reset the provisioning trigger so the effect will run again
      if (needsNewInstance) {
        provisioningTriggeredRef.current = false;
      }

      skipDraftHydrationRef.current = false;
      persistEnvironmentDraftMetadata(
        teamSlugOrId,
        {
          selectedRepos: payload.selectedRepos,
          instanceId: resolvedInstanceId,
          snapshotId: payload.snapshotId,
        },
        { resetConfig: shouldResetConfig, step: "configure" },
      );
    },
    [draft, teamSlugOrId],
  );

  const handleBackToRepositorySelection = useCallback(async () => {
    // Update draft state
    persistEnvironmentDraftMetadata(
      teamSlugOrId,
      {
        selectedRepos: activeSelectedRepos,
        instanceId: activeInstanceId,
        snapshotId: activeSnapshotId,
      },
      { resetConfig: false, step: "select" },
    );
    // Update URL to match
    await navigate({
      search: (prev) => ({
        ...prev,
        step: "select",
      }),
    });
  }, [activeInstanceId, activeSelectedRepos, activeSnapshotId, teamSlugOrId, navigate]);

  const handleResetDraft = useCallback(() => {
    skipDraftHydrationRef.current = true;
    clearEnvironmentDraft(teamSlugOrId);
    setHeaderActions(null);
  }, [teamSlugOrId]);

  const handleDiscardAndExit = useCallback(async () => {
    handleResetDraft();
    await navigate({
      to: "/$teamSlugOrId/environments",
      params: { teamSlugOrId },
      search: {
        step: undefined,
        selectedRepos: undefined,
        connectionLogin: undefined,
        repoSearch: undefined,
        instanceId: undefined,
        snapshotId: undefined,
      },
    });
  }, [handleResetDraft, navigate, teamSlugOrId]);

  // For configure step, wrap in FloatingPane like the select step
  // Note: EnvironmentSetupFlow handles its own layout - initial-setup is centered, workspace-config is full-width
  if (activeStep === "configure") {
    return (
      <FloatingPane header={<TitleBar title="Environments" actions={headerActions} />}>
        <div className="flex flex-col grow select-none relative h-full overflow-hidden">
          {setupInstanceMutation.error && !activeInstanceId ? (
            <div className="mx-6 mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              <div className="flex items-center justify-between gap-3">
                <span>
                  Failed to provision the sandbox. Check execd auth and retry.
                </span>
                <button
                  type="button"
                  onClick={handleRetryProvisioning}
                  className="shrink-0 rounded-md border border-red-300 px-2 py-1 text-xs hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900/40"
                >
                  Retry provisioning
                </button>
              </div>
            </div>
          ) : null}
          <EnvironmentSetupFlow
            teamSlugOrId={teamSlugOrId}
            selectedRepos={activeSelectedRepos}
            instanceId={activeInstanceId}
            initialEnvName={draft?.config?.envName}
            initialMaintenanceScript={draft?.config?.maintenanceScript}
            initialDevScript={draft?.config?.devScript}
            initialExposedPorts={draft?.config?.exposedPorts}
            initialEnvVars={draft?.config?.envVars}
            initialLayoutPhase={initialLayoutPhase}
            initialConfigStep={draft?.configStep}
            onEnvironmentSaved={handleResetDraft}
            onBack={handleBackToRepositorySelection}
          />
        </div>
      </FloatingPane>
    );
  }

  // For select step, show the repository picker in a floating pane
  return (
    <FloatingPane header={<TitleBar title="Environments" actions={headerActions} />}>
      <div className="flex flex-col grow select-none relative h-full overflow-hidden">
        <div className="p-6 max-w-3xl w-full mx-auto overflow-auto">
          <RepositoryPicker
            teamSlugOrId={teamSlugOrId}
            instanceId={activeInstanceId}
            initialSelectedRepos={activeSelectedRepos}
            initialSnapshotId={activeSnapshotId}
            showHeader={true}
            showContinueButton={true}
            showManualConfigOption={true}
            onStartConfigure={handleStartConfigure}
            topAccessory={
              <button
                type="button"
                onClick={handleDiscardAndExit}
                className="inline-flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to environments
              </button>
            }
          />
        </div>
      </div>
    </FloatingPane>
  );
}
