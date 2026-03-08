interface LargeDiffPlaceholderProps {
  totalLines: number;
  additions: number;
  deletions: number;
  onLoadAnyway: () => void;
}

export function LargeDiffPlaceholder({
  totalLines,
  additions,
  deletions,
  onLoadAnyway,
}: LargeDiffPlaceholderProps) {
  return (
    <div className="border-t border-amber-200/60 bg-amber-50/60 p-4 dark:border-amber-700/30 dark:bg-amber-500/10">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm text-neutral-600 dark:text-neutral-300">
          <span className="font-medium text-amber-700 dark:text-amber-400">
            Large file
          </span>
          <span className="ml-4">
            {totalLines.toLocaleString()} lines changed
            <span className="ml-2 text-green-600 dark:text-green-400">
              +{additions.toLocaleString()}
            </span>
            <span className="ml-1 text-red-600 dark:text-red-400">
              -{deletions.toLocaleString()}
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={onLoadAnyway}
          className="text-sm text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          Load diff anyway
        </button>
      </div>
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        Large diffs may slow down your browser.
      </p>
    </div>
  );
}
