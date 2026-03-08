import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { SettingRow } from "./SettingRow";

interface SettingSelectOption {
  value: string;
  label: string;
}

interface SettingSelectProps {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  value: string;
  options: SettingSelectOption[];
  onValueChange: (value: string) => void;
  noBorder?: boolean;
}

export function SettingSelect({
  id,
  label,
  description,
  value,
  options,
  onValueChange,
  noBorder,
}: SettingSelectProps) {
  return (
    <SettingRow label={label} description={description} noBorder={noBorder}>
      <div className="relative w-full sm:w-64">
        <select
          id={id}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          className="w-full appearance-none rounded-lg border border-neutral-300 bg-white px-3 py-2 pr-9 text-sm text-neutral-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500 dark:text-neutral-400"
          aria-hidden
        />
      </div>
    </SettingRow>
  );
}
