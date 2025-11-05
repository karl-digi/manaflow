import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { formatDistanceToNow } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Maximize2,
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

interface FlattenedScreenshot {
  key: string;
  url: string;
  fileName: string | null;
  commitSha?: string | null;
  capturedAt: number;
  setIndex: number;
  setCount: number;
  setId: Id<"taskRunScreenshotSets">;
  indexInSet: number;
  totalInSet: number;
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

type ZoomState = { scale: number; offsetX: number; offsetY: number };

const LIGHTBOX_DEFAULT_ZOOM: ZoomState = { scale: 1, offsetX: 0, offsetY: 0 };
const MAX_LIGHTBOX_SCALE = 5;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const buildImageKey = (
  setId: Id<"taskRunScreenshotSets">,
  image: ScreenshotImage,
  index: number,
) => `${setId}-${image.storageId}-${image.fileName ?? "unnamed"}-${index}`;

export function RunScreenshotGallery(props: RunScreenshotGalleryProps) {
  const { screenshotSets, highlightedSetId } = props;
  if (!screenshotSets || screenshotSets.length === 0) {
    return null;
  }

  const effectiveHighlight =
    highlightedSetId ??
    (screenshotSets.length > 0 ? screenshotSets[0]._id : null);

  const lightboxImages = useMemo<FlattenedScreenshot[]>(() => {
    const totalSets = screenshotSets.length;
    const flattened: FlattenedScreenshot[] = [];

    screenshotSets.forEach((set, setIndex) => {
      set.images.forEach((image, imageIndex) => {
        if (!image.url) return;
        flattened.push({
          key: buildImageKey(set._id, image, imageIndex),
          url: image.url,
          fileName: image.fileName ?? null,
          commitSha: image.commitSha ?? set.commitSha ?? null,
          capturedAt: set.capturedAt,
          setIndex,
          setCount: totalSets,
          setId: set._id,
          indexInSet: imageIndex,
          totalInSet: set.images.length,
        });
      });
    });

    return flattened;
  }, [screenshotSets]);

  const imageIndexLookup = useMemo(() => {
    const map = new Map<string, number>();
    lightboxImages.forEach((image, index) => {
      map.set(image.key, index);
    });
    return map;
  }, [lightboxImages]);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const openLightbox = useCallback(
    (key: string) => {
      const index = imageIndexLookup.get(key);
      if (index === undefined) {
        return;
      }
      setLightboxIndex(index);
    },
    [imageIndexLookup],
  );

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  const showPreviousImage = useCallback(() => {
    setLightboxIndex((prev) => {
      if (prev === null || prev <= 0) {
        return prev;
      }
      return prev - 1;
    });
  }, []);

  const showNextImage = useCallback(() => {
    setLightboxIndex((prev) => {
      if (prev === null || prev >= lightboxImages.length - 1) {
        return prev;
      }
      return prev + 1;
    });
  }, [lightboxImages.length]);

  useEffect(() => {
    if (lightboxIndex === null) {
      return;
    }
    if (lightboxImages.length === 0) {
      setLightboxIndex(null);
      return;
    }
    if (lightboxIndex > lightboxImages.length - 1) {
      setLightboxIndex(lightboxImages.length - 1);
    }
  }, [lightboxIndex, lightboxImages.length]);

  const activeImage =
    lightboxIndex === null ? null : lightboxImages[lightboxIndex];
  const canGoPrev = (lightboxIndex ?? 0) > 0;
  const canGoNext =
    lightboxIndex !== null && lightboxIndex < lightboxImages.length - 1;

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
                      const key = buildImageKey(set._id, image, imageIndex);
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

                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => openLightbox(key)}
                          className="group relative block rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/70 hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                        >
                          <img
                            src={image.url}
                            alt={image.fileName ?? "Screenshot"}
                            className="h-48 w-[220px] object-contain bg-neutral-100 dark:bg-neutral-950"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/0 text-neutral-50 opacity-0 transition group-hover:bg-neutral-950/40 group-hover:opacity-100">
                            <Maximize2 className="h-5 w-5" />
                          </div>
                          <div className="border-t border-neutral-200 dark:border-neutral-700 px-2 py-1 text-xs text-neutral-600 dark:text-neutral-300 truncate">
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

      <ScreenshotLightbox
        open={Boolean(activeImage)}
        image={activeImage}
        onClose={closeLightbox}
        onPrev={showPreviousImage}
        onNext={showNextImage}
        canGoPrev={canGoPrev}
        canGoNext={canGoNext}
        imageIndex={lightboxIndex ?? 0}
        totalImages={lightboxImages.length}
      />
    </>
  );
}

interface ScreenshotLightboxProps {
  open: boolean;
  image: FlattenedScreenshot | null;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  imageIndex: number;
  totalImages: number;
}

