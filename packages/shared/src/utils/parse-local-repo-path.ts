import { homedir } from "node:os";
import { resolve, isAbsolute, normalize } from "node:path";

/**
 * Parses and validates a local repository path.
 * Supports tilde (~) expansion to HOME directory.
 *
 * @param input - The local file path (can start with ~, /, or ./)
 * @returns Parsed path information or null if invalid format
 */
export function parseLocalRepoPath(input: string): {
  originalPath: string;
  resolvedPath: string;
  isLocal: true;
} | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();

  // Check if it looks like a local path
  // Must start with /, ./, ../, or ~
  if (
    !trimmed.startsWith("/") &&
    !trimmed.startsWith("./") &&
    !trimmed.startsWith("../") &&
    !trimmed.startsWith("~")
  ) {
    return null;
  }

  // Expand tilde to HOME directory
  let expandedPath = trimmed;
  if (trimmed.startsWith("~")) {
    const home = homedir();
    expandedPath = trimmed.replace(/^~/, home);
  }

  // Normalize and resolve the path
  const resolvedPath = isAbsolute(expandedPath)
    ? normalize(expandedPath)
    : resolve(process.cwd(), expandedPath);

  return {
    originalPath: trimmed,
    resolvedPath,
    isLocal: true,
  };
}

/**
 * Detects whether a string is a local path or a GitHub URL
 */
export function isLocalPath(input: string): boolean {
  if (!input) {
    return false;
  }

  const trimmed = input.trim();
  return (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("~")
  );
}
