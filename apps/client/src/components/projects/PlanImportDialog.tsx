import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation } from "@tanstack/react-query";
import { postApiIntegrationsGithubProjectsDraftsBatch } from "@cmux/www-openapi-client";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  parsePlanMarkdown,
  type ParsedPlanItem,
} from "@/lib/parse-plan-markdown";

interface ProjectOption {
  id: string;
  title: string;
}

interface PlanImportDialogProps {
  teamSlugOrId: string;
  installationId?: number;
  projects: ProjectOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

function truncateBody(body: string, maxLength = 140): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

export function PlanImportDialog({
  teamSlugOrId,
  installationId,
  projects,
  open,
  onOpenChange,
  onImported,
}: PlanImportDialogProps) {
  const [markdown, setMarkdown] = useState("");
  const [parsedItems, setParsedItems] = useState<ParsedPlanItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedItemIndexes, setSelectedItemIndexes] = useState<Set<number>>(
    new Set(),
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    if (
      selectedProjectId &&
      projects.some((project) => project.id === selectedProjectId)
    ) {
      return;
    }
    setSelectedProjectId(projects[0]?.id ?? "");
  }, [open, projects, selectedProjectId]);

  const selectedItems = useMemo(
    () => parsedItems.filter((_, index) => selectedItemIndexes.has(index)),
    [parsedItems, selectedItemIndexes],
  );

  const importMutation = useMutation({
    mutationFn: async (items: ParsedPlanItem[]) => {
      if (!installationId) {
        throw new Error("GitHub installation not connected");
      }
      if (!selectedProjectId) {
        throw new Error("Select a project first");
      }

      const response = await postApiIntegrationsGithubProjectsDraftsBatch({
        query: {
          team: teamSlugOrId,
          installationId,
        },
        body: {
          projectId: selectedProjectId,
          items: items.map((item) => ({
            title: item.title,
            body: item.body || undefined,
          })),
        },
      });

      return response.data?.results ?? [];
    },
  });

  const resetDialogState = () => {
    setMarkdown("");
    setParsedItems([]);
    setSelectedItemIndexes(new Set());
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      resetDialogState();
    }
  };

  const handleParse = () => {
    const parsed = parsePlanMarkdown(markdown);
    setParsedItems(parsed);
    setSelectedItemIndexes(new Set(parsed.map((_, index) => index)));

    if (parsed.length === 0) {
      toast.error("No plan items found in markdown");
      return;
    }

    toast.success(`Parsed ${parsed.length} item(s)`);
  };

  const handleToggleItem = (index: number, checked: boolean) => {
    setSelectedItemIndexes((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(index);
      } else {
        next.delete(index);
      }
      return next;
    });
  };

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setMarkdown(text);
      setParsedItems([]);
      setSelectedItemIndexes(new Set());
      toast.success(`Loaded ${file.name}`);
    };
    reader.onerror = () => {
      toast.error("Failed to read file");
    };
    reader.readAsText(file);

    // Allow selecting the same file again.
    event.target.value = "";
  };

  const handleImport = async () => {
    if (selectedItems.length === 0) {
      toast.error("Select at least one parsed item to import");
      return;
    }

    const loadingToastId = toast.loading(
      `Importing ${selectedItems.length} item(s)...`,
    );

    try {
      const results = await importMutation.mutateAsync(selectedItems);
      const successCount = results.filter((result) =>
        Boolean(result.itemId),
      ).length;
      const failedCount = results.length - successCount;

      if (failedCount > 0) {
        toast.success(
          `Imported ${successCount} item(s), ${failedCount} failed`,
          { id: loadingToastId },
        );
      } else {
        toast.success(`Imported ${successCount} item(s)`, {
          id: loadingToastId,
        });
      }

      onImported?.();
      handleDialogOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to import plan items",
        { id: loadingToastId },
      );
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleDialogOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-global-blocking)] bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[var(--z-global-blocking)] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-200 bg-white p-6 shadow-xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          <Dialog.Close asChild>
            <button
              type="button"
              className="absolute right-4 top-4 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/40 dark:hover:bg-neutral-800 dark:hover:text-white"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </Dialog.Close>

          <Dialog.Title className="text-lg font-semibold text-neutral-900 dark:text-white">
            Import Plan to GitHub Project
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Paste markdown or upload a <code>.md</code> plan file. Each{" "}
            <code>##</code> section becomes a draft issue.
          </Dialog.Description>

          <div className="mt-5 space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="plan-markdown"
                className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Plan Markdown
              </label>
              <textarea
                id="plan-markdown"
                value={markdown}
                onChange={(event) => setMarkdown(event.target.value)}
                rows={10}
                placeholder="# Plan: Improve onboarding..."
                className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label
                htmlFor="plan-file-upload"
                className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <Upload className="h-4 w-4" />
                Upload .md File
              </label>
              <input
                id="plan-file-upload"
                type="file"
                accept=".md,text/markdown,text/plain"
                className="hidden"
                onChange={handleFileUpload}
              />

              <Button onClick={handleParse} disabled={!markdown.trim()}>
                Parse Plan
              </Button>
            </div>

            {parsedItems.length > 0 && (
              <div className="space-y-3 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                    Preview ({selectedItems.length}/{parsedItems.length}{" "}
                    selected)
                  </div>
                  <div className="min-w-60">
                    <label
                      htmlFor="project-id"
                      className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500"
                    >
                      Target Project
                    </label>
                    <select
                      id="project-id"
                      value={selectedProjectId}
                      onChange={(event) =>
                        setSelectedProjectId(event.target.value)
                      }
                      className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                    >
                      {projects.length === 0 && (
                        <option value="">No projects found</option>
                      )}
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {parsedItems.map((item, index) => {
                    const checked = selectedItemIndexes.has(index);
                    return (
                      <label
                        key={`${item.title}-${index}`}
                        className="flex cursor-pointer items-start gap-3 rounded-md border border-neutral-200 p-3 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            handleToggleItem(index, event.target.checked)
                          }
                          className="mt-1 h-4 w-4 rounded border-neutral-300"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                            {item.title}
                          </p>
                          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                            {item.body.trim().length > 0
                              ? truncateBody(item.body)
                              : "(No body content)"}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Dialog.Close asChild>
              <Button variant="outline">Cancel</Button>
            </Dialog.Close>
            <Button
              onClick={handleImport}
              disabled={
                importMutation.isPending ||
                selectedItems.length === 0 ||
                !selectedProjectId
              }
            >
              {importMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                "Import Selected"
              )}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
