import { DEFAULT_MORPH_SNAPSHOT_ID, type MorphSnapshotId } from "@cmux/shared";
import { useSyncExternalStore } from "react";
import type { EnvVar } from "@/components/EnvironmentConfiguration";

export type PendingEnvironmentStep = "select" | "configure";

export interface PendingEnvironmentDraft {
  step?: PendingEnvironmentStep;
  selectedRepos?: string[];
  snapshotId?: MorphSnapshotId;
  connectionLogin?: string | null;
  repoSearch?: string | null;
  instanceId?: string;
  envName?: string | null;
  maintenanceScript?: string | null;
  devScript?: string | null;
  envVars?: EnvVar[] | null;
  exposedPorts?: string | null;
}

export interface PendingEnvironment
  extends PendingEnvironmentDraft {
  teamSlugOrId: string;
  step: PendingEnvironmentStep;
  selectedRepos: string[];
  snapshotId?: MorphSnapshotId;
  updatedAt: number;
}

const STORAGE_KEY = "cmux:pending-environments";

type PendingEnvironmentMap = Record<string, PendingEnvironment>;

type Listener = () => void;

const listeners = new Set<Listener>();

let state: PendingEnvironmentMap = readFromStorage();

function readFromStorage(): PendingEnvironmentMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const map = parsed as Record<string, PendingEnvironment>;
    const entries = Object.entries(map)
      .filter(([, value]) =>
        value &&
        typeof value === "object" &&
        typeof value.teamSlugOrId === "string"
      )
      .map(([key, value]) => {
        const step: PendingEnvironmentStep =
          value.step === "configure" ? "configure" : "select";
        const selectedRepos = Array.isArray(value.selectedRepos)
          ? value.selectedRepos.filter((item): item is string =>
              typeof item === "string"
            )
          : [];
        const snapshotId =
          typeof value.snapshotId === "string"
            ? (value.snapshotId as MorphSnapshotId)
            : DEFAULT_MORPH_SNAPSHOT_ID;
        return [
          key,
          {
            ...value,
            teamSlugOrId: value.teamSlugOrId,
            step,
            selectedRepos,
            snapshotId,
            updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
          } satisfies PendingEnvironment,
        ];
      });
    return Object.fromEntries(entries);
  } catch (error) {
    console.warn("Failed to parse pending environments from storage", error);
    return {};
  }
}

function persistState(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Failed to persist pending environments", error);
  }
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) {
      return;
    }
    state = readFromStorage();
    emit();
  });
}

export function updatePendingEnvironment(
  teamSlugOrId: string,
  patch: PendingEnvironmentDraft
): PendingEnvironment {
  const prev = state[teamSlugOrId];
  const selectedRepos =
    patch.selectedRepos ?? prev?.selectedRepos ?? [];
  const sanitizedRepos = Array.from(new Set(selectedRepos));
  const next: PendingEnvironment = {
    teamSlugOrId,
    step: patch.step ?? prev?.step ?? "select",
    selectedRepos: sanitizedRepos,
    snapshotId:
      patch.snapshotId ?? prev?.snapshotId ?? DEFAULT_MORPH_SNAPSHOT_ID,
    connectionLogin:
      patch.connectionLogin === undefined
        ? prev?.connectionLogin ?? null
        : patch.connectionLogin,
    repoSearch:
      patch.repoSearch === undefined
        ? prev?.repoSearch ?? null
        : patch.repoSearch,
    instanceId: patch.instanceId ?? prev?.instanceId,
    envName:
      patch.envName === undefined ? prev?.envName : patch.envName ?? "",
    maintenanceScript:
      patch.maintenanceScript === undefined
        ? prev?.maintenanceScript
        : patch.maintenanceScript ?? "",
    devScript:
      patch.devScript === undefined
        ? prev?.devScript
        : patch.devScript ?? "",
    envVars:
      patch.envVars === undefined
        ? prev?.envVars
        : patch.envVars ?? [],
    exposedPorts:
      patch.exposedPorts === undefined
        ? prev?.exposedPorts
        : patch.exposedPorts ?? "",
    updatedAt: Date.now(),
  };

  state = { ...state, [teamSlugOrId]: next };
  persistState();
  emit();
  return next;
}

export function clearPendingEnvironment(teamSlugOrId: string): void {
  if (!state[teamSlugOrId]) {
    return;
  }
  const { [teamSlugOrId]: _removed, ...rest } = state;
  state = rest;
  persistState();
  emit();
}

export function getPendingEnvironment(
  teamSlugOrId: string
): PendingEnvironment | undefined {
  return state[teamSlugOrId];
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePendingEnvironment(
  teamSlugOrId: string
): PendingEnvironment | undefined {
  return useSyncExternalStore(
    subscribe,
    () => state[teamSlugOrId],
    () => undefined
  );
}

export function listPendingEnvironments(): PendingEnvironment[] {
  return Object.values(state).sort((a, b) => b.updatedAt - a.updatedAt);
}
