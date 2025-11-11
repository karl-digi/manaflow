/**
 * Detects whether a string looks like a local file path (browser-safe).
 * This is a heuristic check that works without Node.js APIs.
 */
export function isLocalRepoPath(input: string): boolean {
  if (!input) {
    return false;
  }

  const trimmed = input.trim();

  // Check for common local path patterns
  return (
    trimmed.startsWith("/") ||          // Absolute Unix path
    trimmed.startsWith("./") ||         // Relative path (current dir)
    trimmed.startsWith("../") ||        // Relative path (parent dir)
    trimmed.startsWith("~") ||          // Home directory (Unix)
    /^[a-zA-Z]:\\/.test(trimmed) ||     // Windows absolute path (C:\)
    trimmed.startsWith("\\\\")          // Windows UNC path (\\server\share)
  );
}
