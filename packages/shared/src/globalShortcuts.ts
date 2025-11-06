export type GlobalShortcutId =
  | "commandPalette"
  | "sidebarToggle"
  | "previewReload"
  | "previewBack"
  | "previewForward"
  | "previewFocusAddress";

export type GlobalShortcutDefinition = {
  id: GlobalShortcutId;
  eventName: string;
  label: string;
  description?: string;
  defaultAccelerator: string;
  category: "workspace" | "preview";
};

export const GLOBAL_SHORTCUT_DEFINITIONS: readonly GlobalShortcutDefinition[] =
  [
    {
      id: "commandPalette",
      eventName: "cmd-k",
      label: "Open Command Palette",
      description: "Toggle the command palette from anywhere in the app.",
      defaultAccelerator: "CommandOrControl+K",
      category: "workspace",
    },
    {
      id: "sidebarToggle",
      eventName: "sidebar-toggle",
      label: "Toggle Sidebar",
      description: "Show or hide the workspace sidebar.",
      defaultAccelerator: "CommandOrControl+Shift+S",
      category: "workspace",
    },
    {
      id: "previewReload",
      eventName: "preview-reload",
      label: "Reload Preview",
      description: "Reload the focused preview window.",
      defaultAccelerator: "CommandOrControl+R",
      category: "preview",
    },
    {
      id: "previewBack",
      eventName: "preview-back",
      label: "Preview Back",
      description: "Navigate back in the focused preview window history.",
      defaultAccelerator: "CommandOrControl+[",
      category: "preview",
    },
    {
      id: "previewForward",
      eventName: "preview-forward",
      label: "Preview Forward",
      description: "Navigate forward in the focused preview window history.",
      defaultAccelerator: "CommandOrControl+]",
      category: "preview",
    },
    {
      id: "previewFocusAddress",
      eventName: "preview-focus-address",
      label: "Focus Preview Address Bar",
      description: "Move focus to the preview address bar.",
      defaultAccelerator: "CommandOrControl+L",
      category: "preview",
    },
  ] as const;

export type GlobalShortcutEventNameMap = Record<
  GlobalShortcutId,
  GlobalShortcutDefinition["eventName"]
>;

export const GLOBAL_SHORTCUT_EVENT_NAME_MAP: GlobalShortcutEventNameMap =
  GLOBAL_SHORTCUT_DEFINITIONS.reduce(
    (acc, def) => {
      acc[def.id] = def.eventName;
      return acc;
    },
    {} as GlobalShortcutEventNameMap,
  );

export type GlobalShortcutDefaults = Record<
  GlobalShortcutId,
  GlobalShortcutDefinition["defaultAccelerator"]
>;

export const DEFAULT_GLOBAL_SHORTCUTS: GlobalShortcutDefaults =
  GLOBAL_SHORTCUT_DEFINITIONS.reduce(
    (acc, def) => {
      acc[def.id] = def.defaultAccelerator;
      return acc;
    },
    {} as GlobalShortcutDefaults,
  );

export type GlobalShortcutOverrides = Partial<
  Record<GlobalShortcutId, string | null | undefined>
>;

export type ShortcutEnvironment = {
  isMac: boolean;
};

export type NormalizedKeyEventLike = {
  key: string;
  code?: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

type ParsedAccelerator = {
  requireMeta: boolean;
  requireCtrl: boolean;
  requireAlt: boolean;
  requireShift: boolean;
  requireSuper: boolean;
  requireCmdOrCtrl: boolean;
  keyToken: string | null;
};

const COMMAND_OR_CONTROL_TOKENS = new Set([
  "commandorcontrol",
  "commandorctrl",
  "cmdorctrl",
  "controlorcommand",
  "ctrlorcmd",
  "ctrlorcommand",
]);

const META_TOKENS = new Set(["meta", "command", "cmd", "super"]);
const CTRL_TOKENS = new Set(["control", "ctrl"]);
const ALT_TOKENS = new Set(["alt", "option", "altgr"]);
const SHIFT_TOKENS = new Set(["shift"]);

const SPECIAL_KEY_TOKEN_ALIASES: Record<string, string> = {
  spacebar: "space",
  space: "space",
  plus: "+",
};

const ARROW_TOKEN_ALIASES: Record<string, string> = {
  arrowup: "arrowup",
  arrowdown: "arrowdown",
  arrowleft: "arrowleft",
  arrowright: "arrowright",
};

function parseAccelerator(
  accelerator: string,
  env: ShortcutEnvironment,
): ParsedAccelerator | null {
  if (!accelerator) return null;
  const tokens = accelerator
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  let requireMeta = false;
  let requireCtrl = false;
  let requireAlt = false;
  let requireShift = false;
  let requireSuper = false;
  let requireCmdOrCtrl = false;
  let keyToken: string | null = null;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (COMMAND_OR_CONTROL_TOKENS.has(lower)) {
      requireCmdOrCtrl = true;
      continue;
    }
    if (META_TOKENS.has(lower)) {
      requireMeta = true;
      if (lower === "super") {
        requireSuper = true;
      }
      continue;
    }
    if (CTRL_TOKENS.has(lower)) {
      requireCtrl = true;
      continue;
    }
    if (ALT_TOKENS.has(lower)) {
      requireAlt = true;
      continue;
    }
    if (SHIFT_TOKENS.has(lower)) {
      requireShift = true;
      continue;
    }
    keyToken = token;
  }

  if (requireCmdOrCtrl) {
    if (env.isMac) {
      requireMeta = true;
    } else {
      requireCtrl = true;
    }
  }

  return {
    requireMeta,
    requireCtrl,
    requireAlt,
    requireShift,
    requireSuper,
    requireCmdOrCtrl,
    keyToken,
  };
}

