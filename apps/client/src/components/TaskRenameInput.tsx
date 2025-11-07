import { api } from "@cmux/convex/api";
import { type Doc } from "@cmux/convex/dataModel";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import clsx from "clsx";

interface TaskRenameInputProps {
  task: Doc<"tasks">;
  teamSlugOrId: string;
  isRenaming: boolean;
  setIsRenaming: (isRenaming: boolean) => void;
  className?: string;
}

export function TaskRenameInput({
  task,
  teamSlugOrId,
  isRenaming,
  setIsRenaming,
  className,
}: TaskRenameInputProps) {
  const [renameValue, setRenameValue] = useState(task.text ?? "");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenamePending, setIsRenamePending] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const pendingRenameFocusFrame = useRef<number | null>(null);
  const renameInputHasFocusedRef = useRef(false);

  const updateTaskMutation = useMutation(api.tasks.update).withOptimisticUpdate(
    (localStore, args) => {
      const optimisticUpdatedAt = Date.now();
      const applyUpdateToList = (keyArgs: {
        teamSlugOrId: string;
        archived?: boolean;
      }) => {
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

      const listVariants = [
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
  }, [task.text, setIsRenaming]);

  const handleRenameSubmit = useCallback(async () => {
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
    isRenamePending,
    renameValue,
    task._id,
    task.text,
    teamSlugOrId,
    updateTaskMutation,
    setIsRenaming,
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

  const handleStartRenaming = useCallback(() => {
    flushSync(() => {
      setRenameValue(task.text ?? "");
      setRenameError(null);
      setIsRenaming(true);
    });
    renameInputHasFocusedRef.current = false;
    focusRenameInput();
  }, [focusRenameInput, task.text, setIsRenaming]);

  if (!isRenaming) {
    return null;
  }

  return (
    <>
      <input
        ref={renameInputRef}
        type="text"
        value={renameValue}
        onChange={handleRenameChange}
        onKeyDown={handleRenameKeyDown}
        onBlur={handleRenameBlur}
        disabled={isRenamePending}
        autoFocus
        onFocus={handleRenameFocus}
        placeholder="Task name"
        aria-label="Task name"
        aria-invalid={renameError ? true : undefined}
        autoComplete="off"
        spellCheck={false}
        className={clsx(
          "inline-flex w-full items-center bg-transparent text-[14px] font-medium text-neutral-900 caret-neutral-600 transition-colors duration-200",
          "leading-[18px] h-[18px] px-0 py-0 align-middle",
          "placeholder:text-neutral-400 outline-none border-none focus-visible:outline-none focus-visible:ring-0 appearance-none",
          "dark:text-neutral-100 dark:caret-neutral-200 dark:placeholder:text-neutral-500",
          isRenamePending &&
            "text-neutral-400/70 dark:text-neutral-500/70 cursor-wait",
          className
        )}
      />
      {renameError && (
        <div className="mt-1 text-[11px] text-red-500 dark:text-red-400">
          {renameError}
        </div>
      )}
    </>
  );
}

export function useTaskRename(task: Doc<"tasks">) {
  const [isRenaming, setIsRenaming] = useState(false);

  const startRenaming = useCallback(() => {
    setIsRenaming(true);
  }, []);

  const cancelRenaming = useCallback(() => {
    setIsRenaming(false);
  }, []);

  return {
    isRenaming,
    setIsRenaming,
    startRenaming,
    cancelRenaming,
  };
}