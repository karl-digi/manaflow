import { homedir } from "node:os";
import { resolve, isAbsolute, normalize } from "node:path";

/**
 * Parses a local repository path and normalizes it.
 * Supports ~ expansion to HOME directory.
 *
 * @param input - The local repository path
 * @returns Parsed and normalized path or null if invalid
 */
export function parseLocalRepoPath(input: string): {
  path: string;
  isAbsolute: boolean;
} | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  // Expand ~ to home directory
  let expanded = trimmed;
  if (trimmed.startsWith("~/")) {
    expanded = resolve(homedir(), trimmed.slice(2));
  } else if (trimmed === "~") {
    expanded = homedir();
  }

  // Normalize the path (removes extra slashes, resolves . and ..)
  const normalized = normalize(expanded);

  return {
    path: normalized,
    isAbsolute: isAbsolute(normalized),
  };
}

/**
 * Checks if a string looks like a local file path (not a GitHub URL).
 * This is a heuristic check to distinguish between GitHub URLs and local paths.
 *
 * @param input - The input string to check
 * @returns true if the input looks like a local path
 */
export function isLocalPath(input: string): boolean {
  if (!input) {
    return false;
  }

  const trimmed = input.trim();

  // GitHub URL patterns
  const githubPatterns = [
    /^https?:\/\/github\.com/i,
    /^git@github\.com:/i,
    /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/,  // owner/repo format
  ];

  // If it matches any GitHub pattern, it's not a local path
  if (githubPatterns.some(pattern => pattern.test(trimmed))) {
    return false;
  }

  // Local path indicators
  const localPathIndicators = [
    trimmed.startsWith("/"),           // Absolute Unix path
    trimmed.startsWith("~/"),          // Home directory path
    trimmed === "~",                   // Home directory
    trimmed.startsWith("./"),          // Relative path
    trimmed.startsWith("../"),         // Parent directory
    /^[a-zA-Z]:[/\\]/.test(trimmed),  // Windows absolute path (C:\ or C:/)
  ];

  return localPathIndicators.some(indicator => indicator);
}
