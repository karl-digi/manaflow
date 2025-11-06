import * as Dialog from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { STORAGE_KEY } from "@/lib/quit-preferences"

interface QuitConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function QuitConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: QuitConfirmDialogProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false)

  const handleConfirm = () => {
    if (dontAskAgain) {
      localStorage.setItem(STORAGE_KEY, "true")
    }
    onOpenChange(false)
    onConfirm()
  }

  const handleCancel = useCallback(() => {
    onOpenChange(false)
    setDontAskAgain(false)
  }, [onOpenChange])

  // Handle Escape key
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCancel()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, handleCancel])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[var(--z-popover)] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-200 bg-white p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] dark:border-neutral-800 dark:bg-neutral-900"
          aria-describedby="quit-dialog-description"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <Dialog.Title className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                Quit cmux?
              </Dialog.Title>
              <Dialog.Description
                id="quit-dialog-description"
                className="mt-2 text-sm text-neutral-600 dark:text-neutral-400"
              >
                Are you sure you want to quit? All active sessions will be
                closed.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-neutral-950 focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-neutral-100 data-[state=open]:text-neutral-500 dark:ring-offset-neutral-950 dark:focus:ring-neutral-300 dark:data-[state=open]:bg-neutral-800 dark:data-[state=open]:text-neutral-400"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="mt-4">
            <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input
                type="checkbox"
                checked={dontAskAgain}
                onChange={(e) => setDontAskAgain(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-2 focus:ring-neutral-950 focus:ring-offset-2 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:ring-neutral-300 dark:focus:ring-offset-neutral-950"
                aria-label="Don't ask again when quitting"
              />
              <span>Don't ask again</span>
            </label>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={handleCancel}
              className="inline-flex h-10 items-center justify-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-900 ring-offset-white transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:ring-offset-neutral-950 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 dark:focus-visible:ring-neutral-300"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="inline-flex h-10 items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-50 ring-offset-white transition-colors hover:bg-neutral-900/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 dark:bg-neutral-50 dark:text-neutral-900 dark:ring-offset-neutral-950 dark:hover:bg-neutral-50/90 dark:focus-visible:ring-neutral-300"
              autoFocus
            >
              Quit
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
