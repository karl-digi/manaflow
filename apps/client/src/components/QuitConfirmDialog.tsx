import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface QuitConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function QuitConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
}: QuitConfirmDialogProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const handleConfirm = useCallback(() => {
    if (dontShowAgain) {
      window.cmux?.quitDialog?.setDontShowAgain?.(true);
    }
    onConfirm();
  }, [dontShowAgain, onConfirm]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    const handleEnter = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        handleConfirm();
      }
    };

    document.addEventListener("keydown", handleEscape, { capture: true });
    document.addEventListener("keydown", handleEnter, { capture: true });

    return () => {
      document.removeEventListener("keydown", handleEscape, { capture: true });
      document.removeEventListener("keydown", handleEnter, { capture: true });
    };
  }, [isOpen, onClose, handleConfirm]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quit-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="relative mx-4 w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-gray-800 px-6 py-4">
          <h2
            id="quit-dialog-title"
            className="text-lg font-semibold text-gray-100"
          >
            Quit CMUX?
          </h2>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          <p className="text-sm text-gray-300">
            Are you sure you want to quit? Any unsaved changes may be lost.
          </p>

          {/* Checkbox */}
          <label className="mt-5 flex cursor-pointer select-none items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-gray-800/50">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="h-4 w-4 cursor-pointer rounded border-gray-600 bg-gray-800 text-blue-500 transition-all focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
              aria-label="Don't show this dialog again"
            />
            <span className="text-sm text-gray-400">
              Don't show this again
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-gray-800 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-600 focus:ring-offset-2 focus:ring-offset-gray-900"
            aria-label="Cancel and return to application"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
            aria-label="Quit application"
            autoFocus
          >
            Quit
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
