import clsx from "clsx";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { parseEnvBlock } from "../../utils/parse-env-block";

type IconComponent = React.ComponentType<{ className?: string }>;

export type EnvVar = { name: string; value: string; isSecret: boolean };

export type EnvVarsSectionProps = {
  envVars: EnvVar[];
  onUpdate: (updater: (prev: EnvVar[]) => EnvVar[]) => void;
  chevronIcon: IconComponent;
  eyeIcon: IconComponent;
  eyeOffIcon: IconComponent;
  minusIcon: IconComponent;
  plusIcon: IconComponent;
  headerPrefix?: ReactNode;
  title?: string;
  compact?: boolean;
  defaultOpen?: boolean;
  tipText?: string;
  maskedValue?: string;
  onToggle?: (open: boolean) => void;
};

const DEFAULT_MASKED_VALUE = "********";

export function EnvVarsSection({
  envVars,
  onUpdate,
  chevronIcon: ChevronDownIcon,
  eyeIcon: EyeIcon,
  eyeOffIcon: EyeOffIcon,
  minusIcon: MinusIcon,
  plusIcon: PlusIcon,
  headerPrefix,
  title = "Environment Variables",
  compact = false,
  defaultOpen = true,
  tipText = "Tip: Paste a .env file to auto-fill",
  maskedValue = DEFAULT_MASKED_VALUE,
  onToggle,
}: EnvVarsSectionProps) {
  const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const titleSize = compact ? "text-[13px]" : "text-base";
  const contentPadding = compact ? "mt-3 pl-5" : "mt-4 pl-6";
  const [areEnvValuesHidden, setAreEnvValuesHidden] = useState(true);
  const [activeEnvValueIndex, setActiveEnvValueIndex] = useState<number | null>(
    null
  );
  const keyInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(
    null
  );

  useEffect(() => {
    if (pendingFocusIndex === null) {
      return;
    }
    const el = keyInputRefs.current[pendingFocusIndex];
    if (!el) {
      setPendingFocusIndex(null);
      return;
    }
    setTimeout(() => {
      el.focus();
      try {
        el.scrollIntoView({ block: "nearest" });
      } catch {
        // noop
      }
    }, 0);
    setPendingFocusIndex(null);
  }, [pendingFocusIndex, envVars]);

  return (
    <details
      className="group"
      open={defaultOpen}
      onToggle={(event) => onToggle?.(event.currentTarget.open)}
    >
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
        <span>{title}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              setActiveEnvValueIndex(null);
              setAreEnvValuesHidden((prev) => !prev);
            }}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition p-0.5"
            aria-label={areEnvValuesHidden ? "Reveal values" : "Hide values"}
          >
            {areEnvValuesHidden ? (
              <EyeOffIcon className={iconSize} />
            ) : (
              <EyeIcon className={iconSize} />
            )}
          </button>
        </div>
      </summary>
      <div
        className={clsx(contentPadding, "space-y-2")}
        onPasteCapture={(event) => {
          const text = event.clipboardData?.getData("text") ?? "";
          if (text && (/\n/.test(text) || /(=|:)\s*\S/.test(text))) {
            event.preventDefault();
            const items = parseEnvBlock(text);
            if (items.length > 0) {
              onUpdate((prev) => {
                const map = new Map(
                  prev
                    .filter(
                      (row) =>
                        row.name.trim().length > 0 ||
                        row.value.trim().length > 0
                    )
                    .map((row) => [row.name, row] as const)
                );
                for (const item of items) {
                  if (!item.name) continue;
                  const existing = map.get(item.name);
                  if (existing) {
                    map.set(item.name, { ...existing, value: item.value });
                  } else {
                    map.set(item.name, {
                      name: item.name,
                      value: item.value,
                      isSecret: true,
                    });
                  }
                }
                const next = Array.from(map.values());
                next.push({ name: "", value: "", isSecret: true });
                setPendingFocusIndex(next.length - 1);
                return next;
              });
            }
          }
        }}
      >
        <div
          className="grid gap-2 text-xs text-neutral-500 items-center mb-1"
          style={{
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr) 40px",
          }}
        >
          <span>Name</span>
          <span>Value</span>
          <span />
        </div>
        {envVars.map((row, idx) => {
          const isEditingValue = activeEnvValueIndex === idx;
          const shouldMaskValue =
            areEnvValuesHidden &&
            row.value.trim().length > 0 &&
            !isEditingValue;
          return (
            <div
              key={idx}
              className="grid gap-2 items-center min-h-9"
              style={{
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr) 40px",
              }}
            >
              <input
                type="text"
                value={row.name}
                ref={(el) => {
                  keyInputRefs.current[idx] = el;
                }}
                onChange={(e) => {
                  onUpdate((prev) => {
                    const next = [...prev];
                    if (next[idx]) {
                      next[idx] = { ...next[idx], name: e.target.value };
                    }
                    return next;
                  });
                }}
                placeholder="EXAMPLE_NAME"
                className="w-full min-w-0 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 text-sm font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700"
              />
              <input
                type={shouldMaskValue ? "password" : "text"}
                value={shouldMaskValue ? maskedValue : row.value}
                onChange={
                  shouldMaskValue
                    ? undefined
                    : (e) => {
                        onUpdate((prev) => {
                          const next = [...prev];
                          if (next[idx]) {
                            next[idx] = {
                              ...next[idx],
                              value: e.target.value,
                            };
                          }
                          return next;
                        });
                      }
                }
                onFocus={() => setActiveEnvValueIndex(idx)}
                onBlur={() =>
                  setActiveEnvValueIndex((current) =>
                    current === idx ? null : current
                  )
                }
                readOnly={shouldMaskValue}
                placeholder="I9JU23NF394R6HH"
                className="w-full min-w-0 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 text-sm font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700"
              />
              <button
                type="button"
                disabled={envVars.length <= 1}
                onClick={() =>
                  onUpdate((prev) => {
                    const next = prev.filter((_, i) => i !== idx);
                    return next.length > 0
                      ? next
                      : [{ name: "", value: "", isSecret: true }];
                  })
                }
                className={clsx(
                  "h-9 w-9 rounded-md border border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 grid place-items-center",
                  envVars.length <= 1
                    ? "opacity-60 cursor-not-allowed"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                )}
                aria-label="Remove variable"
              >
                <MinusIcon className="w-4 h-4" />
              </button>
            </div>
          );
        })}
        <div className="mt-1">
          <button
            type="button"
            onClick={() =>
              onUpdate((prev) => [
                ...prev,
                { name: "", value: "", isSecret: true },
              ])
            }
            className="inline-flex items-center gap-2 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 px-3 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition"
          >
            <PlusIcon className="w-4 h-4" /> Add variable
          </button>
        </div>
      </div>
      <p
        className={clsx(
          "text-xs text-neutral-400 mt-4",
          compact ? "pl-5" : "pl-6"
        )}
      >
        {tipText}
      </p>
    </details>
  );
}
