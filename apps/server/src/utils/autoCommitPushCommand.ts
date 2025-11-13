import autoCommitPushCommandScript from "./autoCommitPushCommandScript.ts?raw";

/**
 * Build a bun script to stage, commit, pull --rebase (if remote exists), and push.
 */
export function buildAutoCommitPushCommand(): string {
  return autoCommitPushCommandScript;
}
