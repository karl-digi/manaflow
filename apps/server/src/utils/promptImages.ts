import path from "node:path";

const PROMPT_IMAGE_ROOT = "/root/prompt";

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function collapseRepeatedPromptImageRoots(text: string): string {
  // Prevent prompts from accumulating "/root/prompt//root/prompt/..." when
  // replacing filenames multiple times across runs.
  return text.replace(/(?:\/root\/prompt\/){2,}/g, "/root/prompt/");
}

export function sanitizePromptImageFileName(
  fileName: string | undefined,
  fallbackFileName: string,
): string {
  const raw = (fileName ?? "").trim();
  const candidate = raw.length > 0 ? raw : fallbackFileName;

  // Convert Windows separators so basename works regardless of origin.
  const normalizedSeparators = candidate.replace(/\\/g, "/");
  const baseName = path.posix.basename(normalizedSeparators);

  // Keep filenames simple and safe for shell usage and filesystem writes.
  let safe = baseName
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "_");

  if (safe.length === 0 || safe === "." || safe === "..") {
    safe = fallbackFileName;
  }

  // Ensure we always end up with a file extension so consumers (humans/tools) have a hint.
  // The client currently uploads arbitrary image bytes; we preserve the original extension
  // when present and fall back to .png otherwise.
  if (path.posix.extname(safe).length === 0) {
    safe = `${safe}.png`;
  }

  const MAX_LEN = 128;
  if (safe.length > MAX_LEN) {
    const ext = path.posix.extname(safe);
    const stem = ext.length > 0 ? safe.slice(0, -ext.length) : safe;
    safe = `${stem.slice(0, Math.max(1, MAX_LEN - ext.length))}${ext}`;
  }

  return safe;
}

export function buildPromptImagePath(safeFileName: string): string {
  return `${PROMPT_IMAGE_ROOT}/${safeFileName}`;
}

export function replacePromptImageReference(
  prompt: string,
  reference: string,
  replacementPath: string,
): string {
  if (reference.trim().length === 0) {
    return prompt;
  }

  // Avoid rewriting references that are already part of a path (e.g. "/root/prompt/<name>")
  // to prevent generating "/root/prompt//root/prompt/<name>".
  const escaped = escapeRegExp(reference);
  const pattern = new RegExp(`(?<!/)(?<!\\\\)${escaped}`, "g");
  return prompt.replace(pattern, replacementPath);
}