function ScreenshotLightbox({
  open,
  image,
  onClose,
  onPrev,
  onNext,
  canGoPrev,
  canGoNext,
  imageIndex,
  totalImages,
}: ScreenshotLightboxProps) {
  const [zoom, setZoom] = useState<ZoomState>(LIGHTBOX_DEFAULT_ZOOM);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{
    active: boolean;
    pointerId: number | null;
    lastX: number;
    lastY: number;
  }>({
    active: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
  });

  useEffect(() => {
    setZoom(LIGHTBOX_DEFAULT_ZOOM);
  }, [image?.key]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, onNext, onPrev]);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      setZoom((prev) => {
        const nextScale = clamp(
          prev.scale - event.deltaY * 0.01,
          1,
          MAX_LIGHTBOX_SCALE,
        );
        if (nextScale === prev.scale) {
          return prev;
        }
        const rect = frameRef.current?.getBoundingClientRect();
        if (!rect) {
          return { ...prev, scale: nextScale };
        }
        const originX = event.clientX - (rect.left + rect.width / 2);
        const originY = event.clientY - (rect.top + rect.height / 2);
        const ratio = nextScale / prev.scale;

        return {
          scale: nextScale,
          offsetX: (prev.offsetX + originX) * ratio - originX,
          offsetY: (prev.offsetY + originY) * ratio - originY,
        };
      });
    },
    [],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (zoom.scale <= 1) {
        return;
      }
      dragState.current = {
        active: true,
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [zoom.scale],
  );

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    if (
      !dragState.current.active ||
      dragState.current.pointerId !== event.pointerId
    ) {
      return;
    }
    event.preventDefault();
    const deltaX = event.clientX - dragState.current.lastX;
    const deltaY = event.clientY - dragState.current.lastY;
    dragState.current.lastX = event.clientX;
    dragState.current.lastY = event.clientY;
    setZoom((prev) => ({
      ...prev,
      offsetX: prev.offsetX + deltaX,
      offsetY: prev.offsetY + deltaY,
    }));
  }, []);

  const endPointerInteraction = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        dragState.current.active &&
        dragState.current.pointerId === event.pointerId
      ) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragState.current.active = false;
      dragState.current.pointerId = null;
    },
    [],
  );

  const resetZoom = useCallback(() => {
    setZoom(LIGHTBOX_DEFAULT_ZOOM);
  }, []);

  const relativeCapturedAt = useMemo(() => {
    if (!image) return "";
    return formatDistanceToNow(new Date(image.capturedAt), { addSuffix: true });
  }, [image]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-neutral-950/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-0 z-50 flex flex-col">
          <div className="flex flex-1 flex-col px-4 pb-4 pt-6 sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-4 text-white">
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold text-white">
                  {image?.fileName ?? "Screenshot"}
                </Dialog.Title>
                {image && (
                  <p className="mt-1 text-xs text-neutral-300">
                    Capture {image.setIndex + 1} of {image.setCount} · Image{" "}
                    {image.indexInSet + 1} of {image.totalInSet}
                    {" · "}
                    {relativeCapturedAt}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {zoom.scale !== 1 && (
                  <button
                    type="button"
                    onClick={resetZoom}
                    className="inline-flex items-center gap-1 rounded-full border border-white/30 px-3 py-1 text-xs font-medium text-white transition hover:border-white hover:bg-white/10"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset zoom
                  </button>
                )}
                {image?.url && (
                  <a
                    href={image.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-white/30 px-3 py-1 text-xs font-medium text-white transition hover:border-white hover:bg-white/10"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open original
                  </a>
                )}
                {image?.url && (
                  <a
                    href={image.url}
                    download={image.fileName ?? undefined}
                    className="inline-flex items-center gap-1 rounded-full border border-white/30 px-3 py-1 text-xs font-medium text-white transition hover:border-white hover:bg-white/10"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </a>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/30 text-white transition hover:border-white hover:bg-white/10"
                  aria-label="Close screenshot viewer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div
              ref={frameRef}
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endPointerInteraction}
              onPointerCancel={endPointerInteraction}
              className="relative mt-4 flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-neutral-950/60"
              style={{ touchAction: zoom.scale > 1 ? "none" : "pan-y" }}
            >
              {image ? (
                <>
                  <div
                    className="relative flex items-center justify-center"
                    style={{
                      transform: `translate3d(${zoom.offsetX}px, ${zoom.offsetY}px, 0)`,
                    }}
                  >
                    <img
                      src={image.url}
                      alt={image.fileName ?? "Screenshot"}
                      className="max-h-[80vh] w-auto max-w-full select-none object-contain pointer-events-none"
                      style={{
                        transform: `scale(${zoom.scale})`,
                        transformOrigin: "center center",
                      }}
                      draggable={false}
                    />
                  </div>
                  <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/20 bg-neutral-950/80 px-4 py-1.5 text-xs font-medium text-white">
                    Image {imageIndex + 1} of {totalImages || 1}
                  </div>
                  <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-full border border-white/20 bg-neutral-950/70 px-4 py-1 text-[11px] text-neutral-200">
                    Pinch / Ctrl + scroll to zoom · Drag to pan
                  </div>
                  <button
                    type="button"
                    onClick={onPrev}
                    disabled={!canGoPrev}
                    className={cn(
                      "absolute left-4 top-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-neutral-950/60 p-3 text-white transition hover:border-white hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/40",
                    )}
                    aria-label="Previous screenshot"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={onNext}
                    disabled={!canGoNext}
                    className={cn(
                      "absolute right-4 top-1/2 -translate-y-1/2 rounded-full border border-white/30 bg-neutral-950/60 p-3 text-white transition hover:border-white hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/40",
                    )}
                    aria-label="Next screenshot"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              ) : (
                <p className="text-sm text-neutral-300">No screenshot selected</p>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
