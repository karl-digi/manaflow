import { useSyncExternalStore } from "react";
import type { MorphSnapshotId } from "@cmux/shared";
import type { EnvVar } from "@/components/EnvironmentConfiguration";

export type PendingEnvironmentStep = "select" | "configure";

export interface PendingEnvironmentState {
  id: string;
  teamSlugOrId: string;
  step: PendingEnvironmentStep;
  selectedRepos: string[];
  snapshotId?: MorphSnapshotId;
  instanceId?: string;
  vscodeUrl?: string;
  connectionLogin?: string;
  repoSearch?: string;
  envName?: string;
  maintenanceScript?: string;
  devScript?: string;
  exposedPorts?: string;
  envVars?: EnvVar[];
  updatedAt: number;
}

export type PendingEnvironmentUpdate = {
  step?: PendingEnvironmentStep;
  selectedRepos?: string[];
  snapshotId?: MorphSnapshotId;
  instanceId?: string;
  vscodeUrl?: string;
  connectionLogin?: string | null;
  repoSearch?: string | null;
  envName?: string;
  maintenanceScript?: string;
  devScript?: string;
  exposedPorts?: string;
  envVars?: EnvVar[];
};

const pendingByTeam = new Map<string, PendingEnvironmentState>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const emit = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

const getSnapshotForTeam = (
  teamSlugOrId: string
): PendingEnvironmentState | null => {
  const entry = pendingByTeam.get(teamSlugOrId);
  return entry ?? null;
};

const cloneEnvVars = (envVars: EnvVar[] | undefined): EnvVar[] | undefined => {
  if (!envVars) {
    return undefined;
  }
  return envVars.map((item) => ({ ...item }));
};

const resolveDraftId = (
  teamSlugOrId: string,
  prev: PendingEnvironmentState | undefined,
  update: PendingEnvironmentUpdate
): string => {
  if (update.instanceId) {
    return update.instanceId;
  }
  if (prev?.instanceId) {
    return prev.instanceId;
  }
  if (prev) {
    return prev.id;
  }
  return `draft-${teamSlugOrId}`;
};

export const getPendingEnvironmentSnapshot = (
  teamSlugOrId: string
): PendingEnvironmentState | null => getSnapshotForTeam(teamSlugOrId);

export const usePendingEnvironment = (
  teamSlugOrId: string
): PendingEnvironmentState | null => {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshotForTeam(teamSlugOrId),
    () => null
  );
};

export const updatePendingEnvironment = (
  teamSlugOrId: string,
  update: PendingEnvironmentUpdate
): PendingEnvironmentState => {
  const previous = pendingByTeam.get(teamSlugOrId);
  const next: PendingEnvironmentState = {
    id: resolveDraftId(teamSlugOrId, previous, update),
    teamSlugOrId,
    step: update.step ?? previous?.step ?? "select",
    selectedRepos: update.selectedRepos
      ? [...update.selectedRepos]
      : previous
        ? [...previous.selectedRepos]
        : [],
    snapshotId: update.snapshotId ?? previous?.snapshotId,
    instanceId: update.instanceId ?? previous?.instanceId,
    vscodeUrl: update.vscodeUrl ?? previous?.vscodeUrl,
    connectionLogin:
      update.connectionLogin !== undefined
        ? update.connectionLogin ?? undefined
        : previous?.connectionLogin,
    repoSearch:
      update.repoSearch !== undefined
        ? update.repoSearch ?? undefined
        : previous?.repoSearch,
    envName: update.envName ?? previous?.envName,
    maintenanceScript:
      update.maintenanceScript ?? previous?.maintenanceScript,
    devScript: update.devScript ?? previous?.devScript,
    exposedPorts: update.exposedPorts ?? previous?.exposedPorts,
    envVars:
      update.envVars !== undefined
        ? cloneEnvVars(update.envVars)
        : previous?.envVars
          ? cloneEnvVars(previous.envVars)
          : undefined,
    updatedAt: Date.now(),
  };

  pendingByTeam.set(teamSlugOrId, next);
  emit();
  return next;
};

export const clearPendingEnvironment = (teamSlugOrId: string): void => {
  if (pendingByTeam.delete(teamSlugOrId)) {
    emit();
  }
};
