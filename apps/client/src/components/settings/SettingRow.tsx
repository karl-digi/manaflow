import clsx from "clsx";
import type { ReactNode } from "react";

interface SettingRowProps {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  noBorder?: boolean;
}

export function SettingRow({
  label,
  description,
  children,
  className,
  noBorder = false,
}: SettingRowProps) {
  return (
    <div
      className={clsx(
        "flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6",
        !noBorder && "border-b border-neutral-200 dark:border-neutral-800",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {label}
        </p>
        {description ? (
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {description}
          </p>
        ) : null}
      </div>

      <div className="w-full sm:w-auto sm:flex-shrink-0">{children}</div>
    </div>
  );
}
