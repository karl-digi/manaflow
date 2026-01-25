type DockerPullToastProps = {
  imageName: string;
  status?: string;
  progressText?: string;
  percent?: number | null;
  layerId?: string;
};

const formatLayerId = (layerId?: string): string | undefined => {
  if (!layerId) {
    return undefined;
  }

  return layerId.length > 12 ? layerId.slice(0, 12) : layerId;
};

export function DockerPullToast({
  imageName,
  status,
  progressText,
  percent,
  layerId,
}: DockerPullToastProps) {
  const clampedPercent =
    typeof percent === "number"
      ? Math.min(Math.max(Math.round(percent), 0), 100)
      : null;
  const percentLabel =
    typeof clampedPercent === "number" ? `${clampedPercent}%` : undefined;
  const statusLabel = status?.trim() || "Pulling Docker layers";
  const layerLabel = formatLayerId(layerId);
  const detailLine = layerLabel
    ? `${statusLabel} • ${layerLabel}`
    : statusLabel;
  const progressLabel =
    progressText?.trim() ||
    (clampedPercent === null
      ? "Waiting for layer updates..."
      : `${clampedPercent}% complete`);
  const progressWidth =
    clampedPercent === null ? "35%" : `${clampedPercent}%`;
  const progressClassName =
    clampedPercent === null
      ? "animate-pulse-subtle bg-primary/70"
      : "bg-primary transition-[width] duration-200 ease-out";

  return (
    <div className="flex w-[360px] max-w-[90vw] items-start gap-3 rounded-2xl border border-neutral-200/80 bg-white/95 p-4 shadow-xl shadow-neutral-900/10 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/80 dark:shadow-neutral-900/40">
      <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900/5 dark:bg-neutral-50/10">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-500 border-t-transparent dark:border-neutral-400 dark:border-t-transparent" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
            Pulling Docker image
          </p>
          {percentLabel ? (
            <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
              {percentLabel}
            </span>
          ) : null}
        </div>
        <p className="mt-1 truncate text-xs font-mono text-neutral-600 dark:text-neutral-300">
          {imageName}
        </p>
        <div className="mt-3 space-y-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className={`h-full ${progressClassName}`}
              style={{ width: progressWidth }}
            />
          </div>
          <div className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            <span className="truncate">{detailLine}</span>
            <span className="truncate">{progressLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
