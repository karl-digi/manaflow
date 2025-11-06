import {
  GLOBAL_SHORTCUT_DEFINITIONS,
  type GlobalShortcutId,
  type GlobalShortcutOverrides,
  type NormalizedKeyEventLike,
  type ShortcutEnvironment,
} from "@cmux/shared";

const MAC_PLATFORM_REGEX = /Mac|iP(hone|od|ad)/i;

export function detectShortcutEnvironment(): ShortcutEnvironment {
  if (typeof navigator === "undefined") {
    return { isMac: process.platform === "darwin" };
  }
  const platform = navigator.platform || navigator.userAgent || "";
  return { isMac: MAC_PLATFORM_REGEX.test(platform) };
}

export function keyboardEventToNormalized(
  event: KeyboardEvent,
): NormalizedKeyEventLike {
  return {
    key: event.key,
    code: event.code,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
  };
}

export function sanitizeGlobalShortcutOverrides(
  overrides: GlobalShortcutOverrides | null | undefined,
): Partial<Record<GlobalShortcutId, string | null>> {
  const sanitized: Partial<Record<GlobalShortcutId, string | null>> = {};
  if (!overrides) {
    return sanitized;
  }
  for (const def of GLOBAL_SHORTCUT_DEFINITIONS) {
    const value = overrides[def.id];
    if (value === undefined) continue;
    sanitized[def.id] = value === null ? null : value;
  }
  return sanitized;
}

export function normalizeShortcutOverridesInput(
  overrides: unknown,
): GlobalShortcutOverrides | null {
  if (!overrides || typeof overrides !== "object") {
    return null;
  }
  const normalized: Partial<Record<GlobalShortcutId, string | null>> = {};
  for (const def of GLOBAL_SHORTCUT_DEFINITIONS) {
    const value = (overrides as Record<string, unknown>)[def.id];
    if (typeof value === "string") {
      normalized[def.id] = value;
    } else if (value === null) {
      normalized[def.id] = null;
    }
  }
  return Object.keys(normalized).length > 0
    ? (normalized as GlobalShortcutOverrides)
    : null;
}
