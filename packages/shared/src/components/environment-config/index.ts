/**
 * Environment configuration components - shared between client and www apps.
 *
 * These components provide the UI for configuring environments with:
 * - Framework preset selection (auto-fills scripts)
 * - Maintenance and dev scripts
 * - Environment variables with show/hide, paste support
 *
 * The components support both single-repo mode (preview.new) where
 * workspace root === repo root, and multi-repo mode where workspace
 * root is one level above repo roots.
 */

export * from "./framework-logos";
export * from "./framework-preset-select";
export * from "./scripts-section";
export * from "./env-vars-section";
