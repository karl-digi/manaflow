'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "@cmux/convex/api";
import type { FunctionReturnType } from "convex/server";
import {
  AlertTriangle,
  Camera,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
} from "lucide-react";

import { cn } from "@/lib/utils";

type ScreenshotSet = FunctionReturnType<
  typeof api.github_pr_queries.listScreenshotSetsForPr
>[number];

type ScreenshotSets =
  | FunctionReturnType<
      typeof api.github_pr_queries.listScreenshotSetsForPr
    >
  | undefined;

const STATUS_LABEL: Record<ScreenshotSet["status"], string> = {
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};

const STATUS_STYLE: Record<ScreenshotSet["status"], string> = {
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  failed: "bg-rose-100 text-rose-700 border-rose-200",
  skipped: "bg-neutral-200 text-neutral-700 border-neutral-300",
};

function formatRelativeTimeFromNow(timestamp: number): string {
  const now = Date.now();
  const diffInSeconds = Math.round((now - timestamp) / 1000);

  const segments: {
    threshold: number;
    divisor: number;
    unit: Intl.RelativeTimeFormatUnit;
  }[] = [
    { threshold: 45, divisor: 1, unit: "second" },
    { threshold: 2700, divisor: 60, unit: "minute" }, // 45 minutes
    { threshold: 64_800, divisor: 3_600, unit: "hour" }, // 18 hours
    { threshold: 561_600, divisor: 86_400, unit: "day" }, // 6.5 days
    { threshold: 2_419_200, divisor: 604_800, unit: "week" }, // 4 weeks
    { threshold: 28_512_000, divisor: 2_629_746, unit: "month" }, // 11 months
  ];

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  for (const segment of segments) {
    if (Math.abs(diffInSeconds) < segment.threshold) {
      const value = Math.round(diffInSeconds / segment.divisor);
      return rtf.format(-value, segment.unit);
    }
  }

  const years = Math.round(diffInSeconds / 31_556_952);
  return rtf.format(-years, "year");
}

function formatShortSha(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 7);
}

function buildDescription(image: ScreenshotSet["images"][number]): string {
  const name = image.fileName?.trim();
  if (name) return name;
  if (image.description) return image.description;
  return "Screenshot";
}

