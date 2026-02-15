import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  onConfirm,
}: ConfirmDialogProps) {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-global-blocking)] bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[var(--z-global-blocking)] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-200 bg-white p-6 shadow-xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          {/* Close button */}
          <Dialog.Close asChild>
            <button
              type="button"
              className="absolute right-4 top-4 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:hover:bg-neutral-800 dark:hover:text-white"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </Dialog.Close>

          {/* Icon and Content */}
          <div className="flex flex-col items-center text-center">
            {/* Icon - neutral styling to match app theme */}
            <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              <AlertTriangle className="size-6" />
            </div>

            {/* Title */}
            <Dialog.Title className="text-base font-semibold text-neutral-900 dark:text-white">
              {title}
            </Dialog.Title>

            {/* Description */}
            <Dialog.Description className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              {description}
            </Dialog.Description>
          </div>

          {/* Actions - neutral styling to match app theme */}
          <div className="mt-6 flex gap-3">
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex-1 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {cancelLabel}
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={handleConfirm}
              className="flex-1 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
