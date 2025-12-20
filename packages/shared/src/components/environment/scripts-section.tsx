import clsx from "clsx";
import type { ReactNode } from "react";

type IconComponent = React.ComponentType<{ className?: string }>;

export type ScriptsSectionProps = {
  maintenanceScript: string;
  devScript: string;
  onMaintenanceScriptChange: (value: string) => void;
  onDevScriptChange: (value: string) => void;
  chevronIcon: IconComponent;
  headerPrefix?: ReactNode;
  title?: string;
  compact?: boolean;
  defaultOpen?: boolean;
};

export function ScriptsSection({
  maintenanceScript,
  devScript,
  onMaintenanceScriptChange,
  onDevScriptChange,
  chevronIcon: ChevronDownIcon,
  headerPrefix,
  title = "Maintenance and Dev Scripts",
  compact = false,
  defaultOpen = true,
}: ScriptsSectionProps) {
  const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const titleSize = compact ? "text-[13px]" : "text-base";
  const contentPadding = compact ? "mt-3 pl-5" : "mt-4 pl-6";

  return (
    <details className="group" open={defaultOpen}>
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
        {headerPrefix}
        {title}
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
