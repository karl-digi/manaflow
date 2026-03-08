import clsx from "clsx";
import type { ReactNode } from "react";
import { SettingRow } from "./SettingRow";

interface SegmentedOption {
  value: string;
  label: string;
}

interface SettingSegmentedProps {
  label: ReactNode;
  description?: ReactNode;
  value: string;
  options: SegmentedOption[];
  onValueChange: (value: string) => void;
  noBorder?: boolean;
}

export function SettingSegmented({
  label,
  description,
  value,
  options,
  onValueChange,
  noBorder,
}: SettingSegmentedProps) {
  return (
    <SettingRow label={label} description={description} noBorder={noBorder}>
      <div className="inline-flex w-full items-center rounded-lg border border-neutral-200 bg-white p-1 dark:border-neutral-700 dark:bg-neutral-900 sm:w-auto">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onValueChange(option.value)}
              className={clsx(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none",
                active
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </SettingRow>
  );
}
