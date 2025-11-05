import { Button } from "@/components/ui/button";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

interface ImportRepoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (repoFullName: string) => void;
  extractGitHubRepoFromUrl: (url: string) => string | null;
}

export function ImportRepoDialog({
  open,
  onOpenChange,
  onImport,
  extractGitHubRepoFromUrl,
}: ImportRepoDialogProps) {
  const [repoUrl, setRepoUrl] = useState("");

  useEffect(() => {
    if (!open) {
      setRepoUrl("");
    }
  }, [open]);

  const handleImport = useCallback(() => {
    const trimmed = repoUrl.trim();
    if (!trimmed) {
      toast.error("Please enter a GitHub repository URL");
      return;
    }

    const repoFullName = extractGitHubRepoFromUrl(trimmed);
    if (!repoFullName) {
      toast.error("Invalid GitHub URL. Please use format: https://github.com/owner/repo");
      return;
    }

    onImport(repoFullName);
    setRepoUrl("");
    onOpenChange(false);
  }, [repoUrl, extractGitHubRepoFromUrl, onImport, onOpenChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleImport();
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-neutral-950/50 backdrop-blur-sm z-[var(--z-modal)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 z-[var(--z-modal)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                Import Repository
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                Paste a GitHub repository URL to create a new environment with that repo.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-full p-2 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="repo-url"
                className="text-sm font-medium text-neutral-800 dark:text-neutral-200"
              >
                GitHub Repository URL
              </label>
              <input
                id="repo-url"
                type="text"
                placeholder="https://github.com/owner/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 shadow-xs transition focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Supports formats: https://github.com/owner/repo, git@github.com:owner/repo.git, or github.com/owner/repo
              </p>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setRepoUrl("");
                  onOpenChange(false);
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleImport}>Import</Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
