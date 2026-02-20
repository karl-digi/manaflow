import clsx from "clsx";
import type { ReactNode } from "react";

interface SettingSectionProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
}

export function SettingSection({
  title,
  description,
  children,
  className,
  headerAction,
}: SettingSectionProps) {
  return (
    <section
      className={clsx(
        "overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950",
        className
      )}
    >
      <header className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                {description}
              </p>
            ) : null}
          </div>
          {headerAction}
        </div>
      </header>
      {children}
    </section>
  );
}
