/**
 * Scripts Section component - shared between client and www apps.
 *
 * Provides maintenance and dev script configuration UI.
 */

import clsx from "clsx";

export interface ScriptsSectionProps {
  maintenanceScript: string;
  onMaintenanceScriptChange: (value: string) => void;
  devScript: string;
  onDevScriptChange: (value: string) => void;
  /** Whether to show step badge */
  showStepBadge?: boolean;
  /** Step number for the badge */
  stepNumber?: number;
  /** Whether this step is completed */
  isDone?: boolean;
  /** Whether to use compact styling */
  compact?: boolean;
  /** Whether the section is initially expanded */
  defaultOpen?: boolean;
  className?: string;
}

export function ScriptsSection({
  maintenanceScript,
  onMaintenanceScriptChange,
  devScript,
  onDevScriptChange,
  showStepBadge = false,
  stepNumber = 1,
  isDone = false,
  compact = false,
  defaultOpen = true,
  className,
}: ScriptsSectionProps) {
  const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const titleSize = compact ? "text-[13px]" : "text-base";
  const contentPadding = compact ? "mt-3 pl-5" : "mt-4 pl-6";

  return (
    <details className={clsx("group", className)} open={defaultOpen}>
      <summary
        className={clsx(
          "flex items-center gap-2 cursor-pointer font-semibold text-neutral-900 dark:text-neutral-100 list-none",
          titleSize
        )}
      >
        <ChevronDownIcon
          className={clsx(
            iconSize,
            "text-neutral-400 transition-transform -rotate-90 group-open:rotate-0"
          )}
        />
        {showStepBadge && <StepBadge step={stepNumber} done={isDone} />}
        Maintenance and Dev Scripts
      </summary>
      <div className={clsx(contentPadding, "space-y-4")}>
        <div>
          <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">
            Maintenance Script
          </label>
          <textarea
            value={maintenanceScript}
            onChange={(e) => onMaintenanceScriptChange(e.target.value)}
            placeholder="npm install, bun install, pip install -r requirements.txt"
            rows={2}
            className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-xs font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 resize-none"
          />
          <p className="text-xs text-neutral-400 mt-1">
            Runs after git pull to install dependencies
          </p>
        </div>
        <div>
          <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">
            Dev Script
          </label>
          <textarea
            value={devScript}
            onChange={(e) => onDevScriptChange(e.target.value)}
            placeholder="npm run dev, bun dev, python manage.py runserver"
            rows={2}
            className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-xs font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 resize-none"
          />
          <p className="text-xs text-neutral-400 mt-1">
            Starts the development server
          </p>
        </div>
      </div>
    </details>
  );
}

function StepBadge({ step, done }: { step: number; done: boolean }) {
  return (
    <span
      className={clsx(
        "flex h-5 w-5 items-center justify-center rounded-full border text-[11px]",
        done
          ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-400/70 dark:bg-emerald-900/40 dark:text-emerald-100"
          : "border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
      )}
    >
      {done ? <CheckIcon className="h-3 w-3" /> : step}
    </span>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export { StepBadge };
