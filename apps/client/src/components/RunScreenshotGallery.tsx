import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Id } from "@cmux/convex/dataModel";

type ScreenshotStatus = "completed" | "failed" | "skipped";

interface ScreenshotImage {
  storageId: Id<"_storage">;
  mimeType: string;
  fileName?: string | null;
  commitSha?: string | null;
  url?: string | null;
}

interface RunScreenshotSet {
  _id: Id<"taskRunScreenshotSets">;
  taskId: Id<"tasks">;
  runId: Id<"taskRuns">;
  status: ScreenshotStatus;
  commitSha?: string | null;
  capturedAt: number;
  error?: string | null;
  images: ScreenshotImage[];
}

interface RunScreenshotGalleryProps {
  screenshotSets: RunScreenshotSet[];
  highlightedSetId?: Id<"taskRunScreenshotSets"> | null;
}

const STATUS_LABELS: Record<ScreenshotStatus, string> = {
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};

const STATUS_STYLES: Record<ScreenshotStatus, string> = {
  completed:
    "bg-emerald-100/70 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  failed: "bg-rose-100/70 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  skipped:
    "bg-neutral-200/70 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

const ZOOM_DEFAULT = 1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_WHEEL_STEP = 0.15;
const ZOOM_BUTTON_STEP = 0.25;

const clampValue = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getImageKey = (
  setId: Id<"taskRunScreenshotSets">,
  image: ScreenshotImage,
  indexInSet: number,
) => `${setId}:${image.storageId}:${indexInSet}`;

export function RunScreenshotGallery(props: RunScreenshotGalleryProps) {
  const { screenshotSets, highlightedSetId } = props;
  const sortedScreenshotSets = useMemo(
    () =>
      [...screenshotSets].sort((a, b) => {
        if (a.capturedAt === b.capturedAt) {
          return a._id.localeCompare(b._id);
        }
        return a.capturedAt - b.capturedAt;
      }),
    [screenshotSets],
  );

  const flattenedImages = useMemo(() => {
    const entries: Array<{
      set: RunScreenshotSet;
      image: ScreenshotImage;
      indexInSet: number;
      key: string;
      globalIndex: number;
    }> = [];
    sortedScreenshotSets.forEach((set) => {
      set.images.forEach((image, indexInSet) => {
        if (!image.url) {
          return;
        }
        entries.push({
          set,
          image,
          indexInSet,
          key: getImageKey(set._id, image, indexInSet),
          globalIndex: entries.length,
        });
      });
    });
    return entries;
  }, [sortedScreenshotSets]);

  const globalIndexByKey = useMemo(() => {
    const indexMap = new Map<string, number>();
    flattenedImages.forEach((entry) => {
      indexMap.set(entry.key, entry.globalIndex);
    });
    return indexMap;
  }, [flattenedImages]);

  const [activeImageKey, setActiveImageKey] = useState<string | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const pointerStateRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [translation, setTranslation] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const activeImageIndex =
    activeImageKey !== null ? globalIndexByKey.get(activeImageKey) ?? null : null;
  const currentEntry =
    activeImageIndex !== null &&
      activeImageIndex >= 0 &&
      activeImageIndex < flattenedImages.length
      ? flattenedImages[activeImageIndex]
      : null;

  const activeOverallIndex =
    currentEntry?.globalIndex !== undefined
      ? currentEntry.globalIndex + 1
      : null;

  const effectiveHighlight =
    highlightedSetId ??
    sortedScreenshotSets[sortedScreenshotSets.length - 1]?._id ?? null;

  const isSlideshowOpen = Boolean(currentEntry);
  const currentImageKey = currentEntry?.key ?? null;
  const showNavigation = flattenedImages.length > 1;
  const zoomPercentage = Math.round(zoom * 100);
  const viewerCursorClass =
    zoom > 1 ? (isPanning ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in";

  const tightenTranslation = useCallback(
    (nextZoom: number, next: { x: number; y: number }) => {
      const viewer = viewerRef.current;
      if (!viewer) {
        return next;
      }
      if (nextZoom <= 1) {
        return { x: 0, y: 0 };
      }
      const maxX = ((nextZoom - 1) * viewer.clientWidth) / 2;
      const maxY = ((nextZoom - 1) * viewer.clientHeight) / 2;
      return {
        x: clampValue(next.x, -maxX, maxX),
        y: clampValue(next.y, -maxY, maxY),
      };
    },
    [],
  );

  const setZoomWithTranslation = useCallback(
    (updater: (prev: number) => number) => {
      setZoom((prevZoom) => {
        const nextZoom = clampValue(updater(prevZoom), ZOOM_MIN, ZOOM_MAX);
        if (nextZoom === prevZoom) {
          return prevZoom;
        }
        setTranslation((prev) => tightenTranslation(nextZoom, prev));
        return nextZoom;
      });
    },
    [tightenTranslation],
  );

  const resetZoom = useCallback(() => {
    setZoom(ZOOM_DEFAULT);
    setTranslation({ x: 0, y: 0 });
    setIsPanning(false);
    pointerStateRef.current = null;
  }, []);

  useEffect(() => {
    if (activeImageKey === null) {
      return;
    }
    if (flattenedImages.length === 0 || !globalIndexByKey.has(activeImageKey)) {
      setActiveImageKey(null);
    }
  }, [activeImageKey, flattenedImages.length, globalIndexByKey]);

  useEffect(() => {
    if (!isSlideshowOpen) {
      resetZoom();
    }
  }, [isSlideshowOpen, resetZoom]);

  useEffect(() => {
    if (!currentImageKey || !isSlideshowOpen) {
      return;
    }
    resetZoom();
  }, [currentImageKey, isSlideshowOpen, resetZoom]);

  const closeSlideshow = useCallback(() => {
    setActiveImageKey(null);
    resetZoom();
  }, [resetZoom]);

  const goNext = useCallback(() => {
    if (activeImageIndex === null) {
      return;
    }
    const len = flattenedImages.length;
    if (len <= 1) {
      return;
    }
    const nextIndex = (activeImageIndex + 1) % len;
    setActiveImageKey(flattenedImages[nextIndex]?.key ?? null);
  }, [activeImageIndex, flattenedImages]);

  const goPrev = useCallback(() => {
    if (activeImageIndex === null) {
      return;
    }
    const len = flattenedImages.length;
    if (len <= 1) {
      return;
    }
    const prevIndex = (activeImageIndex - 1 + len) % len;
    setActiveImageKey(flattenedImages[prevIndex]?.key ?? null);
  }, [activeImageIndex, flattenedImages]);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!isSlideshowOpen) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const direction = event.deltaY < 0 ? 1 : -1;
      const magnitude =
        (event.metaKey || event.ctrlKey ? ZOOM_WHEEL_STEP * 1.5 : ZOOM_WHEEL_STEP) *
        direction;
      setZoomWithTranslation((prev) => prev + magnitude);
    },
    [isSlideshowOpen, setZoomWithTranslation],
  );

  const handleZoomIn = useCallback(() => {
    setZoomWithTranslation((prev) => prev + ZOOM_BUTTON_STEP);
  }, [setZoomWithTranslation]);

  const handleZoomOut = useCallback(() => {
    setZoomWithTranslation((prev) => prev - ZOOM_BUTTON_STEP);
  }, [setZoomWithTranslation]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isSlideshowOpen) {
        return;
      }
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      if (zoom <= 1) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerStateRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      setIsPanning(true);
    },
    [isSlideshowOpen, zoom],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!pointerStateRef.current || pointerStateRef.current.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      const deltaX = event.clientX - pointerStateRef.current.x;
      const deltaY = event.clientY - pointerStateRef.current.y;
      pointerStateRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      setTranslation((prev) => tightenTranslation(zoom, { x: prev.x + deltaX, y: prev.y + deltaY }));
    },
    [tightenTranslation, zoom],
  );

  const endPointerInteraction = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerStateRef.current?.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    pointerStateRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  useEffect(() => {
    if (!isSlideshowOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [goNext, goPrev, isSlideshowOpen]);

  if (sortedScreenshotSets.length === 0) {
    return null;
  }

  return (
    <section className="border-b border-neutral-200 bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-950/40">
      <div className="px-3.5 pt-3 pb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Screenshots
        </h2>
        <span className="text-xs text-neutral-600 dark:text-neutral-400">
          {sortedScreenshotSets.length}{" "}
          {sortedScreenshotSets.length === 1 ? "capture" : "captures"}
        </span>
      </div>
      <div className="px-3.5 pb-4 space-y-4">
        {currentEntry ? (
          <Dialog.Root
            open={isSlideshowOpen}
            onOpenChange={(open) => !open && closeSlideshow()}
          >
            <Dialog.Portal>
              <Dialog.Overlay
                className="fixed inset-0 bg-neutral-950/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out"
                onClick={closeSlideshow}
              />
              <Dialog.Content
                className="fixed inset-0 flex items-center justify-center p-4 sm:p-6 focus:outline-none"
                onPointerDownOutside={() => {
                  closeSlideshow();
                }}
              >
                <div
                  className="relative flex h-[90vh] w-full flex-col gap-4 rounded-3xl border border-neutral-200 bg-white p-4 shadow-2xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-950 sm:p-6"
                  style={{ maxWidth: "min(95vw, 1600px)" }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <Dialog.Title className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                        {activeOverallIndex !== null
                          ? `${activeOverallIndex}. `
                          : ""}
                        {currentEntry.image.fileName ?? "Screenshot"}
                      </Dialog.Title>
                      <Dialog.Description className="text-xs text-neutral-600 dark:text-neutral-400">
                        Image {currentEntry.indexInSet + 1} of {currentEntry.set.images.length}
                        <span className="px-1 text-neutral-400 dark:text-neutral-600">•</span>
                        {formatDistanceToNow(new Date(currentEntry.set.capturedAt), {
                          addSuffix: true,
                        })}
                      </Dialog.Description>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-100">
                        {zoomPercentage}%
                      </div>
                      <div className="flex overflow-hidden rounded-full border border-neutral-200 dark:border-neutral-700">
                        <button
                          type="button"
                          onClick={handleZoomOut}
                          className="flex h-8 w-8 items-center justify-center bg-white text-neutral-600 transition hover:bg-neutral-50 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                          aria-label="Zoom out"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={handleZoomIn}
                          className="flex h-8 w-8 items-center justify-center bg-white text-neutral-600 transition hover:bg-neutral-50 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                          aria-label="Zoom in"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={resetZoom}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 text-neutral-600 transition hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 dark:border-neutral-700 dark:text-neutral-300 dark:hover:text-neutral-100"
                        aria-label="Reset zoom"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                      <Dialog.Close asChild>
                        <button
                          type="button"
                          onClick={closeSlideshow}
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 text-neutral-600 transition hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 dark:border-neutral-700 dark:text-neutral-300 dark:hover:text-neutral-100"
                          aria-label="Close slideshow"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </Dialog.Close>
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-1 items-stretch gap-4">
                    {showNavigation ? (
                      <button
                        type="button"
                        onClick={goPrev}
                        className="flex h-12 w-12 items-center justify-center rounded-full border border-neutral-200 bg-white/95 text-neutral-700 shadow-lg transition hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-200 dark:hover:text-neutral-100"
                        aria-label="Previous screenshot"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                    ) : null}
                    <div className="flex min-h-0 flex-1 flex-col gap-2">
                      <div
                        ref={viewerRef}
                        className={cn(
                          "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 p-2 text-neutral-900 transition-colors dark:border-neutral-800 dark:bg-neutral-900 touch-none",
                          viewerCursorClass,
                        )}
                        onWheel={handleWheel}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={endPointerInteraction}
                        onPointerLeave={endPointerInteraction}
                        onPointerCancel={endPointerInteraction}
                        onDoubleClick={resetZoom}
                      >
                        <img
                          src={currentEntry.image.url ?? undefined}
                          alt={currentEntry.image.fileName ?? "Screenshot"}
                          className="pointer-events-none max-h-full max-w-full select-none object-contain"
                          draggable={false}
                          style={{
                            transform: `translate3d(${translation.x}px, ${translation.y}px, 0) scale(${zoom})`,
                            transition: isPanning ? "none" : "transform 120ms ease-out",
                            transformOrigin: "center center",
                          }}
                        />
                      </div>
                      <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
                        Scroll or pinch to zoom, drag to pan, double-click to reset.
                      </p>
                    </div>
                    {showNavigation ? (
                      <button
                        type="button"
                        onClick={goNext}
                        className="flex h-12 w-12 items-center justify-center rounded-full border border-neutral-200 bg-white/95 text-neutral-700 shadow-lg transition hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-200 dark:hover:text-neutral-100"
                        aria-label="Next screenshot"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        ) : null}
        {sortedScreenshotSets.map((set) => {
          const capturedAtDate = new Date(set.capturedAt);
          const relativeCapturedAt = formatDistanceToNow(capturedAtDate, {
            addSuffix: true,
          });
          const shortCommit = set.commitSha?.slice(0, 12);
          const isHighlighted = effectiveHighlight === set._id;

          return (
            <article
              key={set._id}
              className={cn(
                "rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950/70 p-3 transition-shadow",
                isHighlighted &&
                "border-emerald-400/70 dark:border-emerald-400/60 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]"
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "px-2 py-0.5 text-xs font-medium rounded-full",
                    STATUS_STYLES[set.status]
                  )}
                >
                  {STATUS_LABELS[set.status]}
                </span>
                {isHighlighted && (
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100/80 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
                    Latest
                  </span>
                )}
                <span
                  className="text-xs text-neutral-600 dark:text-neutral-400"
                  title={capturedAtDate.toLocaleString()}
                >
                  {relativeCapturedAt}
                </span>
                {shortCommit && (
                  <span className="text-xs font-mono text-neutral-600 dark:text-neutral-400">
                    {shortCommit.toLowerCase()}
                  </span>
                )}
                {set.images.length > 0 && (
                  <span className="text-xs text-neutral-500 dark:text-neutral-500">
                    {set.images.length}{" "}
                    {set.images.length === 1 ? "image" : "images"}
                  </span>
                )}
              </div>
              {set.error && (
                <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
                  {set.error}
                </p>
              )}
              {set.images.length > 0 ? (
                <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                  {set.images.map((image, indexInSet) => {
                    const displayName = image.fileName ?? "Screenshot";
                    const stableKey = getImageKey(set._id, image, indexInSet);
                    if (!image.url) {
                      return (
                        <div
                          key={stableKey}
                          className="flex h-48 min-w-[200px] items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-100 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"
                        >
                          URL expired
                        </div>
                      );
                    }
                    const flatIndex = globalIndexByKey.get(stableKey) ?? null;
                    const humanIndex = flatIndex !== null ? flatIndex + 1 : null;
                    const isActive = activeImageKey === stableKey;

                    return (
                      <button
                        key={stableKey}
                        type="button"
                        onClick={() => setActiveImageKey(stableKey)}
                        className={cn(
                          "group relative flex w-[220px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 text-left transition-colors hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-900/70 dark:hover:border-neutral-500",
                          isActive &&
                          "border-emerald-400/70 shadow-[0_0_0_1px_rgba(16,185,129,0.25)] dark:border-emerald-400/60",
                        )}
                        aria-label={`Open ${displayName} in slideshow`}
                      >
                        <img
                          src={image.url}
                          alt={displayName}
                          className="h-48 w-[220px] object-contain bg-neutral-100 dark:bg-neutral-950"
                          loading="lazy"
                        />
                        <div className="absolute top-2 right-2 text-neutral-600 opacity-0 transition group-hover:opacity-100 dark:text-neutral-300">
                          <Maximize2 className="h-3.5 w-3.5" />
                        </div>
                        <div className="border-t border-neutral-200 px-2 py-1 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-300 truncate">
                          {humanIndex !== null ? `${humanIndex}. ` : ""}
                          {displayName}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                  {set.status === "failed"
                    ? "Screenshot capture failed before any images were saved."
                    : "No screenshots were captured for this attempt."}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