function normalizeKeyToken(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (SPECIAL_KEY_TOKEN_ALIASES[lower] !== undefined) {
    return SPECIAL_KEY_TOKEN_ALIASES[lower];
  }
  if (ARROW_TOKEN_ALIASES[lower]) {
    return ARROW_TOKEN_ALIASES[lower];
  }
  return trimmed;
}

function matchesKeyToken(
  token: string | null,
  event: NormalizedKeyEventLike,
): boolean {
  if (!token) return false;
  const normalized = normalizeKeyToken(token);
  if (!normalized) return false;
  const eventKey = event.key?.toLowerCase?.() ?? "";
  const eventCode = event.code?.toLowerCase?.() ?? "";
  if (!eventKey && !eventCode) return false;

  if (normalized === "+") {
    return event.key === "+" || event.code === "Equal";
  }

  if (normalized === "space") {
    return event.key === " " || event.code === "Space";
  }

  if (normalized.startsWith("arrow")) {
    return eventKey === normalized || eventCode === normalized;
  }

  if (normalized.length === 1) {
    return (
      eventKey === normalized ||
      eventKey === normalized.toUpperCase() ||
      eventCode === `key${normalized}` ||
      eventCode === `digit${normalized}`
    );
  }

  const normalizedUpper =
    normalized.length > 0
      ? normalized[0].toUpperCase() + normalized.slice(1)
      : normalized;

  if (eventKey === normalized || eventKey === normalizedUpper) {
    return true;
  }

  return (
    eventCode === normalized ||
    eventCode === normalizedLowerCaseVariant(normalized) ||
    eventCode === normalizedUpper.toLowerCase()
  );
}

function normalizedLowerCaseVariant(token: string): string {
  return token
    .split("")
    .map((char, index) =>
      index === 0 ? char.toLowerCase() : char.toLowerCase(),
    )
    .join("");
}

function hasExactModifiers(
  parsed: ParsedAccelerator,
  event: NormalizedKeyEventLike,
  env: ShortcutEnvironment,
): boolean {
  if (parsed.requireMeta !== event.metaKey) {
    return false;
  }
  if (parsed.requireCtrl !== event.ctrlKey) {
    return false;
  }
  if (parsed.requireAlt !== event.altKey) {
    return false;
  }
  if (parsed.requireShift !== event.shiftKey) {
    return false;
  }

  if (parsed.requireSuper) {
    if (!event.metaKey) {
      return false;
    }
  } else if (!parsed.requireMeta && event.metaKey) {
    // Disallow stray meta key presses on non-mac if shortcut doesn't require it.
    if (!env.isMac) {
      return false;
    }
  }

  return true;
}

export function matchesAccelerator(
  accelerator: string | null | undefined,
  event: NormalizedKeyEventLike,
  env: ShortcutEnvironment,
): boolean {
  if (!accelerator) return false;
  const parsed = parseAccelerator(accelerator, env);
  if (!parsed || !parsed.keyToken) return false;
  if (!hasExactModifiers(parsed, event, env)) {
    return false;
  }
  return matchesKeyToken(parsed.keyToken, event);
}

export function mergeShortcutOverrides(
  overrides?: GlobalShortcutOverrides | null,
): Record<GlobalShortcutId, string> {
  const merged: Record<GlobalShortcutId, string> = {
    ...DEFAULT_GLOBAL_SHORTCUTS,
  };
  if (!overrides) {
    return merged;
  }
  for (const def of GLOBAL_SHORTCUT_DEFINITIONS) {
    const maybeValue = overrides[def.id];
    if (maybeValue === undefined || maybeValue === null) {
      continue;
    }
    const trimmed = maybeValue.trim();
    if (trimmed.length > 0) {
      merged[def.id] = trimmed;
    }
  }
  return merged;
}

