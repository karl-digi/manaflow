import type { EnvVar } from "@/components/EnvironmentConfiguration";
import { DEFAULT_MORPH_SNAPSHOT_ID, type MorphSnapshotId } from "@cmux/shared";

const STORAGE_KEY = "cmux:environment-drafts:v1";
const CHANGE_EVENT = "cmux:environment-drafts-changed";

type DraftStep = "select" | "configure";

export interface EnvironmentDraft {
  id: string;
  teamSlugOrId: string;
  step: DraftStep;
  selectedRepos: string[];
  snapshotId: MorphSnapshotId;
  instanceId?: string;
  connectionLogin?: string;
  repoSearch?: string;
  envName: string;
  maintenanceScript: string;
  devScript: string;
  exposedPorts: string;
  envVars: EnvVar[];
  vscodeUrl?: string;
  createdAt: number;
  updatedAt: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sanitizeEnvVars = (input: unknown): EnvVar[] => {
  if (!Array.isArray(input)) return [];
  const rows: EnvVar[] = [];
  for (const item of input) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === "string" ? item.name : "";
    const value = typeof item.value === "string" ? item.value : "";
    const isSecret = typeof item.isSecret === "boolean" ? item.isSecret : true;
    rows.push({ name, value, isSecret });
  }
  if (rows.length === 0) {
    return [];
  }
  return rows;
};

const sanitizeDraft = (value: unknown): EnvironmentDraft | null => {
  if (!isRecord(value)) return null;

  const id = typeof value.id === "string" ? value.id : null;
  const teamSlugOrId =
    typeof value.teamSlugOrId === "string" ? value.teamSlugOrId : null;
  const step =
    value.step === "configure" || value.step === "select"
      ? value.step
      : (null as DraftStep | null);

  if (!id || !teamSlugOrId || !step) {
    return null;
  }

  const selectedReposRaw = Array.isArray(value.selectedRepos)
    ? value.selectedRepos
    : [];
  const selectedRepos = selectedReposRaw.filter(
    (item): item is string => typeof item === "string"
  );

  const snapshotId =
    typeof value.snapshotId === "string"
      ? (value.snapshotId as MorphSnapshotId)
      : DEFAULT_MORPH_SNAPSHOT_ID;

  const instanceId = typeof value.instanceId === "string" ? value.instanceId : undefined;
  const connectionLogin =
    typeof value.connectionLogin === "string" ? value.connectionLogin : undefined;
  const repoSearch =
    typeof value.repoSearch === "string" ? value.repoSearch : undefined;
  const envName = typeof value.envName === "string" ? value.envName : "";
  const maintenanceScript =
    typeof value.maintenanceScript === "string" ? value.maintenanceScript : "";
  const devScript = typeof value.devScript === "string" ? value.devScript : "";
  const exposedPorts =
    typeof value.exposedPorts === "string" ? value.exposedPorts : "";
  const vscodeUrl =
    typeof value.vscodeUrl === "string" ? value.vscodeUrl : undefined;
  const createdAt =
    typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
      ? value.createdAt
      : Date.now();
  const updatedAt =
    typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
      ? value.updatedAt
      : createdAt;

  const envVars = sanitizeEnvVars(value.envVars);

  return {
    id,
    teamSlugOrId,
    step,
    selectedRepos,
    snapshotId,
    instanceId,
    connectionLogin,
    repoSearch,
    envName,
    maintenanceScript,
    devScript,
    exposedPorts,
    envVars,
    vscodeUrl,
    createdAt,
    updatedAt,
  };
};

const readStorage = (): EnvironmentDraft[] => {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const drafts: EnvironmentDraft[] = [];
    for (const item of parsed) {
      const draft = sanitizeDraft(item);
      if (draft) {
        drafts.push(draft);
      }
    }
    return drafts;
  } catch (_error) {
    return [];
  }
};

const notifyChange = () => {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

const writeStorage = (drafts: EnvironmentDraft[]): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const sorted = [...drafts].sort((a, b) => b.updatedAt - a.updatedAt);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
    notifyChange();
  } catch (_error) {
    void 0;
  }
};

export const getEnvironmentDrafts = (teamSlugOrId?: string): EnvironmentDraft[] => {
  const drafts = readStorage();
  if (!teamSlugOrId) {
    return drafts;
  }
  return drafts.filter((draft) => draft.teamSlugOrId === teamSlugOrId);
};

export const getEnvironmentDraft = (
  id: string
): EnvironmentDraft | undefined => {
  return readStorage().find((draft) => draft.id === id);
};

export const createEnvironmentDraft = (
  draft: Omit<EnvironmentDraft, "createdAt" | "updatedAt">
): EnvironmentDraft => {
  const now = Date.now();
  const next: EnvironmentDraft = {
    ...draft,
    createdAt: now,
    updatedAt: now,
  };
  const drafts = readStorage();
  drafts.push(next);
  writeStorage(drafts);
  return next;
};

export const updateEnvironmentDraft = (
  id: string,
  patch: Partial<Omit<EnvironmentDraft, "id" | "teamSlugOrId" | "createdAt">>
): EnvironmentDraft | undefined => {
  const drafts = readStorage();
  const index = drafts.findIndex((draft) => draft.id === id);
  if (index === -1) {
    return undefined;
  }
  const draft = drafts[index];
  const updated: EnvironmentDraft = {
    ...draft,
    ...patch,
    updatedAt: Date.now(),
  };
  drafts[index] = updated;
  writeStorage(drafts);
  return updated;
};

export const upsertEnvironmentDraft = (
  draft: EnvironmentDraft
): EnvironmentDraft => {
  const drafts = readStorage();
  const index = drafts.findIndex((item) => item.id === draft.id);
  const next = { ...draft, updatedAt: Date.now() } satisfies EnvironmentDraft;
  if (index === -1) {
    drafts.push(next);
  } else {
    drafts[index] = next;
  }
  writeStorage(drafts);
  return next;
};

export const deleteEnvironmentDraft = (id: string): void => {
  const drafts = readStorage();
  const next = drafts.filter((draft) => draft.id !== id);
  if (next.length === drafts.length) {
    return;
  }
  writeStorage(next);
};

export const subscribeToEnvironmentDrafts = (
  handler: () => void
): (() => void) => {
  if (typeof window === "undefined") {
    return () => void 0;
  }
  const listener = () => {
    handler();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
  };
};
