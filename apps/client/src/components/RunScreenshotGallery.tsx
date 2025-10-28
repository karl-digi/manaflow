import { formatDistanceToNow } from "date-fns";
import { ExternalLink } from "lucide-react";
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

export function RunScreenshotGallery(props: RunScreenshotGalleryProps) {
  const { screenshotSets, highlightedSetId } = props;
  if (!screenshotSets || screenshotSets.length === 0) {
    return null;
  }

  const effectiveHighlight =
    highlightedSetId ??
    (screenshotSets.length > 0 ? screenshotSets[0]._id : null);

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
                    const key = `${image.storageId}-${image.fileName ?? "unnamed"}`;
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
                      <a
                        key={key}
                        href={image.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group relative block rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/70 hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors overflow-hidden"
                      >
                        <img
                          src={image.url}
                          alt={image.fileName ?? "Screenshot"}
                          className="h-48 w-[220px] object-contain bg-neutral-100 dark:bg-neutral-950"
                          loading="lazy"
                        />
                        <div className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/80 text-neutral-600 opacity-0 shadow-sm transition group-hover:opacity-100 dark:bg-neutral-950/80 dark:text-neutral-300">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </div>
                        <div className="border-t border-neutral-200 dark:border-neutral-700 px-2 py-1 text-xs text-neutral-600 dark:text-neutral-300 truncate">
                          {image.fileName ?? "Screenshot"}
                        </div>
                      </a>
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
