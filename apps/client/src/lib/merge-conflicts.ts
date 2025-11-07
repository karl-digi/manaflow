type MergeConflictSource = {
  hasConflicts?: boolean | null;
  mergeableState?: string | null;
};

const DIRTY_STATE = "dirty";

export function hasMergeConflicts(source?: MergeConflictSource | null): boolean {
  if (!source) {
    return false;
  }
  if (typeof source.hasConflicts === "boolean") {
    return source.hasConflicts;
  }
  const state = source.mergeableState?.trim().toLowerCase();
  return state === DIRTY_STATE;
}
