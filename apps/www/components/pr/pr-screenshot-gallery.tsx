"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@cmux/convex/api";
import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut, X } from "lucide-react";
import type { FunctionReturnType } from "convex/server";

import { cn } from "@/lib/utils";

type ScreenshotSet = FunctionReturnType<
  typeof api.github_pr_queries.listScreenshotSetsForPr
>[number];

type ScreenshotGalleryProps = {
  screenshotSets: ScreenshotSet[];
  className?: string;
};

const STATUS_STYLES: Record<
  ScreenshotSet["status"],
  { label: string; className: string }
> = {
  completed: {
    label: "Completed",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  failed: {
    label: "Failed",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
  skipped: {
    label: "Skipped",
    className: "border-neutral-200 bg-neutral-100 text-neutral-700",
  },
};

function formatRelativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) {
    return "Unknown";
  }

  const now = Date.now();
  const diffInSeconds = Math.round((timestamp - now) / 1000);

  const segments: {
    threshold: number;
    divisor: number;
    unit: Intl.RelativeTimeFormatUnit;
  }[] = [
    { threshold: 45, divisor: 1, unit: "second" },
    { threshold: 2700, divisor: 60, unit: "minute" },
    { threshold: 64_800, divisor: 3_600, unit: "hour" },
    { threshold: 561_600, divisor: 86_400, unit: "day" },
    { threshold: 2_419_200, divisor: 604_800, unit: "week" },
    { threshold: 28_512_000, divisor: 2_629_746, unit: "month" },
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  for (const segment of segments) {
    if (Math.abs(diffInSeconds) < segment.threshold) {
      const value = Math.round(diffInSeconds / segment.divisor);
      return formatter.format(value, segment.unit);
    }
  }

  const years = Math.round(diffInSeconds / 31_556_952);
  return formatter.format(years, "year");
}

export function PrScreenshotGallery({
  screenshotSets,
  className,
}: ScreenshotGalleryProps) {
  const sortedSets = useMemo(() => {
    return [...screenshotSets].sort((a, b) => {
      const aTimestamp = a.capturedAt ?? a.createdAt ?? 0;
      const bTimestamp = b.capturedAt ?? b.createdAt ?? 0;
      return bTimestamp - aTimestamp;
    });
  }, [screenshotSets]);

  const imageEntries = useMemo(() => {
    const entries: Array<{
      set: ScreenshotSet;
      image: ScreenshotSet["images"][number];
      indexInSet: number;
      key: string;
    }> = [];

    sortedSets.forEach((set) => {
      set.images.forEach((image, indexInSet) => {
        if (!image.url) {
          return;
        }

        entries.push({
          set,
          image,
          indexInSet,
          key: `${set._id}:${indexInSet}`,
        });
      });
    });

    return entries;
  }, [sortedSets]);

  const [activeKey, setActiveKey] = useState<string | null>(
    imageEntries[0]?.key ?? null
  );
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxZoom, setLightboxZoom] = useState(1);

  useEffect(() => {
    if (imageEntries.length === 0) {
      setActiveKey(null);
      setIsLightboxOpen(false);
      return;
    }

    if (activeKey && imageEntries.some((entry) => entry.key === activeKey)) {
      return;
    }

    setActiveKey(imageEntries[0]?.key ?? null);
  }, [activeKey, imageEntries]);

  const activeEntry = useMemo(() => {
    if (!activeKey) {
      return imageEntries[0] ?? null;
    }
    return imageEntries.find((entry) => entry.key === activeKey) ?? null;
  }, [activeKey, imageEntries]);

  const goToEntryByDelta = useCallback(
    (delta: number) => {
      if (imageEntries.length === 0) {
        return;
      }

      const currentIndex = imageEntries.findIndex(
        (entry) => entry.key === (activeEntry?.key ?? activeKey)
      );
      const safeIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex =
        (safeIndex + delta + imageEntries.length) % imageEntries.length;
      const nextEntry = imageEntries[nextIndex];
      if (nextEntry) {
        setActiveKey(nextEntry.key);
      }
    },
    [activeEntry?.key, activeKey, imageEntries]
  );

  const handleOpenLightbox = useCallback((key: string) => {
    setActiveKey(key);
    setIsLightboxOpen(true);
    setLightboxZoom(1);
  }, []);

  useEffect(() => {
    if (!isLightboxOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsLightboxOpen(false);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goToEntryByDelta(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToEntryByDelta(-1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToEntryByDelta, isLightboxOpen]);

  const handleZoom = useCallback((direction: "in" | "out") => {
    setLightboxZoom((previous) => {
      const delta = direction === "in" ? 0.2 : -0.2;
      const next = Math.min(4, Math.max(0.4, previous + delta));
      return Number.isFinite(next) ? next : 1;
    });
  }, []);

  const latestTimestamp = useMemo(() => {
    const topSet = sortedSets[0];
    return topSet?.capturedAt ?? topSet?.createdAt ?? null;
  }, [sortedSets]);

  if (imageEntries.length === 0) {
    return null;
  }

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-amber-100 bg-gradient-to-r from-amber-50 via-yellow-50 to-orange-50 px-4 py-3">
        <div className="space-y-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            Screenshots
          </p>
          <p className="text-sm text-neutral-700">
            Latest capture {formatRelativeTime(latestTimestamp)}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-700">
          <span className="rounded-full border border-amber-200 bg-white/80 px-2 py-1 font-semibold text-amber-700">
            {imageEntries.length} {imageEntries.length === 1 ? "image" : "images"}
          </span>
          <span className="rounded-full border border-neutral-200 bg-white/70 px-2 py-1 font-medium text-neutral-600">
            {sortedSets.length} {sortedSets.length === 1 ? "capture" : "captures"}
          </span>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {activeEntry ? (
          <div className="group relative overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 shadow-[0_12px_48px_-24px_rgba(0,0,0,0.25)]">
            <button
              type="button"
              onClick={() => handleOpenLightbox(activeEntry.key)}
              className="block w-full"
            >
              <img
                src={activeEntry.image.url ?? ""}
                alt={activeEntry.image.fileName ?? "Screenshot"}
                className="max-h-[440px] w-full bg-white object-contain"
              />
            </button>
            <div className="pointer-events-none absolute left-3 bottom-3 flex flex-wrap items-center gap-2 rounded-full bg-white/85 px-3 py-1 text-xs text-neutral-700 shadow-md backdrop-blur">
              <span className="font-semibold text-amber-700">
                {STATUS_STYLES[activeEntry.set.status].label}
              </span>
              <span className="text-neutral-500">•</span>
              <span>{formatRelativeTime(activeEntry.set.capturedAt ?? activeEntry.set.createdAt)}</span>
              {activeEntry.image.description ? (
                <>
                  <span className="text-neutral-500">•</span>
                  <span className="line-clamp-1 max-w-[360px] text-neutral-600">
                    {activeEntry.image.description}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex gap-2 overflow-x-auto pb-1">
          {imageEntries.map((entry) => {
            const statusStyle = STATUS_STYLES[entry.set.status];
            const isActive = activeEntry?.key === entry.key;
            return (
              <button
                type="button"
                key={entry.key}
                onClick={() => setActiveKey(entry.key)}
                className={cn(
                  "group relative min-w-[160px] max-w-[200px] overflow-hidden rounded-lg border text-left transition hover:-translate-y-[1px] hover:border-amber-200 hover:shadow-md",
                  isActive
                    ? "border-amber-300 shadow-md shadow-amber-100"
                    : "border-neutral-200 bg-white"
                )}
              >
                <div className="relative aspect-video overflow-hidden bg-neutral-50">
                  <img
                    src={entry.image.url ?? ""}
                    alt={entry.image.fileName ?? "Screenshot thumbnail"}
                    className="h-full w-full object-cover"
                  />
                  <span
                    className={cn(
                      "absolute left-2 top-2 rounded-full border px-2 py-[3px] text-[11px] font-semibold backdrop-blur",
                      statusStyle.className
                    )}
                  >
                    {statusStyle.label}
                  </span>
                </div>
                <div className="space-y-1 px-3 py-2">
                  <div className="line-clamp-1 text-sm font-semibold text-neutral-800">
                    {entry.image.fileName ?? "Screenshot"}
                  </div>
                  <p className="line-clamp-2 text-xs text-neutral-600">
                    {entry.image.description ?? "Captured for this PR"}
                  </p>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                    Image {entry.indexInSet + 1} of {entry.set.images.length}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {isLightboxOpen && activeEntry ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/60 px-4 py-6 backdrop-blur-sm">
          <div className="relative flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
              <div className="min-w-0 space-y-1">
                <p className="truncate text-base font-semibold text-neutral-900">
                  {activeEntry.image.fileName ?? "Screenshot"}
                </p>
                <p className="text-xs text-neutral-600">
                  {formatRelativeTime(
                    activeEntry.set.capturedAt ?? activeEntry.set.createdAt
                  )}
                  {activeEntry.image.description ? " • " : null}
                  <span className="line-clamp-1 align-middle">
                    {activeEntry.image.description ?? ""}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs font-medium text-neutral-700 shadow-inner">
                  <button
                    type="button"
                    className="rounded-full p-1 transition hover:bg-white"
                    onClick={() => handleZoom("out")}
                    aria-label="Zoom out"
                  >
                    <ZoomOut className="h-4 w-4" />
                  </button>
                  <span className="min-w-[3rem] text-center tabular-nums">
                    {Math.round(lightboxZoom * 100)}%
                  </span>
                  <button
                    type="button"
                    className="rounded-full p-1 transition hover:bg-white"
                    onClick={() => handleZoom("in")}
                    aria-label="Zoom in"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                </div>
                <a
                  href={activeEntry.image.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:text-neutral-900"
                >
                  <Maximize2 className="h-3.5 w-3.5" /> Open original
                </a>
                <button
                  type="button"
                  onClick={() => setIsLightboxOpen(false)}
                  className="rounded-full p-2 text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="relative flex min-h-[60vh] items-center justify-center bg-neutral-50">
              {imageEntries.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => goToEntryByDelta(-1)}
                    className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full border border-neutral-200 bg-white/90 p-2 text-neutral-700 shadow-md transition hover:-translate-y-1/2 hover:bg-white"
                    aria-label="Previous screenshot"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => goToEntryByDelta(1)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full border border-neutral-200 bg-white/90 p-2 text-neutral-700 shadow-md transition hover:-translate-y-1/2 hover:bg-white"
                    aria-label="Next screenshot"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              ) : null}

              <div className="max-h-[70vh] w-full overflow-auto p-4">
                <img
                  src={activeEntry.image.url ?? ""}
                  alt={activeEntry.image.fileName ?? "Screenshot"}
                  className="mx-auto max-h-[66vh] w-auto max-w-full rounded-md shadow-lg"
                  style={{
                    transform: `scale(${lightboxZoom})`,
                    transformOrigin: "center",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
