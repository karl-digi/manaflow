/**
 * Types for representing file diffs between git revisions.
 */

/** The type of change applied to a file in a diff */
export type DiffStatus = "added" | "modified" | "deleted" | "renamed";

/**
 * Represents a single file entry in a git diff.
 * Contains metadata about the change and optionally the content.
 */
export interface ReplaceDiffEntry {
  /** Current path of the file */
  filePath: string;
  /** Original path (only set for renamed files) */
  oldPath?: string;
  /** Type of change: added, modified, deleted, or renamed */
  status: DiffStatus;
  /** Number of lines added */
  additions: number;
  /** Number of lines removed */
  deletions: number;
  /** Unified diff patch content */
  patch?: string;
  /** Full content of the file before changes */
  oldContent?: string;
  /** Full content of the file after changes */
  newContent?: string;
  /** Whether the file is binary (patch/content unavailable) */
  isBinary: boolean;
  /** Whether content was omitted due to size limits */
  contentOmitted?: boolean;
  /** Size of file before changes in bytes */
  oldSize?: number;
  /** Size of file after changes in bytes */
  newSize?: number;
  /** Size of the patch in bytes */
  patchSize?: number;
}

