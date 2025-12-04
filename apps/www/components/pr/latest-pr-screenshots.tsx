"use client";

import { useCallback, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { formatDistanceToNow } from "date-fns";
import { useConvexQuery } from "@convex-dev/react-query";
import type { FunctionReturnType } from "convex/server";
import { api } from "@cmux/convex/api";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  X,
} from "lucide-react";

type LatestScreenshotSet = NonNullable<
  FunctionReturnType<typeof api.taskRuns.getLatestScreenshotSetForPr>
>;

type LatestPrScreenshotsProps = {
  teamSlugOrId: string;
  repoFullName: string;
  prNumber?: number | null;
};

const STATUS_LABELS: Record<LatestScreenshotSet["status"], string> = {
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};

const STATUS_STYLES: Record<LatestScreenshotSet["status"], string> = {
  completed:
    "bg-emerald-100/80 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  failed:
    "bg-rose-100/80 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200",
  skipped:
    "bg-neutral-200/80 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200",
};

export function LatestPrScreenshots({
  teamSlugOrId,
  repoFullName,
  prNumber,
}: LatestPrScreenshotsProps) {
  const queryArgs = useMemo(() => {
    const hasTeam = teamSlugOrId.trim().length > 0;
    const hasRepo = repoFullName.trim().length > 0;
    const hasPrNumber =
      typeof prNumber === "number" && Number.isFinite(prNumber);

    if (!hasTeam || !hasRepo || !hasPrNumber) {
      return "skip" as const;
    }

    return {
      teamSlugOrId,
      repoFullName: repoFullName.trim(),
      prNumber,
    };
  }, [prNumber, repoFullName, teamSlugOrId]);

  const latestSet = useConvexQuery(
    api.taskRuns.getLatestScreenshotSetForPr,
    queryArgs
  );

  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const handlePrevious = useCallback(() => {
    if (!latestSet || !latestSet.images.length) {
      return;
    }
    setActiveIndex((prev) => {
      const nextIndex =
        typeof prev === "number" && prev > 0
          ? prev - 1
          : latestSet.images.length - 1;
      return nextIndex;
    });
  }, [latestSet]);

  const handleNext = useCallback(() => {
    if (!latestSet || !latestSet.images.length) {
      return;
    }
    setActiveIndex((prev) => {
      const safePrev = typeof prev === "number" ? prev : 0;
      return (safePrev + 1) % latestSet.images.length;
    });
  }, [latestSet]);

  if (queryArgs === "skip") {
    return null;
  }

  if (latestSet === undefined) {
    return (
      <section className="border border-neutral-200 bg-white p-4">
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>Loading screenshots…</span>
        </div>
      </section>
    );
  }

  if (!latestSet) {
    return (
      <section className="border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-neutral-900">
              Latest screenshots
            </h2>
            <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-700">
              Not available
            </span>
          </div>
          <p className="text-xs text-neutral-500">
            We&apos;ll show new captures here as soon as they arrive.
          </p>
        </div>
      </section>
    );
  }

  const capturedAt = new Date(latestSet.capturedAt);
  const capturedLabel = formatDistanceToNow(capturedAt, { addSuffix: true });
  const imageCount = latestSet.images.length;
  const isDialogOpen = activeIndex !== null && imageCount > 0;
  const currentImage =
    isDialogOpen && activeIndex !== null
      ? latestSet.images[activeIndex] ?? null
      : null;
  const hasMultipleImages = imageCount > 1;
  const commitLabel =
    latestSet.commitSha && latestSet.commitSha.trim().length > 0
      ? latestSet.commitSha.slice(0, 12)
      : null;
  const totalImages = latestSet.images.length;

  return (
    <section className="border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-neutral-900">
            Latest screenshots
          </h2>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              STATUS_STYLES[latestSet.status]
            )}
          >
            {STATUS_LABELS[latestSet.status]}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
          <span title={capturedAt.toLocaleString()}>{capturedLabel}</span>
          {commitLabel ? (
            <>
              <span className="text-neutral-400">•</span>
              <span className="font-mono text-neutral-700">
                {commitLabel.toLowerCase()}
              </span>
            </>
          ) : null}
          {latestSet.images.length > 0 ? (
            <>
              <span className="text-neutral-400">•</span>
              <span>
                {totalImages} {totalImages === 1 ? "image" : "images"}
              </span>
            </>
          ) : null}
        </div>
      </div>

      {latestSet.images.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-600">
          No screenshots were captured for the latest run of this pull request.
          They will appear here automatically when available.
        </p>
      ) : (
        <>
          <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
            {latestSet.images.map((image, index) => {
              const label = image.fileName ?? `Screenshot ${index + 1}`;
              const url = image.url ?? undefined;
              if (!url) {
                return (
                  <div
                    key={`${latestSet._id}-${index}`}
                    className="flex h-40 w-[200px] flex-shrink-0 items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-100 text-xs text-neutral-500"
                  >
                    URL expired
                  </div>
                );
              }

              return (
                <button
                  key={`${latestSet._id}-${index}`}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  className="group relative flex w-[220px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 text-left transition hover:border-neutral-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
                  aria-label={`Open ${label}`}
                >
                  <img
                    src={url}
                    alt={label}
                    className="h-40 w-[220px] object-contain bg-neutral-100"
                    loading="lazy"
                  />
                  <div className="absolute top-2 right-2 text-neutral-600 opacity-0 transition group-hover:opacity-100">
                    <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                  </div>
                  <div className="border-t border-neutral-200 px-2 py-1 text-xs text-neutral-700 truncate">
                    {index + 1}. {label}
                  </div>
                </button>
              );
            })}
          </div>

          <Dialog.Root
            open={Boolean(isDialogOpen)}
            onOpenChange={(open) => {
              if (!open) {
                setActiveIndex(null);
              }
            }}
          >
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 bg-neutral-950/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out" />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-[var(--z-floating-high)] flex max-h-[calc(100vh-4rem)] w-[min(1800px,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-3xl border border-neutral-200 bg-white/95 p-4 shadow-2xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-950/95 sm:max-h-[calc(100vh-5rem)] sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <Dialog.Title className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                      {currentImage?.fileName ?? "Screenshot"}
                    </Dialog.Title>
                    <Dialog.Description className="text-xs text-neutral-600 dark:text-neutral-400">
                      {activeIndex !== null
                        ? `Image ${activeIndex + 1} of ${totalImages}`
                        : null}
                    </Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      onClick={() => setActiveIndex(null)}
                      className="rounded-full p-1.5 text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 dark:text-neutral-300 dark:hover:bg-neutral-800/80 dark:hover:text-neutral-100"
                      aria-label="Close screenshot"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </Dialog.Close>
                </div>

                <div className="flex flex-1 items-center gap-4">
                  {hasMultipleImages ? (
                    <button
                      type="button"
                      onClick={handlePrevious}
                      className="rounded-full border border-neutral-200 bg-white p-2 text-neutral-600 transition hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 dark:border-neutral-700/80 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
                      aria-label="Previous screenshot"
                    >
                      <ChevronLeft className="h-5 w-5" aria-hidden />
                    </button>
                  ) : null}
                  <div className="flex min-h-[320px] flex-1 items-center justify-center overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
                    {currentImage?.url ? (
                      <img
                        src={currentImage.url}
                        alt={currentImage.fileName ?? "Screenshot"}
                        className="max-h-[70vh] w-full max-w-[90vw] object-contain"
                      />
                    ) : (
                      <div className="px-6 py-8 text-sm text-neutral-600">
                        Image URL expired
                      </div>
                    )}
                  </div>
                  {hasMultipleImages ? (
                    <button
                      type="button"
                      onClick={handleNext}
                      className="rounded-full border border-neutral-200 bg-white p-2 text-neutral-600 transition hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 dark:border-neutral-700/80 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
                      aria-label="Next screenshot"
                    >
                      <ChevronRight className="h-5 w-5" aria-hidden />
                    </button>
                  ) : null}
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </>
      )}
    </section>
  );
}