export function PrReviewScreenshotGallery({
  screenshotSets,
  commitRef,
}: {
  screenshotSets: ScreenshotSets;
  commitRef?: string | null;
}) {
  const normalizedCommit = commitRef?.toLowerCase() ?? null;

  const sortedSets = useMemo(() => {
    if (!screenshotSets || screenshotSets.length === 0) {
      return [] as ScreenshotSet[];
    }

    const baseOrder = [...screenshotSets].sort(
      (a, b) => b.capturedAt - a.capturedAt
    );

    if (!normalizedCommit) {
      return baseOrder;
    }

    return baseOrder.sort((a, b) => {
      const aMatches =
        typeof a.commitSha === "string" &&
        a.commitSha.toLowerCase() === normalizedCommit;
      const bMatches =
        typeof b.commitSha === "string" &&
        b.commitSha.toLowerCase() === normalizedCommit;

      if (aMatches && !bMatches) return -1;
      if (bMatches && !aMatches) return 1;
      return b.capturedAt - a.capturedAt;
    });
  }, [normalizedCommit, screenshotSets]);

  const [activeSetId, setActiveSetId] = useState<string | null>(
    sortedSets[0]?._id ?? null
  );

  useEffect(() => {
    if (sortedSets.length === 0) {
      setActiveSetId(null);
      return;
    }
    if (!activeSetId || !sortedSets.some((set) => set._id === activeSetId)) {
      setActiveSetId(sortedSets[0]!._id);
    }
  }, [activeSetId, sortedSets]);

  const activeSet =
    sortedSets.find((set) => set._id === activeSetId) ?? sortedSets[0];

  const images = useMemo(
    () => (activeSet ? activeSet.images.filter((image) => image.url) : []),
    [activeSet]
  );

  const [activeImageIndex, setActiveImageIndex] = useState(0);

  useEffect(() => {
    setActiveImageIndex(0);
  }, [activeSet?._id]);

  const handlePreviousImage = useCallback(() => {
    setActiveImageIndex((previous) => {
      if (images.length === 0) return previous;
      return (previous - 1 + images.length) % images.length;
    });
  }, [images.length]);

  const handleNextImage = useCallback(() => {
    setActiveImageIndex((previous) => {
      if (images.length === 0) return previous;
      return (previous + 1) % images.length;
    });
  }, [images.length]);

  if (!activeSet) {
    return null;
  }

  const activeImage = images[activeImageIndex] ?? null;
  const commitLabel = formatShortSha(activeSet.commitSha);
  const hasImages = images.length > 0;

  return (
    <section className="rounded border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-sky-50 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Camera className="h-4 w-4" aria-hidden />
          </span>
          <div className="space-y-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
              UI screenshots
            </p>
            <p className="text-sm text-neutral-700">
              {hasImages
                ? `${images.length} ${images.length === 1 ? "image" : "images"} • captured ${formatRelativeTimeFromNow(activeSet.capturedAt)}`
                : `Captured ${formatRelativeTimeFromNow(activeSet.capturedAt)}`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeSet.hasUiChanges === false ? (
            <Pill className="border-amber-200 bg-white/90 text-amber-800">
              No UI changes detected
            </Pill>
          ) : null}
          {commitLabel ? (
            <Pill className="border-amber-200 bg-white/90 text-neutral-800">
              Commit {commitLabel}
            </Pill>
          ) : null}
          <Pill className={cn("bg-white/90", STATUS_STYLE[activeSet.status])}>
            {STATUS_LABEL[activeSet.status]}
          </Pill>
        </div>
      </div>

      {sortedSets.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {sortedSets.map((set) => {
            const isActive = set._id === activeSet._id;
            const setLabel = formatRelativeTimeFromNow(set.capturedAt);
            return (
              <button
                key={set._id}
                type="button"
                onClick={() => setActiveSetId(set._id)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-3 py-1 font-semibold transition",
                  isActive
                    ? "border-amber-300 bg-white text-amber-800 shadow-sm"
                    : "border-transparent bg-white/70 text-neutral-700 hover:border-amber-200"
                )}
                aria-pressed={isActive}
              >
                <Clock className="h-3.5 w-3.5" aria-hidden />
                <span>{setLabel}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {hasImages ? (
        <>
          <div className="relative mt-3 overflow-hidden rounded-lg border border-amber-200/80 bg-white">
            {activeImage ? (
              <img
                src={activeImage.url}
                alt={buildDescription(activeImage)}
                className="h-[320px] w-full bg-neutral-50 object-contain sm:h-[420px]"
                loading="lazy"
              />
            ) : null}
            {images.length > 1 ? (
              <>
                <NavButton
                  onClick={handlePreviousImage}
                  position="left"
                  ariaLabel="Previous screenshot"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </NavButton>
                <NavButton
                  onClick={handleNextImage}
                  position="right"
                  ariaLabel="Next screenshot"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </NavButton>
              </>
            ) : null}
            {activeImage ? (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-white via-white/90 to-transparent px-3 py-2 text-xs text-neutral-700">
                <div className="truncate font-semibold">
                  {buildDescription(activeImage)}
                </div>
                <a
                  href={activeImage.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-amber-700 underline decoration-amber-300 decoration-2 underline-offset-2 transition hover:text-amber-900"
                >
                  Open full size
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              </div>
            ) : null}
          </div>
          {images.length > 1 ? (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {images.map((image, index) => {
                const isActive = index === activeImageIndex;
                return (
                  <button
                    key={`${activeSet._id}-${image.storageId}-${index}`}
                    type="button"
                    onClick={() => setActiveImageIndex(index)}
                    className={cn(
                      "relative h-16 w-28 flex-none overflow-hidden rounded border text-left transition",
                      isActive
                        ? "border-amber-400 ring-2 ring-amber-200"
                        : "border-amber-100 hover:border-amber-200"
                    )}
                    aria-label={`Open screenshot ${index + 1}`}
                  >
                    <img
                      src={image.url ?? undefined}
                      alt={buildDescription(image)}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </button>
                );
              })}
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-3 flex items-center gap-2 rounded border border-dashed border-amber-200 bg-white/70 px-3 py-2 text-sm text-neutral-700">
          <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
          <p className="leading-relaxed">
            {activeSet.status === "failed"
              ? `Screenshot capture failed${activeSet.error ? `: ${activeSet.error}` : ""}`
              : "No screenshots were captured for this pull request yet."}
          </p>
        </div>
      )}
    </section>
  );
}

function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        className
      )}
    >
      {children}
    </span>
  );
}

function NavButton({
  children,
  position,
  ariaLabel,
  onClick,
}: {
  children: ReactNode;
  position: "left" | "right";
  ariaLabel: string;
  onClick: () => void;
}) {
  const isLeft = position === "left";
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "absolute top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-amber-200 bg-white/90 text-neutral-700 shadow-md transition hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500",
        isLeft ? "left-2" : "right-2"
      )}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}
