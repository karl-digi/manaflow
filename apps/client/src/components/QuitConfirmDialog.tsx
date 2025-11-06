import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";

export function QuitConfirmDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [dontAskAgain, setDontAskAgain] = useState(false);

  useEffect(() => {
    const unsubscribe = window.cmux.on("shortcut:quit-requested", () => {
      const shouldShowDialog = localStorage.getItem("showQuitConfirmation");

      if (shouldShowDialog === "false") {
        // User chose to always quit without asking
        window.cmux.ui.confirmQuit(true);
      } else {
        // Show the confirmation dialog
        setIsOpen(true);
      }
    });

    return unsubscribe;
  }, []);

  const handleQuit = () => {
    if (dontAskAgain) {
      localStorage.setItem("showQuitConfirmation", "false");
    }
    setIsOpen(false);
    window.cmux.ui.confirmQuit(true);
  };

  const handleCancel = () => {
    setIsOpen(false);
    setDontAskAgain(false);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 z-50" />
        <Dialog.Content
          className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] rounded-lg border border-neutral-200 bg-white p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] dark:border-neutral-800 dark:bg-neutral-950"
          aria-describedby="quit-dialog-description"
        >
          <Dialog.Title className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Quit cmux?
          </Dialog.Title>
          <Dialog.Description
            id="quit-dialog-description"
            className="mt-2 text-sm text-neutral-600 dark:text-neutral-400"
          >
            Are you sure you want to quit? All unsaved changes will be lost.
          </Dialog.Description>

          <div className="mt-4">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={dontAskAgain}
                onChange={(e) => setDontAskAgain(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-400 cursor-pointer"
                aria-label="Don't ask me again"
              />
              <span className="text-sm text-neutral-700 dark:text-neutral-300 select-none group-hover:text-neutral-900 dark:group-hover:text-neutral-100">
                Don't ask me again
              </span>
            </label>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm font-medium text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2 dark:text-neutral-300 dark:hover:text-neutral-100 dark:hover:bg-neutral-800 dark:focus:ring-neutral-400"
              type="button"
            >
              Cancel
            </button>
            <button
              onClick={handleQuit}
              className="px-4 py-2 text-sm font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 dark:focus:ring-neutral-400"
              type="button"
              autoFocus
            >
              Quit
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