const DISPLAY_TOKEN_MAP_MAC: Record<string, string> = {
  command: "⌘",
  cmd: "⌘",
  commandorcontrol: "⌘",
  cmdorctrl: "⌘",
  commandorctrl: "⌘",
  controlorcommand: "⌘",
  ctrlorcommand: "⌘",
  ctrl: "⌃",
  control: "⌃",
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
  super: "⌘",
  meta: "⌘",
};

const DISPLAY_TOKEN_MAP_DEFAULT: Record<string, string> = {
  command: "Cmd",
  cmd: "Cmd",
  commandorcontrol: "Ctrl",
  commandorctrl: "Ctrl",
  cmdorctrl: "Ctrl",
  controlorcommand: "Ctrl",
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  super: "Win",
  meta: "Meta",
};

function formatKeyTokenForDisplay(token: string, env: ShortcutEnvironment) {
  const normalized = normalizeKeyToken(token);
  if (!normalized) return "";
  if (normalized === "+") return "+";
  if (normalized === "space") return env.isMac ? "Space" : "Space";
  if (normalized.startsWith("arrow")) {
    const arrowSuffix = normalized.replace("arrow", "");
    return arrowSuffix ? arrowSuffix[0].toUpperCase() + arrowSuffix.slice(1) : "";
  }
  if (normalized.length === 1) {
    return normalized.toUpperCase();
  }
  return normalized
    .split("")
    .map((char, index) =>
      index === 0 ? char.toUpperCase() : char.toLowerCase(),
    )
    .join("");
}

export function formatAcceleratorForDisplay(
  accelerator: string,
  env: ShortcutEnvironment,
): string {
  if (!accelerator) return "";
  const tokens = accelerator
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return "";

  return tokens
    .map((token) => {
      const lower = token.toLowerCase();
      if (env.isMac) {
        if (DISPLAY_TOKEN_MAP_MAC[lower]) {
          return DISPLAY_TOKEN_MAP_MAC[lower];
        }
      } else if (DISPLAY_TOKEN_MAP_DEFAULT[lower]) {
        return DISPLAY_TOKEN_MAP_DEFAULT[lower];
      }
      return formatKeyTokenForDisplay(token, env);
    })
    .join(env.isMac ? "" : " + ");
}

function canonicalizeModifierTokens(
  event: NormalizedKeyEventLike,
  env: ShortcutEnvironment,
): string[] {
  const tokens: string[] = [];
  if (env.isMac) {
    if (event.metaKey) {
      tokens.push("Command");
    }
    if (event.altKey) {
      tokens.push("Option");
    }
    if (event.ctrlKey) {
      tokens.push("Control");
    }
  } else {
    if (event.ctrlKey) {
      tokens.push("Ctrl");
    }
    if (event.altKey) {
      tokens.push("Alt");
    }
    if (event.metaKey) {
      tokens.push("Meta");
    }
  }
  if (event.shiftKey) {
    tokens.push("Shift");
  }
  return tokens;
}

export function serializeAcceleratorFromEvent(
  event: NormalizedKeyEventLike,
  env: ShortcutEnvironment,
): string | null {
  const keyToken = deriveKeyTokenFromEvent(event);
  if (!keyToken) {
    return null;
  }
  const tokens = canonicalizeModifierTokens(event, env);
  tokens.push(keyToken);
  return tokens.join("+");
}

const ALLOWED_SINGLE_CHAR_SYMBOLS = new Set(["[", "]", ";", "'", ",", ".", "/", "\\", "-", "=", "`"]);

function deriveKeyTokenFromEvent(
  event: NormalizedKeyEventLike,
): string | null {
  const key = event.key;
  if (!key) return null;
  if (key === "Dead") return null;
  if (key === " ") return "Space";
  if (key === "Escape") return "Escape";
  if (key === "Backspace") return "Backspace";
  if (key === "Enter") return "Enter";

  if (key.startsWith("Arrow")) {
    return key;
  }

  if (/^F\d{1,2}$/i.test(key)) {
    return key.toUpperCase();
  }

  if (key.length === 1) {
    if (key === "+") return "Plus";
    if (ALLOWED_SINGLE_CHAR_SYMBOLS.has(key)) {
      return key;
    }
    return key.toUpperCase();
  }

  return key;
}

