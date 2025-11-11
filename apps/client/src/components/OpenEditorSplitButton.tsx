import { editorIcons } from "@/components/ui/dropdown-types";
import { useSocket } from "@/contexts/socket/use-socket";
import { Menu } from "@base-ui-components/react/menu";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MenuArrow } from "./ui/menu";
import type { EnsureRunWorktreeResponse } from "@cmux/shared";
import type { Id } from "@cmux/convex/dataModel";

type EditorType =
  | "cursor"
  | "vscode"
  | "windsurf"
  | "finder"
  | "iterm"
  | "terminal"
  | "ghostty"
  | "alacritty"
  | "xcode";

interface OpenEditorSplitButtonProps {
  worktreePath?: string | null;
  taskRunId?: Id<"taskRuns"> | null;
  isCloudWorkspace?: boolean;
  classNameLeft?: string;
  classNameRight?: string;
}

export function OpenEditorSplitButton({
  worktreePath,
  taskRunId,
  isCloudWorkspace,
  classNameLeft,
  classNameRight,
}: OpenEditorSplitButtonProps) {
  const { socket, availableEditors } = useSocket();
  const [menuOpen, setMenuOpen] = useState(false);
  const [resolvedWorktreePath, setResolvedWorktreePath] = useState<
    string | null
  >(worktreePath ?? null);
  const hasEnsuredWorktreeRef = useRef(false);
  const lastRunIdRef = useRef<Id<"taskRuns"> | null>(null);

  useEffect(() => {
    setResolvedWorktreePath(worktreePath ?? null);
  }, [worktreePath]);

  useEffect(() => {
    if (lastRunIdRef.current !== (taskRunId ?? null)) {
      lastRunIdRef.current = taskRunId ?? null;
      hasEnsuredWorktreeRef.current = false;
    }
  }, [taskRunId]);

  useEffect(() => {
    if (!socket) return;
    const handleOpenInEditorError = (data: { error: string }) => {
      console.error("Failed to open editor:", data.error);
    };
    socket.on("open-in-editor-error", handleOpenInEditorError);
    return () => {
      socket.off("open-in-editor-error", handleOpenInEditorError);
    };
  }, [socket]);

  const ensureWorktreePath = useCallback((): Promise<string> => {
    if (!socket) {
      return Promise.reject(new Error("Socket is not connected"));
    }
    if (!taskRunId) {
      return Promise.reject(new Error("Task run is unavailable"));
    }
    return new Promise((resolve, reject) => {
      socket.emit(
        "ensure-run-worktree",
        { taskRunId },
        (response: EnsureRunWorktreeResponse) => {
          if (response.success && response.worktreePath) {
            hasEnsuredWorktreeRef.current = true;
            setResolvedWorktreePath(response.worktreePath);
            resolve(response.worktreePath);
          } else {
            reject(
              new Error(response.error || "Failed to prepare workspace path")
            );
          }
        }
      );
    });
  }, [socket, taskRunId]);

  const getWorktreePathForEditor = useCallback(() => {
    if (
      resolvedWorktreePath &&
      (!isCloudWorkspace || hasEnsuredWorktreeRef.current)
    ) {
      return Promise.resolve(resolvedWorktreePath);
    }
    if (!taskRunId) {
      if (resolvedWorktreePath) {
        return Promise.resolve(resolvedWorktreePath);
      }
      return Promise.reject(new Error("Workspace path is not available"));
    }
    return ensureWorktreePath();
  }, [
    ensureWorktreePath,
    isCloudWorkspace,
    resolvedWorktreePath,
    taskRunId,
  ]);

  const hasValidWorktreePath =
    Boolean(resolvedWorktreePath) &&
    (!isCloudWorkspace || hasEnsuredWorktreeRef.current);
  const canUseLocalEditors = hasValidWorktreePath || Boolean(taskRunId);

  const menuItems = useMemo(
    () =>
      [
        {
          id: "vscode" as const,
          name: "VS Code",
          enabled: canUseLocalEditors && (availableEditors?.vscode ?? true),
        },
        {
          id: "cursor" as const,
          name: "Cursor",
          enabled: canUseLocalEditors && (availableEditors?.cursor ?? true),
        },
        {
          id: "windsurf" as const,
          name: "Windsurf",
          enabled: canUseLocalEditors && (availableEditors?.windsurf ?? true),
        },
        {
          id: "finder" as const,
          name: "Finder",
          enabled: canUseLocalEditors && (availableEditors?.finder ?? true),
        },
        {
          id: "iterm" as const,
          name: "iTerm",
          enabled: canUseLocalEditors && (availableEditors?.iterm ?? false),
        },
        {
          id: "terminal" as const,
          name: "Terminal",
          enabled: canUseLocalEditors && (availableEditors?.terminal ?? false),
        },
        {
          id: "ghostty" as const,
          name: "Ghostty",
          enabled: canUseLocalEditors && (availableEditors?.ghostty ?? false),
        },
        {
          id: "alacritty" as const,
          name: "Alacritty",
          enabled: canUseLocalEditors && (availableEditors?.alacritty ?? false),
        },
        {
          id: "xcode" as const,
          name: "Xcode",
          enabled: canUseLocalEditors && (availableEditors?.xcode ?? false),
        },
      ].filter((item) => item.enabled),
    [availableEditors, canUseLocalEditors]
  );

  const [selectedEditor, setSelectedEditor] = useState<EditorType | null>(
    () => {
      const raw =
        typeof window !== "undefined"
          ? window.localStorage.getItem("cmux:lastEditor")
          : null;
      const hasWorkspace = Boolean(worktreePath) || Boolean(taskRunId);
      const stored =
        raw === "vscode-remote"
          ? hasWorkspace
            ? "vscode"
            : null
          : (raw as EditorType | null);
      if (stored) return stored;
      if (hasWorkspace) return "vscode";
      return null;
    }
  );

  useEffect(() => {
    if (menuItems.length === 0) {
      if (selectedEditor) {
        setSelectedEditor(null);
      }
      return;
    }
    if (!selectedEditor || !menuItems.find((m) => m.id === selectedEditor)) {
      setSelectedEditor(menuItems[0].id);
    }
  }, [menuItems, selectedEditor]);

  useEffect(() => {
    if (selectedEditor) {
      window.localStorage.setItem("cmux:lastEditor", selectedEditor);
    }
  }, [selectedEditor]);

  const handleOpenInEditor = useCallback(
    (editor: EditorType): Promise<void> => {
      if (
        socket &&
        [
          "cursor",
          "vscode",
          "windsurf",
          "finder",
          "iterm",
          "terminal",
          "ghostty",
          "alacritty",
          "xcode",
        ].includes(editor)
      ) {
        return getWorktreePathForEditor().then(
          (pathToOpen) =>
            new Promise((resolve, reject) => {
              socket.emit(
                "open-in-editor",
                { editor, path: pathToOpen },
                (response: { success: boolean; error?: string }) => {
                  if (response.success) resolve();
                  else
                    reject(
                      new Error(response.error || "Failed to open editor")
                    );
                }
              );
            })
        );
      }
      return Promise.reject(new Error("Unable to open editor"));
    },
    [socket, getWorktreePathForEditor]
  );

  const selected = menuItems.find((m) => m.id === selectedEditor) || null;
  const leftDisabled = !selected;
  const SelectedIcon = selected ? editorIcons[selected.id] : null;

  const openEditor = useCallback(
    (editor: EditorType) => {
      const item = menuItems.find((m) => m.id === editor);
      if (!item) return;
      const loadingToast = toast.loading(`Opening ${item.name}...`);
      handleOpenInEditor(editor)
        .then(() => {
          toast.success(`Opened ${item.name}`, { id: loadingToast });
        })
        .catch((error: Error) => {
          let errorMessage = "Failed to open editor";
          if (
            error.message?.includes("ENOENT") ||
            error.message?.includes("not found") ||
            error.message?.includes("command not found")
          ) {
            if (editor === "vscode")
              errorMessage = "VS Code is not installed or not found in PATH";
            else if (editor === "cursor")
              errorMessage = "Cursor is not installed or not found in PATH";
            else if (editor === "windsurf")
              errorMessage = "Windsurf is not installed or not found in PATH";
            else if (editor === "finder")
              errorMessage = "Finder is not available or not found";
          } else if (error.message) {
            errorMessage = error.message;
          }
          toast.error(errorMessage, { id: loadingToast });
        });
    },
    [handleOpenInEditor, menuItems]
  );

  const openSelected = useCallback(() => {
    if (!selected) return;
    openEditor(selected.id);
  }, [openEditor, selected]);

  return (
    <div className="flex items-stretch">
      <button
        onClick={openSelected}
        disabled={leftDisabled}
        className={clsx(
          "flex items-center gap-1.5 px-3 py-1 bg-neutral-800 text-white rounded-l hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-xs select-none whitespace-nowrap",
          "border border-neutral-700 border-r",
          classNameLeft
        )}
      >
        {SelectedIcon && <SelectedIcon className="w-3.5 h-3.5" />}
        {selected ? selected.name : "Open in editor"}
      </button>
      <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Menu.Trigger
          className={clsx(
            "flex items-center px-2 py-1 bg-neutral-800 text-white rounded-r hover:bg-neutral-700 select-none border border-neutral-700 border-l-0",
            classNameRight
          )}
          title="Choose editor"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={5} className="outline-none z-[var(--z-global-blocking)]">
            <Menu.Popup
              className={clsx(
                "origin-[var(--transform-origin)] rounded-md bg-white dark:bg-black py-1",
                "text-neutral-900 dark:text-neutral-100",
                "shadow-lg shadow-neutral-200 dark:shadow-neutral-950",
                "outline outline-neutral-200 dark:outline-neutral-800",
                "transition-[transform,scale,opacity]",
                "data-[ending-style]:scale-90 data-[ending-style]:opacity-0",
                "data-[starting-style]:scale-90 data-[starting-style]:opacity-0"
              )}
            >
              <MenuArrow />
              <div className="px-2 py-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Open with
              </div>
              <Menu.RadioGroup
                value={selected?.id}
                onValueChange={(val) => {
                  const editor = val as EditorType;
                  setSelectedEditor(editor);
                  setMenuOpen(false);
                  openEditor(editor);
                }}
              >
                {menuItems.map((item) => {
                  const Icon = editorIcons[item.id];
                  return (
                    <Menu.RadioItem
                      key={item.id}
                      value={item.id}
                      className={clsx(
                        "grid cursor-default grid-cols-[0.75rem_1rem_1fr] items-center gap-2 py-2 pr-8 pl-2.5 text-sm leading-4 outline-none select-none",
                        "data-[highlighted]:relative data-[highlighted]:z-0",
                        "data-[highlighted]:text-neutral-50 dark:data-[highlighted]:text-neutral-900",
                        "data-[highlighted]:before:absolute data-[highlighted]:before:inset-x-1 data-[highlighted]:before:inset-y-0",
                        "data-[highlighted]:before:z-[-1] data-[highlighted]:before:rounded-sm",
                        "data-[highlighted]:before:bg-neutral-900 dark:data-[highlighted]:before:bg-neutral-100"
                      )}
                    >
                      <Menu.RadioItemIndicator className="col-start-1">
                        <Check className="w-3 h-3" />
                      </Menu.RadioItemIndicator>
                      {Icon && <Icon className="w-3.5 h-3.5 col-start-2" />}
                      <span className="col-start-3">{item.name}</span>
                    </Menu.RadioItem>
                  );
                })}
              </Menu.RadioGroup>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
