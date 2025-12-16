"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";

interface ScreenshotSetReference {
  runId: Id<"taskRuns">;
  agentName: string;
  screenshotSetId: Id<"taskRunScreenshotSets">;
}

interface ReviewScreenshotGalleryProps {
  teamSlugOrId: string;
  screenshotSets: ScreenshotSetReference[];
}

export function ReviewScreenshotGallery({
  teamSlugOrId,
  screenshotSets,
}: ReviewScreenshotGalleryProps) {
  if (screenshotSets.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-neutral-300 p-4 text-center dark:border-neutral-700">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No screenshots captured yet
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {screenshotSets.map((setRef) => (
        <ScreenshotSetCard
          key={setRef.screenshotSetId}
          teamSlugOrId={teamSlugOrId}
          setRef={setRef}
        />
      ))}
    </div>
  );
}

function ScreenshotSetCard({
  teamSlugOrId,
  setRef,
}: {
  teamSlugOrId: string;
  setRef: ScreenshotSetReference;
}) {
  // Fetch the screenshot set details
  const screenshotSet = useQuery(api.taskRunScreenshotSets.get, {
    teamSlugOrId,
    id: setRef.screenshotSetId,
  });

  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(
    null
  );
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const images = useMemo(() => {
    if (!screenshotSet?.images) return [];
    return screenshotSet.images.filter((img) => img.url);
  }, [screenshotSet]);

  const currentImage =
    selectedImageIndex !== null ? images[selectedImageIndex] : null;

  const goNext = useCallback(() => {
    if (selectedImageIndex === null) return;
    setSelectedImageIndex((prev) =>
      prev !== null ? (prev + 1) % images.length : 0
    );
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [selectedImageIndex, images.length]);

  const goPrev = useCallback(() => {
    if (selectedImageIndex === null) return;
    setSelectedImageIndex((prev) =>
      prev !== null ? (prev - 1 + images.length) % images.length : 0
    );
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [selectedImageIndex, images.length]);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  if (!screenshotSet) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-100 p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent" />
          <span className="text-sm text-neutral-500">Loading...</span>
        </div>
      </div>
    );
  }

  const capturedAt = new Date(screenshotSet.capturedAt);
  const relativeTime = formatDistanceToNow(capturedAt, { addSuffix: true });

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {setRef.agentName}
          </span>
          <StatusBadge status={screenshotSet.status} />
        </div>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {relativeTime}
        </span>
      </div>

      {/* Images grid */}
      {images.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 p-3">
          {images.map((image, index) => (
            <button
              key={image.storageId}
              onClick={() => setSelectedImageIndex(index)}
              className="group relative aspect-video overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100 transition hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-neutral-500"
            >
              <img
                src={image.url ?? undefined}
                alt={image.fileName ?? `Screenshot ${index + 1}`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/20 group-hover:opacity-100">
                <Maximize2 className="h-5 w-5 text-white" />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="p-4 text-center text-sm text-neutral-500 dark:text-neutral-400">
          {screenshotSet.status === "failed"
            ? "Screenshot capture failed"
            : "No images in this set"}
        </div>
      )}

      {/* Lightbox dialog */}
      <Dialog.Root
        open={selectedImageIndex !== null}
        onOpenChange={(open) => !open && setSelectedImageIndex(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[90vw] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-neutral-200 bg-white p-4 shadow-xl focus:outline-none dark:border-neutral-800 dark:bg-neutral-950">
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
              <Dialog.Title className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {currentImage?.fileName ?? `Screenshot ${(selectedImageIndex ?? 0) + 1}`}
              </Dialog.Title>
              <div className="flex items-center gap-2">
                {/* Zoom controls */}
                <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900">
                  <button
                    onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                    className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    disabled={zoom <= 0.25}
                  >
                    <ZoomOut className="h-4 w-4" />
                  </button>
                  <span className="min-w-[3rem] text-center text-xs font-medium">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                    className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    disabled={zoom >= 4}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                  <button
                    onClick={resetZoom}
                    className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                </div>

                <Dialog.Close asChild>
                  <button className="rounded-lg p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                    <X className="h-5 w-5" />
                  </button>
                </Dialog.Close>
              </div>
            </div>

            {/* Image */}
            <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-900">
              {currentImage && (
                <img
                  src={currentImage.url ?? undefined}
                  alt={currentImage.fileName ?? "Screenshot"}
                  className="max-h-full max-w-full object-contain"
                  style={{
                    transform: `scale(${zoom}) translate(${offset.x}px, ${offset.y}px)`,
                    transition: "transform 0.1s ease-out",
                  }}
                  draggable={false}
                />
              )}

              {/* Navigation arrows */}
              {images.length > 1 && (
                <>
                  <button
                    onClick={goPrev}
                    className="absolute left-2 rounded-full bg-white/90 p-2 shadow hover:bg-white dark:bg-neutral-800/90 dark:hover:bg-neutral-800"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    onClick={goNext}
                    className="absolute right-2 rounded-full bg-white/90 p-2 shadow hover:bg-white dark:bg-neutral-800/90 dark:hover:bg-neutral-800"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>

            {/* Thumbnail strip */}
            {images.length > 1 && (
              <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                {images.map((img, index) => (
                  <button
                    key={img.storageId}
                    onClick={() => {
                      setSelectedImageIndex(index);
                      resetZoom();
                    }}
                    className={cn(
                      "h-16 w-24 flex-shrink-0 overflow-hidden rounded border transition",
                      index === selectedImageIndex
                        ? "border-emerald-500 ring-2 ring-emerald-500/30"
                        : "border-neutral-300 hover:border-neutral-400 dark:border-neutral-700"
                    )}
                  >
                    <img
                      src={img.url ?? undefined}
                      alt={img.fileName ?? `Thumbnail ${index + 1}`}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: "completed" | "failed" | "skipped";
}) {
  const config = {
    completed: {
      label: "Captured",
      className:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    },
    failed: {
      label: "Failed",
      className: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
    },
    skipped: {
      label: "Skipped",
      className: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800",
    },
  };

  const { label, className } = config[status];

  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", className)}>
      {label}
    </span>
  );
}
