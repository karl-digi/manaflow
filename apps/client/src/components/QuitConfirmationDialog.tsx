import { Button } from "@/components/ui/button";
import { isElectron } from "@/lib/electron";
import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useRef, useState } from "react";

type CloseReason = "confirm" | "cancel" | null;

export function QuitConfirmationDialog() {
  const [open, setOpen] = useState(false);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const closeReasonRef = useRef<CloseReason>(null);

  useEffect(() => {
    if (!isElectron) return;
    const quitApi = window.cmux?.quit;
    if (!quitApi) return;

    const unsubscribe = quitApi.onPromptRequest(() => {
      closeReasonRef.current = null;
      setDontAskAgain(false);
      setOpen(true);
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  const handleConfirm = useCallback(() => {
    const quitApi = window.cmux?.quit;
    closeReasonRef.current = "confirm";
    setOpen(false);
    if (!quitApi) return;
    void quitApi.respond({ confirmed: true, disablePrompt: dontAskAgain });
  }, [dontAskAgain]);

  const handleCancel = useCallback(() => {
    const quitApi = window.cmux?.quit;
    closeReasonRef.current = "cancel";
    setOpen(false);
    if (!quitApi) return;
    void quitApi.respond({ confirmed: false });
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setOpen(true);
        return;
      }

      setOpen(false);
      const quitApi = window.cmux?.quit;

      if (closeReasonRef.current === "confirm") {
        closeReasonRef.current = null;
        return;
      }

      if (closeReasonRef.current === "cancel") {
        closeReasonRef.current = null;
        return;
      }

      closeReasonRef.current = "cancel";
      if (quitApi) {
        void quitApi.respond({ confirmed: false });
      }
      closeReasonRef.current = null;
    },
    []
  );

  if (!isElectron) {
    return null;
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-neutral-950/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-900">
          <Dialog.Title className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            Quit cmux?
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            Quitting will close all cmux windows and stop any active work.
          </Dialog.Description>
          <label
            htmlFor="quit-confirmation-dont-ask"
            className="mt-5 flex items-center gap-3 text-sm font-medium text-neutral-800 dark:text-neutral-200"
          >
            <input
              id="quit-confirmation-dont-ask"
              type="checkbox"
              checked={dontAskAgain}
              onChange={(event) => setDontAskAgain(event.target.checked)}
              className="size-4 shrink-0 rounded border border-neutral-300 text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus-visible:ring-neutral-100/40"
            />
            <span>Always quit without asking</span>
          </label>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleCancel} autoFocus>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleConfirm}>
              Quit
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
