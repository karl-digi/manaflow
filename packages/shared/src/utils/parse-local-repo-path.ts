import { homedir } from "node:os";
import { resolve, isAbsolute } from "node:path";

/**
 * Parses a local repository path and resolves it to an absolute path.
 * Supports:
 * - Absolute paths: /path/to/repo
 * - Relative paths: ./repo or ../repo
 * - Home directory: ~/repo or ~username/repo
 *
 * @param input - The local path string
 * @returns Resolved absolute path or null if invalid
 */
export function parseLocalRepoPath(input: string): {
  absolutePath: string;
  originalInput: string;
} | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();

  // Check if it looks like a file path (not a URL)
  // File paths typically start with /, ./, ../, or ~
  const isFilePath =
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('~');

  if (!isFilePath) {
    return null;
  }

  try {
    let resolvedPath: string;

    if (trimmed.startsWith('~')) {
      // Handle tilde expansion
      if (trimmed === '~' || trimmed.startsWith('~/')) {
        // Current user's home directory
        resolvedPath = trimmed.replace(/^~/, homedir());
      } else {
        // Another user's home directory (e.g., ~username/path)
        // On Unix systems, we can't easily resolve other users' home dirs without
        // shelling out, so we'll just return null for now
        // This could be enhanced later if needed
        return null;
      }
    } else if (isAbsolute(trimmed)) {
      resolvedPath = trimmed;
    } else {
      // Relative path - resolve from current working directory
      resolvedPath = resolve(process.cwd(), trimmed);
    }

    return {
      absolutePath: resolvedPath,
      originalInput: trimmed,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Client-safe version that doesn't use Node.js APIs
 * Only handles basic tilde expansion using environment variable
 */
export function parseLocalRepoPathClient(input: string, homeDir?: string): {
  absolutePath: string;
  originalInput: string;
} | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();

  const isFilePath =
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('~');

  if (!isFilePath) {
    return null;
  }

  try {
    let resolvedPath: string;

    if (trimmed.startsWith('~')) {
      if (!homeDir) {
        // Can't resolve without home directory
        return null;
      }
      if (trimmed === '~' || trimmed.startsWith('~/')) {
        resolvedPath = trimmed.replace(/^~/, homeDir);
      } else {
        return null;
      }
    } else if (trimmed.startsWith('/')) {
      resolvedPath = trimmed;
    } else {
      // Relative paths need a working directory to resolve
      // We can't reliably get this in the browser
      return null;
    }

    return {
      absolutePath: resolvedPath,
      originalInput: trimmed,
    };
  } catch (error) {
    return null;
  }
}
