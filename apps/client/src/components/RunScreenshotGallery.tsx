import { useCallback, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { formatDistanceToNow } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
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

const buildImageKey = (
  setId: Id<"taskRunScreenshotSets">,
  image: ScreenshotImage
) => `${setId}:${image.storageId}`;

export function RunScreenshotGallery(props: RunScreenshotGalleryProps) {
  const { screenshotSets, highlightedSetId } = props;
  if (!screenshotSets || screenshotSets.length === 0) {
    return null;
  }

  const flattenedImages = useMemo<FlattenedScreenshot[]>(() => {
    const items: FlattenedScreenshot[] = [];
    screenshotSets.forEach((set) => {
      set.images.forEach((image, imageIndex) => {
        if (!image.url) {
          return;
        }
        items.push({
          key: buildImageKey(set._id, image),
          set,
          image,
          imageIndex,
        });
      });
    });
    return items;
  }, [screenshotSets]);

  const imageIndexLookup = useMemo(() => {
    const lookup = new Map<string, number>();
    flattenedImages.forEach((item, index) => {
      lookup.set(item.key, index);
    });
    return lookup;
  }, [flattenedImages]);

  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const totalImages = flattenedImages.length;
  const activeImage =
    activeIndex === null ? null : flattenedImages[activeIndex] ?? null;

  const closeViewer = useCallback(() => setActiveIndex(null), []);

  const showPrev = useCallback(() => {
    setActiveIndex((idx) => {
      if (idx === null || idx <= 0) {
        return idx;
      }
      return idx - 1;
    });
  }, []);

  const showNext = useCallback(() => {
    setActiveIndex((idx) => {
      if (idx === null || totalImages === 0 || idx >= totalImages - 1) {
        return idx;
      }
      return idx + 1;
    });
  }, [totalImages]);

  useEffect(() => {
    if (activeIndex === null) {
      return;
    }
    if (totalImages === 0) {
      setActiveIndex(null);
      return;
    }
    if (activeIndex > totalImages - 1) {
      setActiveIndex(totalImages - 1);
    }
  }, [activeIndex, totalImages]);

  useEffect(() => {
    if (activeIndex === null) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeViewer();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        showNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        showPrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, closeViewer, showNext, showPrev]);

  const effectiveHighlight =
    highlightedSetId ??
    (screenshotSets.length > 0 ? screenshotSets[0]._id : null);

  const hasPrev = activeIndex !== null && activeIndex > 0;
  const hasNext =
    activeIndex !== null && totalImages > 0 && activeIndex < totalImages - 1;

  const handleThumbnailClick = useCallback((index: number | null) => {
    if (index == null) {
      return;
    }
    setActiveIndex(index);
  }, []);

  return (
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
                  {set.images.map((image) => {
                    const imageKey = buildImageKey(set._id, image);
                    if (!image.url) {
                      return (
                        <div
                          key={imageKey}
                          className="flex h-48 min-w-[200px] items-center justify-center rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-900 text-xs text-neutral-500 dark:text-neutral-400"
                        >
                          URL expired
                        </div>
                      );
                    }

                    const globalIndex =
                      imageIndexLookup.get(imageKey) ?? null;
                    const fileLabel = image.fileName ?? "Screenshot";

                    return (
                      <button
                        type="button"
                        key={imageKey}
                        onClick={() => handleThumbnailClick(globalIndex)}
                        className="group relative block rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/70 hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950"
                        aria-label={`Open ${fileLabel}`}
                      >
                        <img
                          src={image.url}
                          alt={fileLabel}
                          className="h-48 w-[220px] object-contain bg-neutral-100 dark:bg-neutral-950"
                          loading="lazy"
                        />
                        <a
                          href={image.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/85 text-neutral-600 opacity-0 shadow-sm transition group-hover:opacity-100 dark:bg-neutral-950/80 dark:text-neutral-300"
                          title="Open original"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <div className="border-t border-neutral-200 dark:border-neutral-700 px-2 py-1 text-xs text-neutral-600 dark:text-neutral-300 truncate">
                          {fileLabel}
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
      <ScreenshotLightbox
        image={activeImage}
        currentIndex={activeIndex}
        total={totalImages}
        isOpen={activeImage !== null}
        onClose={closeViewer}
        onPrev={showPrev}
        onNext={showNext}
        hasPrev={hasPrev}
        hasNext={hasNext}
      />
    </section>
  );
}

interface ScreenshotLightboxProps {
  image: FlattenedScreenshot | null;
  currentIndex: number | null;
  total: number;
  isOpen: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}

function ScreenshotLightbox(props: ScreenshotLightboxProps) {
  const {
    image,
    currentIndex,
    total,
    isOpen,
    onClose,
    onPrev,
    onNext,
    hasPrev,
    hasNext,
  } = props;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-0 z-50 flex flex-col focus:outline-none">
          <Dialog.Title className="sr-only">Screenshot preview</Dialog.Title>
          {image && (
            <>
              <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] bg-white/90 px-6 py-4 text-neutral-900 shadow-sm dark:border-white/[0.06] dark:bg-neutral-900/80 dark:text-neutral-50">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {image.image.fileName ?? "Screenshot"}
                  </p>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400">
                    Captured {formatDistanceToNow(new Date(image.set.capturedAt), { addSuffix: true })} · {STATUS_LABELS[image.set.status]}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-600 dark:text-neutral-300">
                  {total > 0 && currentIndex !== null && (
                    <span>
                      {currentIndex + 1}/{total} screenshots
                    </span>
                  )}
                  <span className="hidden sm:inline">Use ←/→ to navigate</span>
                  <span>Pinch or scroll to zoom</span>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={image.image.url ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-700 shadow-sm hover:border-neutral-300 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open original
                  </a>
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-transparent text-neutral-600 hover:bg-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-neutral-200 dark:hover:bg-neutral-800"
                    aria-label="Close screenshot viewer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </header>
              <div className="relative flex-1 bg-neutral-900 text-white dark:bg-neutral-950">
                {hasPrev && (
                  <button
                    type="button"
                    onClick={onPrev}
                    className="absolute left-4 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/30 bg-black/40 p-3 text-white backdrop-blur focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                    aria-label="View previous screenshot"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                )}
                {hasNext && (
                  <button
                    type="button"
                    onClick={onNext}
                    className="absolute right-4 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/30 bg-black/40 p-3 text-white backdrop-blur focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                    aria-label="View next screenshot"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                )}
                <TransformWrapper
                  key={image.key}
                  minScale={0.5}
                  maxScale={6}
                  initialScale={1}
                  centerOnInit
                  wheel={{ step: 0.1 }}
                  pinch={{ step: 5 }}
                  doubleClick={{ disabled: false, mode: "zoomIn" }}
                >
                  {({ zoomIn, zoomOut, resetTransform }) => (
                    <>
                      <div className="absolute right-4 bottom-4 z-20 flex items-center gap-2 rounded-full bg-black/50 px-2 py-1 text-white shadow-lg backdrop-blur">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            zoomOut();
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                          aria-label="Zoom out"
                        >
                          <ZoomOut className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            resetTransform();
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                          aria-label="Reset zoom"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            zoomIn();
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                          aria-label="Zoom in"
                        >
                          <ZoomIn className="h-4 w-4" />
                        </button>
                      </div>
                      <TransformComponent
                        wrapperClass="h-full w-full touch-none"
                        contentClass="flex h-full w-full items-center justify-center"
                      >
                        <img
                          src={image.image.url ?? undefined}
                          alt={image.image.fileName ?? "Screenshot"}
                          className="max-h-[calc(100vh-200px)] w-auto max-w-full select-none object-contain"
                          draggable={false}
                        />
                      </TransformComponent>
                    </>
                  )}
                </TransformWrapper>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
