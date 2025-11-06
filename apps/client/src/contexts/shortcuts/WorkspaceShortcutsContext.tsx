import {
  mergeShortcutOverrides,
  type GlobalShortcutId,
  type GlobalShortcutOverrides,
  type ShortcutEnvironment,
} from "@cmux/shared";
import { api } from "@cmux/convex/api";
import { useQuery } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type PropsWithChildren,
} from "react";
import { isElectron } from "@/lib/electron";
import {
  detectShortcutEnvironment,
  normalizeShortcutOverridesInput,
  sanitizeGlobalShortcutOverrides,
} from "@/lib/shortcuts";

type WorkspaceShortcutsContextValue = {
  shortcuts: Record<GlobalShortcutId, string>;
  overrides: GlobalShortcutOverrides | null;
  environment: ShortcutEnvironment;
  syncElectronShortcuts: (
    overrides?: GlobalShortcutOverrides | null
  ) => Promise<void>;
};

const WorkspaceShortcutsContext =
  createContext<WorkspaceShortcutsContextValue | null>(null);

export function WorkspaceShortcutsProvider({
  teamSlugOrId,
  children,
}: PropsWithChildren<{ teamSlugOrId: string }>) {
  const workspaceSettings = useQuery(api.workspaceSettings.get, {
    teamSlugOrId,
  });

  const overrides = useMemo(() => {
    if (!workspaceSettings) return null;
    return normalizeShortcutOverridesInput(
      (workspaceSettings as { shortcuts?: unknown }).shortcuts
    );
  }, [workspaceSettings]);

  const environment = useMemo<ShortcutEnvironment>(
    () => detectShortcutEnvironment(),
    []
  );

  const shortcuts = useMemo(
    () => mergeShortcutOverrides(overrides ?? undefined),
    [overrides]
  );

  const lastSentRef = useRef<string | null>(null);

  const syncElectronShortcuts = useCallback(
    async (explicit?: GlobalShortcutOverrides | null) => {
      if (!isElectron || !window.cmux?.shortcuts?.configure) return;
      const payload = sanitizeGlobalShortcutOverrides(
        explicit ?? overrides ?? null
      );
      const serialized = JSON.stringify(payload);
      if (!explicit && serialized === lastSentRef.current) {
        return;
      }
      try {
        await window.cmux.shortcuts.configure(payload);
        lastSentRef.current = serialized;
      } catch (error) {
        console.warn(
          "[WorkspaceShortcuts] Failed to sync shortcut overrides to Electron",
          error
        );
      }
    },
    [overrides]
  );

  useEffect(() => {
    void syncElectronShortcuts();
  }, [syncElectronShortcuts]);

  const value = useMemo<WorkspaceShortcutsContextValue>(
    () => ({
      shortcuts,
      overrides,
      environment,
      syncElectronShortcuts,
    }),
    [shortcuts, overrides, environment, syncElectronShortcuts]
  );

  return (
    <WorkspaceShortcutsContext.Provider value={value}>
      {children}
    </WorkspaceShortcutsContext.Provider>
  );
}

export function useWorkspaceShortcuts(): WorkspaceShortcutsContextValue {
  const ctx = useContext(WorkspaceShortcutsContext);
  if (!ctx) {
    throw new Error(
      "useWorkspaceShortcuts must be used within a WorkspaceShortcutsProvider"
    );
  }
  return ctx;
}

export function useWorkspaceShortcut(
  id: GlobalShortcutId
): string {
  const { shortcuts } = useWorkspaceShortcuts();
  return shortcuts[id];
}
