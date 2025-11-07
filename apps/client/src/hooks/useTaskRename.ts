import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from "react";

type TasksGetArgs = {
  teamSlugOrId: string;
  projectFullName?: string;
  archived?: boolean;
};

interface UseTaskRenameOptions {
  task: Doc<"tasks">;
  teamSlugOrId: string;
  canRename?: boolean;
}

export function useTaskRename({
  task,
  teamSlugOrId,
  canRename = true,
}: UseTaskRenameOptions) {
  const updateTaskMutation = useMutation(api.tasks.update).withOptimisticUpdate(
    (localStore, args) => {
      const optimisticUpdatedAt = Date.now();
      const applyUpdateToList = (keyArgs: TasksGetArgs) => {
        const list = localStore.getQuery(api.tasks.get, keyArgs);
        if (!list) {
          return;
        }
        const index = list.findIndex((item) => item._id === args.id);
        if (index === -1) {
          return;
        }
        const next = list.slice();
        next[index] = {
          ...next[index],
          text: args.text,
          updatedAt: optimisticUpdatedAt,
        };
        localStore.setQuery(api.tasks.get, keyArgs, next);
      };

      const listVariants: TasksGetArgs[] = [
        { teamSlugOrId: args.teamSlugOrId },
        { teamSlugOrId: args.teamSlugOrId, archived: false },
        { teamSlugOrId: args.teamSlugOrId, archived: true },
      ];

      listVariants.forEach(applyUpdateToList);

      const detailArgs = { teamSlugOrId: args.teamSlugOrId, id: args.id };
      const existingDetail = localStore.getQuery(api.tasks.getById, detailArgs);
      if (existingDetail) {
        localStore.setQuery(api.tasks.getById, detailArgs, {
          ...existingDetail,
          text: args.text,
          updatedAt: optimisticUpdatedAt,
        });
      }
    }
  );

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(task.text ?? "");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenamePending, setIsRenamePending] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const pendingRenameFocusFrame = useRef<number | null>(null);
  const renameInputHasFocusedRef = useRef(false);

  const focusRenameInput = useCallback(() => {
    if (typeof window === "undefined") {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
      return;
    }
    if (pendingRenameFocusFrame.current !== null) {
      window.cancelAnimationFrame(pendingRenameFocusFrame.current);
    }
    pendingRenameFocusFrame.current = window.requestAnimationFrame(() => {
      pendingRenameFocusFrame.current = null;
      const input = renameInputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      input.select();
    });
  }, []);

  useEffect(
    () => () => {
      if (pendingRenameFocusFrame.current !== null) {
        window.cancelAnimationFrame(pendingRenameFocusFrame.current);
        pendingRenameFocusFrame.current = null;
      }
    },
    []
  );

  useEffect(() => {
    if (!isRenaming) {
      setRenameValue(task.text ?? "");
    }
  }, [isRenaming, task.text]);

  const handleRenameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setRenameValue(event.target.value);
      if (renameError) {
        setRenameError(null);
      }
    },
    [renameError]
  );

  const handleRenameCancel = useCallback(() => {
    setRenameValue(task.text ?? "");
    setRenameError(null);
    setIsRenaming(false);
  }, [task.text]);

  const handleRenameSubmit = useCallback(async () => {
    if (!canRename) {
      setIsRenaming(false);
      return;
    }
    if (isRenamePending) {
      return;
    }
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("Task name is required.");
      renameInputRef.current?.focus();
      return;
    }
    const current = (task.text ?? "").trim();
    if (trimmed === current) {
      setIsRenaming(false);
      setRenameError(null);
      return;
    }
    setIsRenamePending(true);
    try {
      await updateTaskMutation({
        teamSlugOrId,
        id: task._id,
        text: trimmed,
      });
      setIsRenaming(false);
      setRenameError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to rename task.";
      setRenameError(message);
      toast.error(message);
      renameInputRef.current?.focus();
    } finally {
      setIsRenamePending(false);
    }
  }, [
    canRename,
    isRenamePending,
    renameValue,
    task._id,
    task.text,
    teamSlugOrId,
    updateTaskMutation,
  ]);

  const handleRenameKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void handleRenameSubmit();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        handleRenameCancel();
      }
    },
    [handleRenameCancel, handleRenameSubmit]
  );

  const handleRenameBlur = useCallback(() => {
    if (!renameInputHasFocusedRef.current) {
      focusRenameInput();
      return;
    }
    void handleRenameSubmit();
  }, [focusRenameInput, handleRenameSubmit]);

  const handleRenameFocus = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      renameInputHasFocusedRef.current = true;
      event.currentTarget.select();
    },
    []
  );

  const startRenaming = useCallback(() => {
    if (!canRename) {
      return;
    }
    setRenameValue(task.text ?? "");
    setRenameError(null);
    setIsRenaming(true);
    renameInputHasFocusedRef.current = false;
  }, [canRename, task.text]);

  return {
    isRenaming,
    renameValue,
    renameError,
    isRenamePending,
    renameInputRef,
    focusRenameInput,
    handleRenameChange,
    handleRenameCancel,
    handleRenameSubmit,
    handleRenameKeyDown,
    handleRenameBlur,
    handleRenameFocus,
    startRenaming,
  };
}
