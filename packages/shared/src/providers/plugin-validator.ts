/**
 * Plugin Validator - Zod schemas for validating provider plugins.
 *
 * Ensures plugins conform to the expected structure before loading.
 */

import { z } from "zod";

/**
 * Schema for plugin manifest metadata.
 */
export const PluginManifestSchema = z.object({
  id: z
    .string()
    .min(1, "Plugin ID is required")
    .regex(
      /^[a-z][a-z0-9-]*$/,
      "Plugin ID must start with lowercase letter and contain only lowercase letters, numbers, and hyphens"
    ),
  name: z.string().min(1, "Plugin name is required"),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "Version must be in semver format (e.g., 1.0.0)"),
  description: z.string().optional(),
  type: z.enum(["builtin", "community", "team"]),
});

/**
 * Schema for API key configuration.
 */
export const AgentConfigApiKeySchema = z.object({
  envVar: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  mapToEnvVar: z.string().optional(),
});

/**
 * Schema for API format types.
 */
export const ApiFormatSchema = z.enum([
  "anthropic",
  "openai",
  "bedrock",
  "vertex",
  "passthrough",
]);

/**
 * Schema for provider specification.
 */
export const PluginProviderSpecSchema = z.object({
  defaultBaseUrl: z.string().url("Default base URL must be a valid URL"),
  apiFormat: ApiFormatSchema,
  authEnvVars: z.array(z.string().min(1)).min(1, "At least one auth env var required"),
  apiKeys: z.array(AgentConfigApiKeySchema),
  baseUrlKey: AgentConfigApiKeySchema.optional(),
});

/**
 * Schema for agent configuration.
 * Note: Functions are not validated by Zod, only structural fields.
 *
 * Agent name pattern supports:
 * - provider/model (e.g., claude/opus-4.6)
 * - provider only (e.g., amp)
 * - provider/model:variant (e.g., qwen/qwen3-coder:free)
 */
export const AgentConfigSchema = z.object({
  name: z
    .string()
    .regex(
      /^[a-z][a-z0-9-]*(\/[a-z0-9.:_-]+)?$/,
      "Agent name must be in format 'provider', 'provider/model', or 'provider/model:variant'"
    ),
  command: z.string().min(1, "Command is required"),
  args: z.array(z.string()),
  // Function fields are validated at runtime
  apiKeys: z.array(AgentConfigApiKeySchema).optional(),
  waitForString: z.string().optional(),
  enterKeySequence: z.string().optional(),
  disabled: z.boolean().optional(),
  disabledReason: z.string().optional(),
});

/**
 * Schema for agent vendor type.
 */
export const AgentVendorSchema = z.enum([
  "anthropic",
  "openai",
  "google",
  "opencode",
  "qwen",
  "cursor",
  "amp",
  "xai",
  "openrouter",
]);

/**
 * Schema for model tier.
 */
export const ModelTierSchema = z.enum(["free", "paid"]);

/**
 * Schema for agent catalog entry.
 */
export const AgentCatalogEntrySchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*(\/[a-z0-9.:_-]+)?$/),
  displayName: z.string().min(1),
  vendor: AgentVendorSchema,
  requiredApiKeys: z.array(z.string()),
  tier: ModelTierSchema,
  disabled: z.boolean().optional(),
  disabledReason: z.string().optional(),
  tags: z.array(z.string()).optional(),
  variants: z
    .array(
      z.object({
        id: z.string(),
        displayName: z.string(),
        description: z.string().optional(),
      })
    )
    .optional(),
  defaultVariant: z.string().optional(),
});

/**
 * Schema for the complete provider plugin.
 */
export const ProviderPluginSchema = z.object({
  manifest: PluginManifestSchema,
  provider: PluginProviderSpecSchema,
  configs: z.array(AgentConfigSchema).min(1, "At least one agent config required"),
  catalog: z.array(AgentCatalogEntrySchema).min(1, "At least one catalog entry required"),
  lifecycle: z
    .object({
      initialize: z.function().optional(),
      healthCheck: z.function().optional(),
      shutdown: z.function().optional(),
    })
    .optional(),
});

/**
 * Validation options.
 */
export interface PluginValidationOptions {
  /**
   * When true, all configs must have matching catalog entries.
   * When false (default), this is a soft check that produces warnings.
   * OpenCode dynamically discovers paid models at runtime, so strict mode
   * would fail for builtin plugins with dynamic model discovery.
   */
  strictCatalogMatch?: boolean;
}

/**
 * Validation result with errors and warnings.
 */
export interface PluginValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a provider plugin.
 *
 * @param plugin - The plugin to validate
 * @param options - Validation options
 * @returns Validation result with errors and warnings
 */
export function validatePlugin(
  plugin: unknown,
  options: PluginValidationOptions = {}
): PluginValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { strictCatalogMatch = false } = options;

  // Basic structure validation
  const structureResult = ProviderPluginSchema.safeParse(plugin);
  if (!structureResult.success) {
    for (const issue of structureResult.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }

  const validPlugin = structureResult.data;

  // Cross-validation: every config should have a matching catalog entry
  // For plugins with dynamic model discovery (like OpenCode), this is a warning
  const catalogNames = new Set(validPlugin.catalog.map((e) => e.name));
  for (const config of validPlugin.configs) {
    if (!catalogNames.has(config.name)) {
      const message = `Config '${config.name}' has no matching catalog entry`;
      if (strictCatalogMatch) {
        errors.push(message);
      } else {
        warnings.push(message);
      }
    }
  }

  // Cross-validation: every catalog entry should have a matching config
  const configNames = new Set(validPlugin.configs.map((c) => c.name));
  for (const entry of validPlugin.catalog) {
    if (!configNames.has(entry.name)) {
      errors.push(`Catalog entry '${entry.name}' has no matching config`);
    }
  }

  // Verify agent names use known prefixes (soft check - warnings only)
  const knownPrefixes = ["claude", "codex", "gemini", "opencode", "amp", "cursor", "qwen"];
  for (const config of validPlugin.configs) {
    const prefix = config.name.split("/")[0];
    if (prefix && !knownPrefixes.includes(prefix)) {
      warnings.push(`Config '${config.name}' has non-standard prefix '${prefix}'`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Assert that a plugin is valid, throwing if not.
 *
 * @param plugin - The plugin to validate
 * @param options - Validation options
 * @throws Error if validation fails
 */
export function assertValidPlugin(
  plugin: unknown,
  options?: PluginValidationOptions
): asserts plugin is z.infer<typeof ProviderPluginSchema> {
  const result = validatePlugin(plugin, options);
  if (!result.valid) {
    throw new Error(`Invalid plugin:\n${result.errors.join("\n")}`);
  }
}
