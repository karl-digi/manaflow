import { Button } from "@/components/ui/button";
import { isElectron } from "@/lib/electron";
import * as Dialog from "@radix-ui/react-dialog";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export function ElectronQuitConfirmationDialog() {
  const [open, setOpen] = useState(false);
  const [alwaysQuitChecked, setAlwaysQuitChecked] = useState(false);
  const closingRef = useRef(false);

  useEffect(() => {
    if (!isElectron) return;
    const unsubscribe = window.cmux?.on?.("quit-confirmation:show", () => {
      setAlwaysQuitChecked(false);
      setOpen(true);
    });
    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  const respond = useCallback(
    async (confirmed: boolean, shouldAlwaysQuit: boolean) => {
      if (!isElectron) return;
      const quitAPI = window.cmux?.quit;
      if (!quitAPI?.respond) return;
      try {
        await quitAPI.respond({
          confirmed,
          alwaysQuit: shouldAlwaysQuit,
        });
      } catch (error) {
        console.error("Failed to respond to quit confirmation", error);
      }
    },
    []
  );

  const closeWithDecision = useCallback(
    (confirmed: boolean, shouldAlwaysQuit: boolean) => {
      closingRef.current = true;
      setOpen(false);
      setAlwaysQuitChecked(false);
      // Allow Radix to settle the controlled close before accepting new quits.
      window.setTimeout(() => {
        closingRef.current = false;
      }, 0);
      void respond(confirmed, shouldAlwaysQuit);
    },
    [respond]
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setAlwaysQuitChecked(false);
        setOpen(true);
        return;
      }
      if (closingRef.current) {
        return;
      }
      closeWithDecision(false, false);
    },
    [closeWithDecision]
  );

  if (!isElectron) {
    return null;
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-neutral-950/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Dialog.Title className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                Quit cmux?
              </Dialog.Title>
              <Dialog.Description className="text-sm text-neutral-600 dark:text-neutral-400">
                Quitting will close all active workspaces. You can stay or quit now.
              </Dialog.Description>
            </div>
            <label
              htmlFor="quit-confirmation-always"
              className="flex select-none items-start gap-3 text-sm text-neutral-700 dark:text-neutral-300"
            >
              <input
                id="quit-confirmation-always"
                type="checkbox"
                checked={alwaysQuitChecked}
                onChange={(event) => setAlwaysQuitChecked(event.target.checked)}
                className="mt-1 size-4 rounded border border-neutral-300 text-primary outline-none transition focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:border-neutral-600 dark:bg-neutral-900"
              />
              <span className="leading-tight">Always quit without asking</span>
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => closeWithDecision(false, false)}
                autoFocus
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => closeWithDecision(true, alwaysQuitChecked)}
              >
                Quit
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
