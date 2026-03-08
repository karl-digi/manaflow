/**
 * Utilities for formatting environment variables into .env file format.
 */

/** A single environment variable entry */
export type EnvVarEntry = {
  /** The environment variable name (e.g., "API_KEY") */
  name: string;
  /** The environment variable value */
  value: string;
};

/**
 * Escapes double quotes in a string for .env file format.
 */
function escapeDoubleQuotes(value: string): string {
  return value.replaceAll("\"", "\\\"");
}

/**
 * Normalizes line endings to Unix format (LF).
 */
function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

/**
 * Formats an array of environment variable entries into .env file content.
 * Values are quoted and escaped to handle special characters safely.
 *
 * @param entries - Array of environment variable name/value pairs
 * @returns Formatted string suitable for writing to a .env file
 *
 * @example
 * ```ts
 * formatEnvVarsContent([
 *   { name: "API_KEY", value: "secret123" },
 *   { name: "MESSAGE", value: "Hello \"World\"" }
 * ])
 * // Returns:
 * // API_KEY="secret123"
 * // MESSAGE="Hello \"World\""
 * ```
 */
export function formatEnvVarsContent(entries: EnvVarEntry[]): string {
  const lines: string[] = [];

  for (const entry of entries) {
    const key = entry.name.trim();
    if (key.length === 0) {
      continue;
    }

    const rawValue = entry.value ?? "";
    const normalizedValue = normalizeLineEndings(rawValue);
    const escapedValue = escapeDoubleQuotes(normalizedValue);
    lines.push(`${key}="${escapedValue}"`);
  }

  return lines.join("\n");
}
