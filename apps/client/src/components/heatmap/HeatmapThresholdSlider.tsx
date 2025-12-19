/**
 * Heatmap threshold slider component.
 */

import { memo, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";

export interface HeatmapThresholdSliderProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}

function HeatmapThresholdSliderInner({
  value,
  onChange,
  disabled,
  className,
  label = "Threshold",
}: HeatmapThresholdSliderProps) {
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = Number.parseInt(event.target.value, 10);
      if (Number.isFinite(newValue)) {
        onChange(newValue);
      }
    },
    [onChange]
  );

  const displayValue = useMemo(() => {
    return `${value}%`;
  }, [value]);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-neutral-600 dark:text-neutral-400 select-none">
          {label}
        </span>
        <span className="font-mono text-neutral-500 dark:text-neutral-500 tabular-nums">
          {displayValue}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        className="cmux-heatmap-slider"
        aria-label={label}
      />
    </div>
  );
}

export const HeatmapThresholdSlider = memo(HeatmapThresholdSliderInner);
