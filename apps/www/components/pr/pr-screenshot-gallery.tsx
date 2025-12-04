"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";
import { api } from "@cmux/convex/api";
import type { FunctionReturnType } from "convex/server";
import { cn } from "@/lib/utils";

type LatestScreenshotSet = NonNullable<
  FunctionReturnType<typeof api.github_pr_queries.getLatestScreenshotSetForPr>
>;

type PrScreenshotGalleryProps = {
  screenshotSet: LatestScreenshotSet | null;
  isLoading: boolean;
};

const STATUS_STYLES: Record<
  LatestScreenshotSet["status"],
  { className: string; label: string }
> = {
  completed: {
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
    label: "Completed",
  },
  failed: {
    className:
      "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200",
    label: "Failed",
  },
  skipped: {
    className:
      "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200",
    label: "Skipped",
  },
};

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;

  if (diffMs <= 0) {
    return "just now";
  }

  if (Number.isNaN(diffMs)) {
    return "unknown time";
  }

  const diffSeconds = Math.round(diffMs / 1000);
  const diffMinutes = Math.round(diffSeconds / 60);
  const diffHours = Math.round(diffMinutes / 60);
  const diffDays = Math.round(diffHours / 24);
  const diffWeeks = Math.round(diffDays / 7);
  const diffMonths = Math.round(diffDays / 30);
  const diffYears = Math.round(diffDays / 365);

  if (diffSeconds < 5) return "just now";
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 48) return `${diffHours}h ago`;
  if (diffDays < 14) return `${diffDays}d ago`;
  if (diffWeeks < 8) return `${diffWeeks}w ago`;
  if (diffMonths < 18) return `${diffMonths}mo ago`;
  return `${diffYears}y ago`;
}

function formatCommit(commitSha: string | null | undefined): string {
  if (!commitSha || commitSha.trim().length === 0) {
    return "latest commit";
  }
  return `#${commitSha.slice(0, 7)}`;
}

export function PrScreenshotGallery({
  screenshotSet,
  isLoading,
}: PrScreenshotGalleryProps) {
  const images = useMemo(
    () =>
      (screenshotSet?.images ?? []).filter(
        (image) => typeof image.url === "string" && image.url.trim().length > 0,
      ),
    [screenshotSet],
  );

  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [screenshotSet?._id]);

  useEffect(() => {
    if (activeIndex < images.length) {
      return;
    }
    setActiveIndex(images.length === 0 ? 0 : images.length - 1);
  }, [activeIndex, images.length]);

  const activeImage = images.length > 0 ? images[activeIndex] ?? null : null;

  const handlePrevious = useCallback(() => {
    if (images.length === 0) return;
    setActiveIndex((previous) =>
      previous === 0 ? images.length - 1 : previous - 1,
    );
  }, [images.length]);

  const handleNext = useCallback(() => {
    if (images.length === 0) return;
    setActiveIndex((previous) =>
      previous === images.length - 1 ? 0 : previous + 1,
    );
  }, [images.length]);

  const statusStyles = screenshotSet
    ? STATUS_STYLES[screenshotSet.status]
    : null;

  return (
    <section className="border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Latest screenshots
          </p>
          {statusStyles ? (
            <span
              className={cn(
                "rounded px-2 py-1 text-xs font-semibold",
                statusStyles.className,
              )}
            >
              {statusStyles.label}
            </span>
          ) : null}
        </div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          {screenshotSet
            ? `${formatCommit(screenshotSet.commitSha)} · ${formatRelativeTime(
                screenshotSet.capturedAt,
              )}`
            : isLoading
              ? "Loading screenshots..."
              : "No screenshots yet"}
        </div>
      </div>

      {isLoading ? (
        <div className="mt-3 h-48 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-900" />
      ) : screenshotSet === null ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-4 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          <ImageIcon className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            No screenshot set has been captured for this pull request yet.
          </span>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {screenshotSet.status === "failed" && screenshotSet.error ? (
            <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              <span>{screenshotSet.error}</span>
            </div>
          ) : null}
          {screenshotSet.status === "skipped" &&
          screenshotSet.hasUiChanges === false ? (
            <div className="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              <span>Model marked this PR as having no UI changes.</span>
            </div>
          ) : null}

          <div className="relative overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
            {activeImage ? (
              <img
                src={activeImage.url ?? ""}
                alt={
                  activeImage.description ??
                  activeImage.fileName ??
                  "Screenshot"
                }
                className="h-full w-full bg-white object-contain dark:bg-neutral-950"
                loading="lazy"
              />
            ) : (
              <div className="flex h-56 items-center justify-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                <ImageIcon className="h-5 w-5" aria-hidden />
                <span>No images in the latest screenshot set.</span>
              </div>
            )}

            {images.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={handlePrevious}
                  className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-neutral-700 shadow transition hover:bg-white dark:bg-neutral-900/90 dark:text-neutral-100"
                  aria-label="Previous screenshot"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-neutral-700 shadow transition hover:bg-white dark:bg-neutral-900/90 dark:text-neutral-100"
                  aria-label="Next screenshot"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </>
            ) : null}
          </div>

          {images.length > 1 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {images.map((image, index) => (
                <button
                  type="button"
                  key={`${image.storageId}:${index}`}
                  className={cn(
                    "group relative h-16 w-28 flex-none overflow-hidden rounded border",
                    index === activeIndex
                      ? "border-sky-500 ring-1 ring-sky-500"
                      : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700",
                  )}
                  onClick={() => setActiveIndex(index)}
                  aria-label={`Screenshot ${index + 1}`}
                >
                  <img
                    src={image.url ?? ""}
                    alt={image.fileName ?? `Screenshot ${index + 1}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-neutral-900/0 transition group-hover:bg-neutral-900/10" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
