import {
  type OptionItemRenderProps,
  WarningIndicator,
} from "@/components/ui/searchable-select";
import { clsx } from "clsx";
import { AlertTriangle, Minus, Plus } from "lucide-react";
import type { MouseEvent } from "react";

export const MAX_AGENT_COMMAND_COUNT = 6;

export function AgentCommandItem({
  opt,
  count = 0,
  onSelectValue,
  onWarningAction,
  onIncrement,
  onDecrement,
  itemComponent: ItemComponent,
  itemVariant,
}: OptionItemRenderProps) {
  if (opt.heading) {
    return (
      <div className="flex items-center gap-2 min-w-0 flex-1 pl-1 pr-3 py-1 h-[28px] text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">
        {opt.icon ? (
          <span className="shrink-0 inline-flex items-center justify-center">
            {opt.icon}
          </span>
        ) : null}
        <span className="truncate select-none">{opt.label}</span>
      </div>
    );
  }

  const handleSelect = () => {
    if (opt.isUnavailable) {
      return;
    }
    onSelectValue(opt.value);
  };

  const currentCount = count ?? 0;
  const canAdjustCount = Boolean(onIncrement && onDecrement);

  const handleDecrement = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!canAdjustCount || opt.isUnavailable || currentCount <= 0) return;
    onDecrement?.();
  };

  const handleIncrement = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (
      !canAdjustCount ||
      opt.isUnavailable ||
      currentCount >= MAX_AGENT_COMMAND_COUNT
    ) {
      return;
    }
    onIncrement?.();
  };

  const disableDecrease = Boolean(
    !canAdjustCount || opt.isUnavailable || currentCount <= 0
  );
  const disableIncrease = Boolean(
    !canAdjustCount ||
      opt.isUnavailable ||
      currentCount >= MAX_AGENT_COMMAND_COUNT
  );

  return (
    <ItemComponent
      variant={itemVariant}
      value={`${opt.label} ${opt.value}`}
      className={clsx(
        "flex items-center justify-between gap-2 text-[13.5px] py-1.5 h-[32px]",
        opt.isUnavailable
          ? "cursor-not-allowed text-neutral-500 dark:text-neutral-500"
          : null
      )}
      onSelect={handleSelect}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {opt.icon ? (
          <span className="shrink-0 inline-flex items-center justify-center">
            {opt.icon}
          </span>
        ) : null}
        <span className="truncate select-none">{opt.label}</span>
        {opt.warning ? (
          <WarningIndicator
            warning={opt.warning}
            onActivate={onWarningAction}
          />
        ) : opt.isUnavailable ? (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        ) : null}
      </div>
      <div className="flex items-center">
        {canAdjustCount && currentCount > 0 ? (
          <div className="flex items-center">
            <button
              type="button"
              onClick={handleDecrement}
              disabled={disableDecrease}
              className="inline-flex h-5 w-5 items-center justify-center text-neutral-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-300 dark:focus-visible:ring-neutral-500/40 hover:bg-neutral-200 dark:hover:bg-neutral-500/80 rounded-full transform translate-y-[1px]"
            >
              <span className="sr-only">Decrease {opt.label}</span>
              <Minus className="size-3" aria-hidden="true" />
            </button>
            <span className="inline-flex h-5 min-w-[1rem] items-center justify-center text-[12.5px] font-medium text-neutral-600 dark:text-neutral-200">
              {currentCount}
            </span>
            <button
              type="button"
              onClick={handleIncrement}
              disabled={disableIncrease}
              className="inline-flex h-5 w-5 items-center justify-center text-neutral-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-300 dark:focus-visible:ring-neutral-500/40 hover:bg-neutral-200 dark:hover:bg-neutral-500/80 rounded-full transform translate-y-[1px]"
            >
              <span className="sr-only">Increase {opt.label}</span>
              <Plus className="size-3" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    </ItemComponent>
  );
}

export default AgentCommandItem;
