import { parseEnvBlock } from "@/lib/parseEnvBlock";
import type { EnvVar } from "@/types/environment";
import { Eye, EyeOff, Minus, Plus } from "lucide-react";
import { useCallback, useState, type ClipboardEvent } from "react";

const MASKED_ENV_VALUE = "••••••••••••••••";

type EnvVarsKeyValueGridProps = {
  envVars: EnvVar[];
  onUpdate: (updater: (prev: EnvVar[]) => EnvVar[]) => void;
  disabled?: boolean;
  title?: string;
  description?: string;
  footerRight?: React.ReactNode;
};

export function EnvVarsKeyValueGrid({
  envVars,
  onUpdate,
  disabled = false,
  title,
  description,
  footerRight,
}: EnvVarsKeyValueGridProps) {
  const [areEnvValuesHidden, setAreEnvValuesHidden] = useState(true);
  const [activeEnvValueIndex, setActiveEnvValueIndex] = useState<number | null>(
    null
  );

  const handleEnvPaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      const inputType = target.getAttribute?.("data-env-input");
      const text = event.clipboardData?.getData("text") ?? "";

      // Always allow normal paste into value fields (values can contain =, :, URLs, etc.)
      if (inputType === "value") {
        return;
      }

      if (!text || !/\n|=/.test(text)) {
        return;
      }
      event.preventDefault();
      const entries = parseEnvBlock(text);
      if (entries.length === 0) {
        return;
      }
      onUpdate((prev) => {
        const map = new Map(
          prev
            .filter(
              (row) =>
                row.name.trim().length > 0 || row.value.trim().length > 0
            )
            .map((row) => [row.name, row] as const)
        );
        for (const entry of entries) {
          if (!entry.name) continue;
          map.set(entry.name, {
            name: entry.name,
            value: entry.value,
            isSecret: true,
          });
        }
        return Array.from(map.values());
      });
    },
    [onUpdate]
  );

  return (
    <div className="space-y-1 pt-1" onPasteCapture={handleEnvPaste}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          {title && (
            <p className="text-xs font-medium text-neutral-900 dark:text-neutral-100">
              {title}
            </p>
          )}
          {description && (
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
          onClick={() => {
            setActiveEnvValueIndex(null);
            setAreEnvValuesHidden((previous) => !previous);
          }}
          aria-pressed={!areEnvValuesHidden}
          aria-label={
            areEnvValuesHidden
              ? "Show environment variable values"
              : "Hide environment variable values"
          }
          disabled={disabled}
        >
          {areEnvValuesHidden ? (
            <>
              <EyeOff className="h-3 w-3" />
              Reveal
            </>
          ) : (
            <>
              <Eye className="h-3 w-3" />
              Hide
            </>
          )}
        </button>
      </div>

      <div className="space-y-1.5">
        <div
          className="grid gap-2 text-[11px] font-medium text-neutral-600 dark:text-neutral-400 items-center"
          style={{ gridTemplateColumns: "3fr 7fr 36px" }}
        >
          <span>Key</span>
          <span>Value</span>
          <span />
        </div>

        <div className="space-y-1.5">
          {envVars.map((row, idx) => {
            const rowKey = idx;
            const isEditingValue = activeEnvValueIndex === idx;
            const shouldMaskValue =
              areEnvValuesHidden &&
              row.value.trim().length > 0 &&
              !isEditingValue;
            return (
              <div
                key={rowKey}
                className="grid gap-2 items-center"
                style={{
                  gridTemplateColumns: "3fr 7fr 36px",
                }}
              >
                <input
                  type="text"
                  value={row.name}
                  onChange={(event) => {
                    const value = event.target.value;
                    onUpdate((prev) => {
                      const next = [...prev];
                      const current = next[idx];
                      if (current) {
                        next[idx] = { ...current, name: value };
                      }
                      return next;
                    });
                  }}
                  placeholder="EXAMPLE_KEY"
                  data-env-input="key"
                  disabled={disabled}
                  className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs font-mono text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-600 dark:focus:border-neutral-600"
                />
                <input
                  type="text"
                  value={shouldMaskValue ? MASKED_ENV_VALUE : row.value}
                  onChange={
                    shouldMaskValue
                      ? undefined
                      : (event) => {
                          const value = event.target.value;
                          onUpdate((prev) => {
                            const next = [...prev];
                            const current = next[idx];
                            if (current) {
                              next[idx] = { ...current, value };
                            }
                            return next;
                          });
                        }
                  }
                  placeholder="secret-value"
                  readOnly={shouldMaskValue}
                  aria-readonly={shouldMaskValue || undefined}
                  onFocus={() => setActiveEnvValueIndex(idx)}
                  onBlur={() => {
                    setActiveEnvValueIndex((current) =>
                      current === idx ? null : current
                    );
                  }}
                  data-env-input="value"
                  disabled={disabled}
                  className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs font-mono text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-600 dark:focus:border-neutral-600 transition"
                />
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center text-neutral-400 transition-colors hover:text-neutral-600 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-500 dark:hover:text-neutral-300"
                  onClick={() => {
                    setActiveEnvValueIndex(null);
                    onUpdate((prev) => prev.filter((_, i) => i !== idx));
                  }}
                  aria-label="Remove variable"
                  disabled={disabled}
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-start justify-between gap-2 pt-1 pb-1">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] text-neutral-500 transition-colors hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-400 dark:hover:text-neutral-200"
          onClick={() =>
            onUpdate((prev) => [
              ...prev,
              {
                name: "",
                value: "",
                isSecret: true,
              },
            ])
          }
          disabled={disabled}
        >
          <Plus className="h-3.5 w-3.5" />
          Add variable
        </button>
        {footerRight}
      </div>
    </div>
  );
}
