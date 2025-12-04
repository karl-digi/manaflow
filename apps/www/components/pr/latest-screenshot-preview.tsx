"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import { formatDistanceToNow } from "date-fns";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ChevronLeft,
  ChevronRight,
  Camera,
  Maximize2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
  Loader2,
} from "lucide-react";

import { api } from "@cmux/convex/api";
import { useConvexQuery } from "@convex-dev/react-query";
import { cn } from "@/lib/utils";

type ScreenshotStatus = "completed" | "failed" | "skipped";

interface ScreenshotImage {
  storageId: string;
  mimeType: string;
  fileName: string | null;
  commitSha: string | null;
  description: string | null;
  url: string | null;
}

interface ScreenshotSet {
  _id: string;
  status: ScreenshotStatus;
  commitSha: string | null;
  capturedAt: number;
  error: string | null;
  images: ScreenshotImage[];
}

interface LatestScreenshotPreviewProps {
  teamSlugOrId: string;
  repoFullName: string;
  prNumber: number;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 40;

const STATUS_LABELS: Record<ScreenshotStatus, string> = {
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};

const STATUS_STYLES: Record<ScreenshotStatus, string> = {
  completed:
    "bg-emerald-100/70 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  failed:
    "bg-rose-100/70 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  skipped:
    "bg-neutral-200/70 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

export const LatestScreenshotPreview = memo(function LatestScreenshotPreview({
  teamSlugOrId,
  repoFullName,
  prNumber,
}: LatestScreenshotPreviewProps) {
  // useConvexQuery returns undefined while loading, null if not found, or the data
  const screenshotSet = useConvexQuery(
    api.previewRuns.getLatestScreenshotSetForPr,
    { teamSlugOrId, repoFullName, prNumber }
  ) as ScreenshotSet | null | undefined;

  // Still loading
  if (screenshotSet === undefined) {
    return (
      <div className="border border-neutral-200 bg-white p-4">
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading screenshot preview...</span>
        </div>
      </div>
    );
  }

  // No screenshots found
  if (screenshotSet === null || screenshotSet.images.length === 0) {
    return null;
  }

  return <ScreenshotPreviewContent screenshotSet={screenshotSet} />;
});

function ScreenshotPreviewContent({
  screenshotSet,
}: {
  screenshotSet: ScreenshotSet;
}) {
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [baseImageScale, setBaseImageScale] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panPointerIdRef = useRef<number | null>(null);
  const lastPanPositionRef = useRef<{ x: number; y: number } | null>(null);
  const defaultZoomRef = useRef(1);
  const defaultOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const imagesWithUrls = useMemo(
    () => screenshotSet.images.filter((img) => img.url),
    [screenshotSet.images]
  );

  const clampZoom = useCallback((value: number) => {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  }, []);

  const setZoomWithFocus = useCallback(
    (
      resolver: (prevZoom: number) => number,
      focusPoint: { x: number; y: number } = { x: 0, y: 0 }
    ) => {
      setZoom((prevZoom) => {
        const safePrevZoom = prevZoom || 1;
        const nextZoom = clampZoom(resolver(safePrevZoom));
        if (nextZoom === safePrevZoom) {
          return nextZoom;
        }
        setOffset((prevOffset) => ({
          x:
            focusPoint.x -
            (nextZoom * (focusPoint.x - prevOffset.x)) / safePrevZoom,
          y:
            focusPoint.y -
            (nextZoom * (focusPoint.y - prevOffset.y)) / safePrevZoom,
        }));
        return nextZoom;
      });
    },
    [clampZoom]
  );

  const resetZoomState = useCallback(
    (options?: { zoom?: number; offset?: { x: number; y: number } }) => {
      const targetZoom = clampZoom(options?.zoom ?? defaultZoomRef.current);
      setZoom(targetZoom);
      setOffset(options?.offset ?? defaultOffsetRef.current);
      setIsPanning(false);
      panPointerIdRef.current = null;
      lastPanPositionRef.current = null;
    },
    [clampZoom]
  );

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    const viewportRect = viewportRef.current?.getBoundingClientRect();
    if (!viewportRect || naturalWidth <= 0 || naturalHeight <= 0) {
      setBaseImageScale(1);
      defaultZoomRef.current = 1;
      defaultOffsetRef.current = { x: 0, y: 0 };
      resetZoomState({ zoom: 1, offset: { x: 0, y: 0 } });
      return;
    }

    const viewportWidth = viewportRect.width;
    const viewportHeight = viewportRect.height;
    const baseScale = Math.min(
      viewportWidth / naturalWidth,
      viewportHeight / naturalHeight
    );
    const normalizedBaseScale = Math.min(1, baseScale);
    setBaseImageScale(normalizedBaseScale);
    const baseWidth = naturalWidth * baseScale;
    const baseHeight = naturalHeight * baseScale;

    const fitHeightZoom = viewportHeight / baseHeight;
    const fitWidthZoom = viewportWidth / baseWidth;
    const desiredZoom = Math.min(1, fitHeightZoom, fitWidthZoom);
    const clampedZoom = clampZoom(desiredZoom);

    const scaledHeight = baseHeight * clampedZoom;
    const offsetY = -((viewportHeight - scaledHeight) / 2);
    const initialOffset = { x: 0, y: offsetY };

    defaultZoomRef.current = clampedZoom;
    defaultOffsetRef.current = initialOffset;
    resetZoomState({ zoom: clampedZoom, offset: initialOffset });
  };

  const currentImage =
    activeImageIndex !== null ? imagesWithUrls[activeImageIndex] ?? null : null;

  useEffect(() => {
    defaultZoomRef.current = 1;
    defaultOffsetRef.current = { x: 0, y: 0 };
    setBaseImageScale(1);
    resetZoomState({ zoom: 1, offset: { x: 0, y: 0 } });
  }, [activeImageIndex, resetZoomState]);

  const closeSlideshow = useCallback(() => {
    setActiveImageIndex(null);
  }, []);

  const goNext = useCallback(() => {
    if (activeImageIndex === null) return;
    const len = imagesWithUrls.length;
    if (len <= 1) return;
    setActiveImageIndex((activeImageIndex + 1) % len);
  }, [activeImageIndex, imagesWithUrls.length]);

  const goPrev = useCallback(() => {
    if (activeImageIndex === null) return;
    const len = imagesWithUrls.length;
    if (len <= 1) return;
    setActiveImageIndex((activeImageIndex - 1 + len) % len);
  }, [activeImageIndex, imagesWithUrls.length]);

  const isSlideshowOpen = currentImage !== null;
  const hasMultipleImages = imagesWithUrls.length > 1;
  const effectiveScale = Math.max(0, zoom * baseImageScale);
  const zoomPercent = Math.round(effectiveScale * 100);
  const canZoomIn = zoom < MAX_ZOOM - 0.001;
  const canZoomOut = zoom > MIN_ZOOM + 0.001;
  const canResetZoom = zoom !== 1 || offset.x !== 0 || offset.y !== 0;

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!currentImage || !viewportRef.current) return;
      event.preventDefault();
      const rect = viewportRef.current.getBoundingClientRect();
      const pointerX = event.clientX - (rect.left + rect.width / 2);
      const pointerY = event.clientY - (rect.top + rect.height / 2);
      const { deltaMode, deltaY } = event;
      let pixelDelta = deltaY;
      if (deltaMode === 1) pixelDelta *= 16;
      else if (deltaMode === 2) pixelDelta *= rect.height;
      if (pixelDelta === 0) return;
      const sensitivity = event.ctrlKey ? 0.0016 : 0.0009;
      const factor = Math.exp(-pixelDelta * sensitivity);
      setZoomWithFocus((prevZoom) => prevZoom * factor, {
        x: pointerX,
        y: pointerY,
      });
    },
    [currentImage, setZoomWithFocus]
  );

  const startPanning = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!currentImage || event.button !== 0) return;
      event.preventDefault();
      setIsPanning(true);
      panPointerIdRef.current = event.pointerId;
      lastPanPositionRef.current = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [currentImage]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        !isPanning ||
        panPointerIdRef.current !== event.pointerId ||
        !lastPanPositionRef.current
      )
        return;
      event.preventDefault();
      const deltaX = event.clientX - lastPanPositionRef.current.x;
      const deltaY = event.clientY - lastPanPositionRef.current.y;
      lastPanPositionRef.current = { x: event.clientX, y: event.clientY };
      setOffset((prev) => ({ x: prev.x + deltaX, y: prev.y + deltaY }));
    },
    [isPanning]
  );

  const stopPanning = useCallback(
    (event?: React.PointerEvent<HTMLDivElement>) => {
      if (panPointerIdRef.current !== null && event) {
        try {
          event.currentTarget.releasePointerCapture(panPointerIdRef.current);
        } catch {
          // Ignore release errors
        }
      }
      panPointerIdRef.current = null;
      lastPanPositionRef.current = null;
      setIsPanning(false);
    },
    []
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (panPointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      stopPanning(event);
    },
    [stopPanning]
  );

  const handlePointerLeave = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isPanning) return;
      stopPanning(event);
    },
    [isPanning, stopPanning]
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (panPointerIdRef.current !== event.pointerId) return;
      stopPanning(event);
    },
    [stopPanning]
  );

  const handleZoomIn = useCallback(() => {
    setZoomWithFocus((prevZoom) => prevZoom * 1.2);
  }, [setZoomWithFocus]);

  const handleZoomOut = useCallback(() => {
    setZoomWithFocus((prevZoom) => prevZoom / 1.2);
  }, [setZoomWithFocus]);

  useEffect(() => {
    if (!isSlideshowOpen) return;
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
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrev, isSlideshowOpen]);

  if (imagesWithUrls.length === 0) {
    return null;
  }

  const capturedAtDate = new Date(screenshotSet.capturedAt);
  const relativeCapturedAt = formatDistanceToNow(capturedAtDate, {
    addSuffix: true,
  });
  const shortCommit = screenshotSet.commitSha?.slice(0, 12);

  return (
    <div className="border border-neutral-200 bg-white">
      <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-neutral-500" aria-hidden />
          <h2 className="text-sm font-medium text-neutral-900">
            Latest Screenshots
          </h2>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={cn(
              "px-2 py-0.5 font-medium rounded-full",
              STATUS_STYLES[screenshotSet.status]
            )}
          >
            {STATUS_LABELS[screenshotSet.status]}
          </span>
          <span
            className="text-neutral-600"
            title={capturedAtDate.toLocaleString()}
          >
            {relativeCapturedAt}
          </span>
          {shortCommit && (
            <span className="font-mono text-neutral-600">
              {shortCommit.toLowerCase()}
            </span>
          )}
        </div>
      </div>
      <div className="p-4">
        {screenshotSet.error && (
          <p className="mb-3 text-xs text-rose-600">{screenshotSet.error}</p>
        )}
        <div className="flex gap-3 overflow-x-auto pb-1">
          {imagesWithUrls.map((image, index) => {
            const displayName = image.fileName ?? "Screenshot";
            const isActive = activeImageIndex === index;

            return (
              <button
                key={`${image.storageId}-${index}`}
                type="button"
                onClick={() => setActiveImageIndex(index)}
                className={cn(
                  "group relative flex w-[220px] flex-shrink-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 text-left transition-colors hover:border-neutral-400",
                  isActive &&
                    "border-sky-400/70 shadow-[0_0_0_1px_rgba(14,165,233,0.25)]"
                )}
                aria-label={`Open ${displayName} in slideshow`}
              >
                <img
                  src={image.url ?? undefined}
                  alt={displayName}
                  className="h-36 w-[220px] object-contain bg-neutral-100"
                  loading="lazy"
                />
                <div className="absolute top-2 right-2 text-neutral-600 opacity-0 transition group-hover:opacity-100">
                  <Maximize2 className="h-3.5 w-3.5" />
                </div>
                <div className="border-t border-neutral-200 px-2 py-1 text-xs text-neutral-600 truncate">
                  {index + 1}. {displayName}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {currentImage && (
        <Dialog.Root
          open={isSlideshowOpen}
          onOpenChange={(open) => !open && closeSlideshow()}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-neutral-950/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-4rem)] w-[min(2600px,calc(100vw-4rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-3xl border border-neutral-200 bg-white/95 p-4 shadow-2xl focus:outline-none sm:max-h-[calc(100vh-6rem)] sm:w-[min(2600px,calc(100vw-6rem))] sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <Dialog.Title className="text-base font-semibold text-neutral-900">
                    {activeImageIndex !== null ? `${activeImageIndex + 1}. ` : ""}
                    {currentImage.fileName ?? "Screenshot"}
                  </Dialog.Title>
                  <Dialog.Description className="text-xs text-neutral-600">
                    Image {(activeImageIndex ?? 0) + 1} of {imagesWithUrls.length}
                    <span className="px-1 text-neutral-400">•</span>
                    {relativeCapturedAt}
                  </Dialog.Description>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 rounded-full border border-neutral-200 bg-white/90 px-2 py-1 text-xs font-medium text-neutral-600 shadow-sm">
                    <button
                      type="button"
                      onClick={handleZoomOut}
                      disabled={!canZoomOut}
                      className="rounded-full p-1 transition disabled:opacity-40 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
                      aria-label="Zoom out"
                    >
                      <ZoomOut className="h-3.5 w-3.5" />
                    </button>
                    <span className="min-w-[3rem] text-center tabular-nums">
                      {zoomPercent}%
                    </span>
                    <button
                      type="button"
                      onClick={handleZoomIn}
                      disabled={!canZoomIn}
                      className="rounded-full p-1 transition disabled:opacity-40 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
                      aria-label="Zoom in"
                    >
                      <ZoomIn className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => resetZoomState()}
                      disabled={!canResetZoom}
                      className="rounded-full p-1 transition disabled:opacity-40 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
                      aria-label="Reset zoom"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      onClick={closeSlideshow}
                      className="rounded-full p-1.5 text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
                      aria-label="Close slideshow"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </Dialog.Close>
                </div>
              </div>
              <div className="flex flex-1 items-center gap-4">
                {hasMultipleImages && (
                  <button
                    type="button"
                    onClick={goPrev}
                    className="rounded-full border border-neutral-200 bg-white p-2 text-neutral-600 transition hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
                    aria-label="Previous screenshot"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                )}
                <div
                  ref={viewportRef}
                  className={cn(
                    "relative flex h-[70vh] max-h-[calc(100vh-10rem)] min-h-[360px] w-full flex-1 items-center justify-center overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50",
                    zoom > 1
                      ? isPanning
                        ? "cursor-grabbing"
                        : "cursor-grab"
                      : "cursor-zoom-in"
                  )}
                  onWheel={handleWheel}
                  onPointerDown={startPanning}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerLeave}
                  onPointerCancel={handlePointerCancel}
                  onDoubleClick={() => resetZoomState()}
                  style={{ touchAction: "none" }}
                >
                  <img
                    src={currentImage.url ?? undefined}
                    alt={currentImage.fileName ?? "Screenshot"}
                    className="h-full w-full select-none object-contain"
                    draggable={false}
                    onLoad={handleImageLoad}
                    style={{
                      transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
                      transition: isPanning ? "none" : "transform 120ms ease-out",
                    }}
                  />
                </div>
                {hasMultipleImages && (
                  <button
                    type="button"
                    onClick={goNext}
                    className="rounded-full border border-neutral-200 bg-white p-2 text-neutral-600 transition hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
                    aria-label="Next screenshot"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                )}
              </div>
              {hasMultipleImages && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-medium text-neutral-500">
                    <span className="sr-only">All screenshots</span>
                    <span className="tabular-nums text-neutral-600">
                      {(activeImageIndex ?? 0) + 1} / {imagesWithUrls.length}
                    </span>
                  </div>
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                    {imagesWithUrls.map((entry, index) => {
                      const isActiveThumb = index === activeImageIndex;
                      const label = index + 1;
                      const displayName = entry.fileName ?? "Screenshot";
                      return (
                        <button
                          key={`thumb-${entry.storageId}-${index}`}
                          type="button"
                          onClick={() => setActiveImageIndex(index)}
                          className={cn(
                            "group relative flex h-24 w-40 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 p-1 transition hover:border-neutral-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70",
                            isActiveThumb &&
                              "border-sky-400/70 shadow-[0_0_0_1px_rgba(14,165,233,0.25)]"
                          )}
                          aria-label={`View ${displayName}`}
                          aria-current={isActiveThumb ? "true" : undefined}
                          title={displayName}
                        >
                          <img
                            src={entry.url ?? undefined}
                            alt={displayName}
                            className="h-full w-full object-contain"
                            loading="lazy"
                            decoding="async"
                          />
                          <span className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-neutral-950/80 px-1 text-[10px] font-semibold text-white shadow-sm">
                            {label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </div>
  );
}
