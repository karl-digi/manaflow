/**
 * Truncates an identifier to its first 12 characters.
 * Useful for displaying shortened IDs in the UI.
 *
 * @param id - The full identifier string to truncate
 * @returns The first 12 characters of the id, or the full id if shorter
 *
 * @example
 * ```ts
 * getShortId("abc123def456xyz789") // returns "abc123def456"
 * getShortId("short") // returns "short"
 * ```
 */
export function getShortId(id: string): string {
  return id.substring(0, 12);
}
