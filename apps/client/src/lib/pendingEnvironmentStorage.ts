import type { EnvVar } from "@/components/EnvironmentConfiguration";
import type { MorphSnapshotId } from "@cmux/shared";

const STORAGE_KEY = "cmux:pending-environments";

export type PendingEnvironmentStage = "select" | "configure";

export interface PendingEnvironmentDraft {
  id: string;
  teamSlugOrId: string;
  stage: PendingEnvironmentStage;
  selectedRepos: string[];
  snapshotId: MorphSnapshotId | null;
  instanceId?: string;
  envName?: string;
  maintenanceScript?: string;
  devScript?: string;
  exposedPorts?: string;
  envVars?: EnvVar[];
  connectionLogin?: string | null;
  repoSearch?: string | null;
  updatedAt: number;
}

interface PendingEnvironmentDraftMap {
  [id: string]: PendingEnvironmentDraft;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStorage(): PendingEnvironmentDraftMap {
  if (typeof window === "undefined") {
    return {};
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed)) {
      return {};
    }
    const result: PendingEnvironmentDraftMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!isObject(value)) {
        continue;
      }
      const stage = value.stage;
      if (stage !== "select" && stage !== "configure") {
        continue;
      }
      const teamSlugOrId = typeof value.teamSlugOrId === "string"
        ? value.teamSlugOrId
        : null;
      if (!teamSlugOrId) {
        continue;
      }
      const selectedRepos = Array.isArray(value.selectedRepos)
        ? value.selectedRepos.filter((item): item is string => typeof item === "string")
        : [];
      const snapshotId = typeof value.snapshotId === "string" ? value.snapshotId : null;
      const instanceId = typeof value.instanceId === "string" ? value.instanceId : undefined;
      const envName = typeof value.envName === "string" ? value.envName : undefined;
      const maintenanceScript = typeof value.maintenanceScript === "string"
        ? value.maintenanceScript
        : undefined;
      const devScript = typeof value.devScript === "string" ? value.devScript : undefined;
      const exposedPorts = typeof value.exposedPorts === "string"
        ? value.exposedPorts
        : undefined;
      const maybeEnvVars = Array.isArray(value.envVars) ? value.envVars : undefined;
      const envVars = Array.isArray(maybeEnvVars)
        ? maybeEnvVars.filter((entry): entry is EnvVar => {
            if (!isObject(entry)) {
              return false;
            }
            const nameValid = typeof entry.name === "string";
            const valueValid = typeof entry.value === "string";
            const isSecretValid = typeof entry.isSecret === "boolean";
            return nameValid && valueValid && isSecretValid;
          })
        : undefined;
      const connectionLogin = typeof value.connectionLogin === "string"
        ? value.connectionLogin
        : null;
      const repoSearch = typeof value.repoSearch === "string" ? value.repoSearch : null;
      const updatedAt = typeof value.updatedAt === "number" ? value.updatedAt : Date.now();
      result[key] = {
        id: key,
        teamSlugOrId,
        stage,
        selectedRepos,
        snapshotId,
        instanceId,
        envName,
        maintenanceScript,
        devScript,
        exposedPorts,
        envVars,
        connectionLogin,
        repoSearch,
        updatedAt,
      };
    }
    return result;
  } catch (error) {
    console.error("Failed to parse pending environment storage", error);
    return {};
  }
}

function writeStorage(data: PendingEnvironmentDraftMap): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function makeSelectionDraftId(teamSlugOrId: string): string {
  return `selection:${teamSlugOrId}`;
}

function makeInstanceDraftId(instanceId: string): string {
  return `instance:${instanceId}`;
}

function upsertDraft(draft: PendingEnvironmentDraft): void {
  const existing = readStorage();
  existing[draft.id] = draft;
  writeStorage(existing);
}

export function saveSelectionDraft(input: {
  teamSlugOrId: string;
  selectedRepos: string[];
  snapshotId: MorphSnapshotId | null;
  connectionLogin?: string | null;
  repoSearch?: string | null;
}): void {
  const selectionId = makeSelectionDraftId(input.teamSlugOrId);
  const draft: PendingEnvironmentDraft = {
    id: selectionId,
    teamSlugOrId: input.teamSlugOrId,
    stage: "select",
    selectedRepos: [...input.selectedRepos],
    snapshotId: input.snapshotId ?? null,
    instanceId: undefined,
    envName: undefined,
    maintenanceScript: undefined,
    devScript: undefined,
    exposedPorts: undefined,
    envVars: undefined,
    connectionLogin: input.connectionLogin ?? null,
    repoSearch: input.repoSearch ?? null,
    updatedAt: Date.now(),
  };
  upsertDraft(draft);
}

export function saveConfigurationDraft(input: {
  teamSlugOrId: string;
  instanceId: string;
  selectedRepos: string[];
  snapshotId: MorphSnapshotId | null;
  envName: string;
  maintenanceScript: string;
  devScript: string;
  exposedPorts: string;
  envVars: EnvVar[];
  connectionLogin?: string | null;
  repoSearch?: string | null;
}): void {
  const instanceDraftId = makeInstanceDraftId(input.instanceId);
  const draft: PendingEnvironmentDraft = {
    id: instanceDraftId,
    teamSlugOrId: input.teamSlugOrId,
    stage: "configure",
    selectedRepos: [...input.selectedRepos],
    snapshotId: input.snapshotId ?? null,
    instanceId: input.instanceId,
    envName: input.envName,
    maintenanceScript: input.maintenanceScript,
    devScript: input.devScript,
    exposedPorts: input.exposedPorts,
    envVars: input.envVars.map((item) => ({ ...item })),
    connectionLogin: input.connectionLogin ?? null,
    repoSearch: input.repoSearch ?? null,
    updatedAt: Date.now(),
  };
  const existing = readStorage();
  existing[instanceDraftId] = draft;
  const selectionId = makeSelectionDraftId(input.teamSlugOrId);
  if (selectionId in existing) {
    delete existing[selectionId];
  }
  writeStorage(existing);
}

export function removeSelectionDraft(teamSlugOrId: string): void {
  const selectionId = makeSelectionDraftId(teamSlugOrId);
  const existing = readStorage();
  if (selectionId in existing) {
    delete existing[selectionId];
    writeStorage(existing);
  }
}

export function removeDraftByInstance(instanceId: string): void {
  const draftId = makeInstanceDraftId(instanceId);
  const existing = readStorage();
  if (draftId in existing) {
    delete existing[draftId];
    writeStorage(existing);
  }
}

export function removeDraftById(id: string): void {
  const existing = readStorage();
  if (id in existing) {
    delete existing[id];
    writeStorage(existing);
  }
}

export function listPendingDrafts(teamSlugOrId: string): PendingEnvironmentDraft[] {
  const existing = readStorage();
  return Object.values(existing)
    .filter((draft) => draft.teamSlugOrId === teamSlugOrId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getDraftByInstance(instanceId: string): PendingEnvironmentDraft | undefined {
  const existing = readStorage();
  const draftId = makeInstanceDraftId(instanceId);
  return existing[draftId];
}

export function getSelectionDraft(teamSlugOrId: string): PendingEnvironmentDraft | undefined {
  const existing = readStorage();
  const selectionId = makeSelectionDraftId(teamSlugOrId);
  return existing[selectionId];
}
