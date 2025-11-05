import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatDistanceToNow } from "date-fns";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Maximize2,
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

interface ScreenshotEntry {
  key: string;
  set: RunScreenshotSet;
  image: ScreenshotImage;
  imageIndex: number;
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

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

const buildImageKey = (
  setId: Id<"taskRunScreenshotSets">,
  storageId: Id<"_storage">,
  imageIndex: number,
) => `${setId}-${storageId}-${imageIndex}`;

export function RunScreenshotGallery(props: RunScreenshotGalleryProps) {
  const { screenshotSets, highlightedSetId } = props;
  if (!screenshotSets || screenshotSets.length === 0) {
    return null;
  }

  const effectiveHighlight =
    highlightedSetId ??
    (screenshotSets.length > 0 ? screenshotSets[0]._id : null);

  const { screenshotEntries, entryIndexByKey } = useMemo(() => {
    const entries: ScreenshotEntry[] = [];
    const keyIndex = new Map<string, number>();

    screenshotSets.forEach((set) => {
      set.images.forEach((image, imageIndex) => {
        if (!image.url) {
          return;
        }
        const key = buildImageKey(set._id, image.storageId, imageIndex);
        entries.push({ key, set, image, imageIndex });
        keyIndex.set(key, entries.length - 1);
      });
    });

    return { screenshotEntries: entries, entryIndexByKey: keyIndex };
  }, [screenshotSets]);

  const [activeEntryIndex, setActiveEntryIndex] = useState<number | null>(null);
  const activeEntry =
    activeEntryIndex === null ? null : screenshotEntries[activeEntryIndex] ?? null;
  const totalPreviewImages = screenshotEntries.length;
  const previewIndex = activeEntryIndex ?? 0;

  useEffect(() => {
    setActiveEntryIndex((current) => {
      if (current === null) {
        return current;
      }
      if (totalPreviewImages === 0) {
        return null;
      }
      return Math.min(current, totalPreviewImages - 1);
    });
  }, [totalPreviewImages]);

  const openPreview = useCallback(
    (key: string) => {
      const index = entryIndexByKey.get(key);
      if (typeof index === "number") {
        setActiveEntryIndex(index);
      }
    },
    [entryIndexByKey],
  );

  const closePreview = useCallback(() => {
    setActiveEntryIndex(null);
  }, []);

  const movePreviewBy = useCallback(
    (direction: -1 | 1) => {
      setActiveEntryIndex((current) => {
        if (current === null) {
          return current;
        }
        const nextIndex = current + direction;
        if (nextIndex < 0 || nextIndex >= totalPreviewImages) {
          return current;
        }
        return nextIndex;
      });
    },
    [totalPreviewImages],
  );

  useEffect(() => {
    if (activeEntryIndex === null) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        movePreviewBy(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        movePreviewBy(-1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closePreview();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeEntryIndex, closePreview, movePreviewBy]);

  const panStateRef = useRef<{
    isPanning: boolean;
    pointerId: number | null;
    lastX: number;
    lastY: number;
  }>({
    isPanning: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
  });

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const resetView = useCallback(() => {
    panStateRef.current = {
      isPanning: false,
      pointerId: null,
      lastX: 0,
      lastY: 0,
    };
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (activeEntryIndex !== null) {
      resetView();
    }
  }, [activeEntryIndex, resetView]);

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (activeEntryIndex === null) {
        return;
      }
      if (event.ctrlKey) {
        event.preventDefault();
        const delta = -event.deltaY * 0.002;
        setZoom((prev) => {
          const next = clamp(prev + delta, MIN_ZOOM, MAX_ZOOM);
          if (next === MIN_ZOOM) {
            setOffset({ x: 0, y: 0 });
          }
          return Number(next.toFixed(3));
        });
      } else if (zoom > 1) {
        event.preventDefault();
        setOffset((prev) => ({
          x: prev.x - event.deltaX,
          y: prev.y - event.deltaY,
        }));
      }
    },
    [activeEntryIndex, zoom],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (zoom <= 1) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      panStateRef.current = {
        isPanning: true,
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
      };
    },
    [zoom],
  );

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      !panStateRef.current.isPanning ||
      panStateRef.current.pointerId !== event.pointerId
    ) {
      return;
    }
    event.preventDefault();
    const deltaX = event.clientX - panStateRef.current.lastX;
    const deltaY = event.clientY - panStateRef.current.lastY;
    panStateRef.current.lastX = event.clientX;
    panStateRef.current.lastY = event.clientY;
    setOffset((prev) => ({
      x: prev.x + deltaX,
      y: prev.y + deltaY,
    }));
  }, []);

  const releasePointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (panStateRef.current.pointerId !== event.pointerId) {
      return;
    }
    panStateRef.current = {
      isPanning: false,
      pointerId: null,
      lastX: 0,
      lastY: 0,
    };
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  const canGoPrev = activeEntryIndex !== null && activeEntryIndex > 0;
  const canGoNext =
    activeEntryIndex !== null &&
    totalPreviewImages > 0 &&
    activeEntryIndex < totalPreviewImages - 1;
  const zoomPercent = Math.round(zoom * 100);

  return (
    <>
      <section className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-950/40">
        <div className="px-3.5 pt-3 pb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Screenshots
          </h2>
          <span className="text-xs text-neutral-600 dark:text-neutral-400">
            {screenshotSets.length}{" "}
            {screenshotSets.length === 1 ? "capture" : "captures"}
          </span>
        </div>
        <div className="px-3.5 pb-4 space-y-4">
          {screenshotSets.map((set) => {
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
                    "border-emerald-400/70 dark:border-emerald-400/60 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "px-2 py-0.5 text-xs font-medium rounded-full",
                      STATUS_STYLES[set.status],
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
                    {set.images.map((image, imageIndex) => {
                      const key = `${image.storageId}-${image.fileName ?? "unnamed"}-${imageIndex}`;
                      if (!image.url) {
                        return (
                          <div
                            key={key}
                            className="flex h-48 min-w-[200px] items-center justify-center rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-900 text-xs text-neutral-500 dark:text-neutral-400"
                          >
                            URL expired
                          </div>
                        );
                      }
                      const previewKey = buildImageKey(
                        set._id,
                        image.storageId,
                        imageIndex,
                      );

                      return (
                        <button
                          type="button"
                          key={key}
                          onClick={() => openPreview(previewKey)}
                          className="group relative block rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/70 hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-950"
                        >
                          <img
                            src={image.url}
                            alt={image.fileName ?? "Screenshot"}
                            className="h-48 w-[220px] object-contain bg-neutral-100 dark:bg-neutral-950"
                            loading="lazy"
                          />
                          <div className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/85 text-neutral-600 opacity-0 shadow-sm transition group-hover:opacity-100 dark:bg-neutral-950/80 dark:text-neutral-300">
                            <Maximize2 className="h-3.5 w-3.5" />
                          </div>
                          <div className="border-t border-neutral-200 dark:border-neutral-700 px-2 py-1 text-xs text-neutral-600 dark:text-neutral-300 truncate text-left">
                            {image.fileName ?? "Screenshot"}
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
      <Dialog.Root open={Boolean(activeEntry)} onOpenChange={(open) => !open && closePreview()}>
        {activeEntry && (
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-neutral-900/80 backdrop-blur-sm" />
            <Dialog.Content className="fixed inset-0 z-50 flex flex-col bg-neutral-950/95 text-white focus:outline-none">
              <div className="flex flex-col gap-1 border-b border-white/10 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div>
                  <Dialog.Title className="text-base font-semibold">
                    {activeEntry.image.fileName ?? "Screenshot"}
                  </Dialog.Title>
                  <Dialog.Description className="text-sm text-neutral-300">
                    Captured{" "}
                    {formatDistanceToNow(new Date(activeEntry.set.capturedAt), {
                      addSuffix: true,
                    })}
                    {activeEntry.set.commitSha
                      ? ` • ${activeEntry.set.commitSha.slice(0, 12).toLowerCase()}`
                      : ""}
                  </Dialog.Description>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                  <span className="text-neutral-300">
                    Image {previewIndex + 1} of {totalPreviewImages}
                  </span>
                  <span className="text-neutral-400">•</span>
                  <span className="text-neutral-300">Zoom {zoomPercent}%</span>
                  <button
                    type="button"
                    onClick={resetView}
                    className="rounded-full border border-white/20 px-3 py-1 text-xs font-medium text-white transition hover:border-white/40 hover:text-white/90"
                  >
                    Reset view
                  </button>
                  <a
                    href={activeEntry.image.url ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-white/20 px-3 py-1 text-xs font-medium text-white transition hover:border-white/40 hover:text-white/90"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open original
                  </a>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 text-white transition hover:border-white/40"
                      aria-label="Close screenshot preview"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </Dialog.Close>
                </div>
              </div>
              <div className="relative flex-1 min-h-0 bg-black">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div
                    className="relative flex h-full w-full items-center justify-center overflow-hidden"
                    onWheel={handleWheel}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={releasePointer}
                    onPointerCancel={releasePointer}
                    onPointerLeave={releasePointer}
                    onDoubleClick={() =>
                      setZoom((prev) => {
                        const nextZoom = prev > 1 ? 1 : 2;
                        if (nextZoom === 1) {
                          setOffset({ x: 0, y: 0 });
                        }
                        return nextZoom;
                      })
                    }
                    style={{ cursor: zoom > 1 ? "grab" : "zoom-in" }}
                  >
                    <img
                      src={activeEntry.image.url ?? undefined}
                      alt={activeEntry.image.fileName ?? "Screenshot"}
                      className="max-h-full max-w-full select-none object-contain"
                      draggable={false}
                      style={{
                        transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
                      }}
                    />
                  </div>
                </div>
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                  <button
                    type="button"
                    aria-label="View previous screenshot"
                    onClick={() => movePreviewBy(-1)}
                    disabled={!canGoPrev}
                    className="pointer-events-auto rounded-full border border-white/20 bg-white/10 p-2 text-white transition hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                </div>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4">
                  <button
                    type="button"
                    aria-label="View next screenshot"
                    onClick={() => movePreviewBy(1)}
                    disabled={!canGoNext}
                    className="pointer-events-auto rounded-full border border-white/20 bg-white/10 p-2 text-white transition hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </Dialog.Root>
    </>
  );
}
