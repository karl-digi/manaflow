import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/icons/github";
import * as Dialog from "@radix-ui/react-dialog";
import { useUser } from "@stackframe/react";
import { X, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";

interface GitHubConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}

/**
 * Dialog prompting users who signed up with email/password to connect their GitHub account.
 * This is required before they can install the GitHub App to add repos.
 */
export function GitHubConnectionDialog({
  open,
  onOpenChange,
  onConnected,
}: GitHubConnectionDialogProps) {
  const user = useUser({ or: "return-null" });
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = useCallback(async () => {
    if (!user) {
      setError("You must be signed in to connect GitHub.");
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      // This will redirect to GitHub OAuth if not connected
      // The { or: 'redirect' } option handles the OAuth flow automatically
      await user.getConnectedAccount("github", { or: "redirect" });

      // If we get here, the account is already connected (no redirect happened)
      onConnected();
      onOpenChange(false);
    } catch (err) {
      console.error("[GitHubConnectionDialog] Failed to connect GitHub:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to connect GitHub account. Please try again."
      );
      setIsConnecting(false);
    }
  }, [user, onConnected, onOpenChange]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isConnecting) {
        return;
      }
      onOpenChange(nextOpen);
    },
    [isConnecting, onOpenChange]
  );

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-neutral-950/50 backdrop-blur-sm z-[var(--z-modal)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 z-[var(--z-modal)]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
                <GitHubIcon className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
              </div>
              <div>
                <Dialog.Title className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                  Connect GitHub
                </Dialog.Title>
                <Dialog.Description className="text-sm text-neutral-600 dark:text-neutral-400">
                  Link your GitHub account to continue
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-full p-2 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                disabled={isConnecting}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-6 space-y-4">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              To add repositories from GitHub, you need to connect your GitHub account first.
              This allows us to access your repositories on your behalf.
            </p>

            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/50">
              <h4 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                What happens next?
              </h4>
              <ul className="mt-2 space-y-1.5 text-sm text-neutral-600 dark:text-neutral-400">
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-neutral-400" />
                  <span>You&apos;ll be redirected to GitHub to authorize access</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-neutral-400" />
                  <span>After authorization, you can install the GitHub App to select repositories</span>
                </li>
              </ul>
            </div>

            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            ) : null}
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            <Dialog.Close asChild>
              <Button
                type="button"
                variant="ghost"
                className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-50"
                disabled={isConnecting}
              >
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              type="button"
              onClick={handleConnect}
              disabled={isConnecting}
              className="gap-2"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <GitHubIcon className="h-4 w-4" />
                  Connect GitHub
                </>
              )}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
