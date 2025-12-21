/**
 * Environment types - re-exported from shared for backwards compatibility.
 *
 * New code should import directly from @cmux/shared/environment-config
 */

export {
  type EnvVar,
  type EnvironmentConfigDraft,
  type EnvironmentDraftMetadata,
  ensureInitialEnvVars,
  createEmptyEnvironmentConfig,
} from "@cmux/shared/environment-config";
