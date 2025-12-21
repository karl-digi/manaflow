/**
 * Environment Variables Section component - shared between client and www apps.
 *
 * Provides environment variables configuration UI with:
 * - Add/remove variable rows
 * - Show/hide values toggle
 * - Paste .env file support
 */

import { useCallback, useRef, useState, useEffect } from "react";
import clsx from "clsx";
import { type EnvVar, parseEnvBlock } from "../../environment-config/types";
import { StepBadge } from "./scripts-section";

const MASKED_ENV_VALUE = "••••••••••••••••";

export interface EnvVarsSectionProps {
  envVars: EnvVar[];
  onEnvVarsChange: (envVars: EnvVar[]) => void;
  /** Whether env vars should be disabled (e.g., when "none" is selected) */
  envNone?: boolean;
  onEnvNoneChange?: (value: boolean) => void;
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

export function EnvVarsSection({
  envVars,
  onEnvVarsChange,
  envNone = false,
  onEnvNoneChange,
  showStepBadge = false,
  stepNumber = 2,
  isDone = false,
  compact = false,
  defaultOpen = true,
  className,
}: EnvVarsSectionProps) {
  const [areEnvValuesHidden, setAreEnvValuesHidden] = useState(true);
  const [activeEnvValueIndex, setActiveEnvValueIndex] = useState<number | null>(null);
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);
  const keyInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const titleSize = compact ? "text-[13px]" : "text-base";
  const contentPadding = compact ? "mt-3 pl-5" : "mt-4 pl-6";

  // Focus handling for newly added rows
  useEffect(() => {
    if (pendingFocusIndex !== null) {
      const el = keyInputRefs.current[pendingFocusIndex];
      if (el) {
        setTimeout(() => {
          el.focus();
          try {
            el.scrollIntoView({ block: "nearest" });
          } catch (_e) {
            void 0;
          }
        }, 0);
        setPendingFocusIndex(null);
      }
    }
  }, [pendingFocusIndex, envVars]);

  const updateEnvVars = useCallback(
    (updater: (prev: EnvVar[]) => EnvVar[]) => {
      onEnvVarsChange(updater(envVars));
    },
    [envVars, onEnvVarsChange]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? "";
      if (text && (/\n/.test(text) || /(=|:)\s*\S/.test(text))) {
        e.preventDefault();
        const items = parseEnvBlock(text);
        if (items.length > 0) {
          onEnvNoneChange?.(false);
          updateEnvVars((prev) => {
            const map = new Map(
              prev
                .filter(
                  (r) =>
                    r.name.trim().length > 0 || r.value.trim().length > 0
                )
                .map((r) => [r.name, r] as const)
            );
            for (const it of items) {
              if (!it.name) continue;
              const existing = map.get(it.name);
              if (existing) {
                map.set(it.name, { ...existing, value: it.value });
              } else {
                map.set(it.name, {
                  name: it.name,
                  value: it.value,
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
    },
    [onEnvNoneChange, updateEnvVars]
  );

  return (
    <details
      className={clsx("group", className)}
      open={defaultOpen}
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
        {showStepBadge && <StepBadge step={stepNumber} done={isDone} />}
        <span>Environment Variables</span>
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
        onPasteCapture={handlePaste}
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
                disabled={envNone}
                ref={(el) => {
                  keyInputRefs.current[idx] = el;
                }}
                onChange={(e) => {
                  onEnvNoneChange?.(false);
                  updateEnvVars((prev) => {
                    const next = [...prev];
                    if (next[idx])
                      next[idx] = { ...next[idx], name: e.target.value };
                    return next;
                  });
                }}
                placeholder="EXAMPLE_NAME"
                className="w-full min-w-0 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 text-sm font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <input
                type={shouldMaskValue ? "password" : "text"}
                value={shouldMaskValue ? MASKED_ENV_VALUE : row.value}
                disabled={envNone}
                onChange={
                  shouldMaskValue
                    ? undefined
                    : (e) => {
                        onEnvNoneChange?.(false);
                        updateEnvVars((prev) => {
                          const next = [...prev];
                          if (next[idx])
                            next[idx] = {
                              ...next[idx],
                              value: e.target.value,
                            };
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
                className="w-full min-w-0 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 text-sm font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <button
                type="button"
                disabled={envNone || envVars.length <= 1}
                onClick={() =>
                  updateEnvVars((prev) => {
                    const next = prev.filter((_, i) => i !== idx);
                    return next.length > 0
                      ? next
                      : [{ name: "", value: "", isSecret: true }];
                  })
                }
                className={clsx(
                  "h-9 w-9 rounded-md border border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 grid place-items-center",
                  envNone || envVars.length <= 1
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
              updateEnvVars((prev) => [
                ...prev,
                { name: "", value: "", isSecret: true },
              ])
            }
            disabled={envNone}
            className="inline-flex items-center gap-2 h-9 rounded-md border border-neutral-200 dark:border-neutral-800 px-3 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition disabled:opacity-60 disabled:cursor-not-allowed"
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
        Tip: Paste a .env file to auto-fill
      </p>
    </details>
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

function EyeIcon({ className }: { className?: string }) {
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
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
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
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

function MinusIcon({ className }: { className?: string }) {
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
      <path d="M5 12h14" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
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
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}
