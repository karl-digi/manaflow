import type { MorphSnapshotId } from "@cmux/shared";
import type { EnvironmentVariable } from "@/types/environments";

export type EnvironmentDraftState = {
  step?: "select" | "configure";
  selectedRepos?: string[];
  instanceId?: string;
  snapshotId?: MorphSnapshotId;
  envName?: string;
  envVars?: EnvironmentVariable[];
  maintenanceScript?: string;
  devScript?: string;
  exposedPorts?: string;
};

type DraftUpdater =
  | Partial<EnvironmentDraftState>
  | ((prev: EnvironmentDraftState) => EnvironmentDraftState);

const environmentDrafts = new Map<string, EnvironmentDraftState>();

function cloneEnvVars(
  vars?: EnvironmentVariable[],
): EnvironmentVariable[] | undefined {
  if (!vars) {
    return undefined;
  }
  return vars.map((variable) => ({ ...variable }));
}

function cloneDraft(
  draft?: EnvironmentDraftState,
): EnvironmentDraftState | undefined {
  if (!draft) {
    return undefined;
  }
  return {
    ...draft,
    selectedRepos: draft.selectedRepos ? [...draft.selectedRepos] : undefined,
    envVars: cloneEnvVars(draft.envVars),
  };
}

function mergeDraft(
  prev: EnvironmentDraftState,
  patch: Partial<EnvironmentDraftState>,
): EnvironmentDraftState {
  const next: EnvironmentDraftState = { ...prev };
  const has = <K extends keyof EnvironmentDraftState>(key: K): boolean =>
    Object.prototype.hasOwnProperty.call(patch, key);

  if (has("step")) {
    if (patch.step === undefined) {
      delete next.step;
    } else {
      next.step = patch.step;
    }
  }

  if (has("selectedRepos")) {
    const repos = patch.selectedRepos;
    if (!repos) {
      delete next.selectedRepos;
    } else {
      next.selectedRepos = [...repos];
    }
  }

  if (has("instanceId")) {
    if (patch.instanceId === undefined) {
      delete next.instanceId;
    } else {
      next.instanceId = patch.instanceId;
    }
  }

  if (has("snapshotId")) {
    if (patch.snapshotId === undefined) {
      delete next.snapshotId;
    } else {
      next.snapshotId = patch.snapshotId;
    }
  }

  if (has("envName")) {
    if (patch.envName === undefined) {
      delete next.envName;
    } else {
      next.envName = patch.envName;
    }
  }

  if (has("envVars")) {
    const vars = patch.envVars;
    if (!vars) {
      delete next.envVars;
    } else {
      next.envVars = cloneEnvVars(vars);
    }
  }

  if (has("maintenanceScript")) {
    if (patch.maintenanceScript === undefined) {
      delete next.maintenanceScript;
    } else {
      next.maintenanceScript = patch.maintenanceScript;
    }
  }

  if (has("devScript")) {
    if (patch.devScript === undefined) {
      delete next.devScript;
    } else {
      next.devScript = patch.devScript;
    }
  }

  if (has("exposedPorts")) {
    if (patch.exposedPorts === undefined) {
      delete next.exposedPorts;
    } else {
      next.exposedPorts = patch.exposedPorts;
    }
  }

  return next;
}

export function getEnvironmentDraft(
  key: string,
): EnvironmentDraftState | undefined {
  return cloneDraft(environmentDrafts.get(key));
}

export function updateEnvironmentDraft(
  key: string,
  updater: DraftUpdater,
): EnvironmentDraftState {
  const current = environmentDrafts.get(key) ?? {};
  const patch =
    typeof updater === "function" ? updater(cloneDraft(current) ?? {}) : updater;
  const nextDraft = mergeDraft(current, patch);
  environmentDrafts.set(key, nextDraft);
  return cloneDraft(nextDraft) ?? {};
}

export function resetEnvironmentDraft(key: string): void {
  environmentDrafts.delete(key);
}

export function makeEnvironmentDraftKey({
  teamSlugOrId,
  mode = "new",
  sourceEnvironmentId,
}: {
  teamSlugOrId: string;
  mode?: "new" | "snapshot";
  sourceEnvironmentId?: string;
}): string {
  if (mode === "snapshot" && sourceEnvironmentId) {
    return `environment-draft:${teamSlugOrId}:snapshot:${sourceEnvironmentId}`;
  }
  return `environment-draft:${teamSlugOrId}:${mode}`;
}
