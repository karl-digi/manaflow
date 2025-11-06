import { api } from "@cmux/convex/api";
import { DEFAULT_SHORTCUTS } from "@cmux/shared";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";

export function useKeyboardShortcuts() {
  const params = useParams({ strict: false });
  const teamSlugOrId = (params as { teamSlugOrId?: string }).teamSlugOrId || "";

  const { data: keyboardShortcutsData } = useQuery(
    convexQuery(api.keyboardShortcuts.get, { teamSlugOrId })
  );

  const shortcuts: Record<string, string> = {};
  if (keyboardShortcutsData) {
    Object.keys(DEFAULT_SHORTCUTS).forEach((key) => {
      const value = keyboardShortcutsData[key as keyof typeof keyboardShortcutsData];
      shortcuts[key] =
        typeof value === "string"
          ? value
          : DEFAULT_SHORTCUTS[key as keyof typeof DEFAULT_SHORTCUTS];
    });
  } else {
    Object.assign(shortcuts, DEFAULT_SHORTCUTS);
  }

  return shortcuts;
}
