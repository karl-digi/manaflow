import { captureServerAnalytics } from "@/lib/analytics/posthog";

type SandboxStartedEvent = {
  userId: string | null;
  teamId: string;
  teamSlug: string | null;
  teamSlugOrId: string;
  environmentId?: string | null;
  instanceId: string;
  snapshotId: string;
  provider: "morph";
  ttlSeconds?: number;
  metadata?: Record<string, unknown> | null;
  repoUrl?: string | null;
  branch?: string | null;
  newBranch?: string | null;
  taskRunId?: string | null;
  devScriptConfigured: boolean;
  maintenanceScriptConfigured: boolean;
};

type EnvironmentCreatedEvent = {
  userId: string | null;
  teamId: string;
  teamSlug: string | null;
  teamSlugOrId: string;
  environmentId: string;
  morphSnapshotId: string;
  selectedRepoCount: number;
  descriptionProvided: boolean;
  exposedPortsCount: number;
  maintenanceScriptConfigured: boolean;
  devScriptConfigured: boolean;
};

type ModelUsageEvent = {
  userId: string | null;
  teamId?: string;
  teamSlug?: string | null;
  teamSlugOrId?: string;
  providerName: string | null;
  modelName?: string | null;
  feature: "branch_generation" | "code_review" | "unknown";
  usedFallback: boolean;
  requestedCount?: number;
};

function resolveDistinctId(userId: string | null, teamId: string): string {
  return userId ?? `team:${teamId}`;
}

export function trackSandboxStarted(payload: SandboxStartedEvent): void {
  captureServerAnalytics({
    event: "sandbox_started",
    distinctId: resolveDistinctId(payload.userId, payload.teamId),
    groups: { team: payload.teamId },
    properties: {
      provider: payload.provider,
      teamId: payload.teamId,
      teamSlug: payload.teamSlug,
      teamSlugOrId: payload.teamSlugOrId,
      environmentId: payload.environmentId ?? null,
      instanceId: payload.instanceId,
      snapshotId: payload.snapshotId,
      ttlSeconds: payload.ttlSeconds ?? null,
      metadataKeys: payload.metadata ? Object.keys(payload.metadata) : [],
      repoUrl: payload.repoUrl ?? null,
      branch: payload.branch ?? null,
      newBranch: payload.newBranch ?? null,
      taskRunId: payload.taskRunId ?? null,
      devScriptConfigured: payload.devScriptConfigured,
      maintenanceScriptConfigured: payload.maintenanceScriptConfigured,
    },
  });
}

export function trackEnvironmentCreated(
  payload: EnvironmentCreatedEvent,
): void {
  captureServerAnalytics({
    event: "environment_created",
    distinctId: resolveDistinctId(payload.userId, payload.teamId),
    groups: { team: payload.teamId },
    properties: {
      teamId: payload.teamId,
      teamSlug: payload.teamSlug,
      teamSlugOrId: payload.teamSlugOrId,
      environmentId: payload.environmentId,
      morphSnapshotId: payload.morphSnapshotId,
      selectedRepoCount: payload.selectedRepoCount,
      descriptionProvided: payload.descriptionProvided,
      exposedPortsCount: payload.exposedPortsCount,
      maintenanceScriptConfigured: payload.maintenanceScriptConfigured,
      devScriptConfigured: payload.devScriptConfigured,
    },
  });
}

export function trackModelUsage(payload: ModelUsageEvent): void {
  const distinctSource =
    payload.teamId && payload.userId
      ? payload.userId
      : payload.userId ?? (payload.teamId ? `team:${payload.teamId}` : "anonymous");

  captureServerAnalytics({
    event: "ai_model_usage",
    distinctId: distinctSource,
    groups: payload.teamId ? { team: payload.teamId } : undefined,
    properties: {
      teamId: payload.teamId ?? null,
      teamSlug: payload.teamSlug ?? null,
      teamSlugOrId: payload.teamSlugOrId ?? null,
      providerName: payload.providerName,
      modelName: payload.modelName ?? null,
      feature: payload.feature,
      usedFallback: payload.usedFallback,
      requestedCount: payload.requestedCount ?? null,
    },
  });
}
