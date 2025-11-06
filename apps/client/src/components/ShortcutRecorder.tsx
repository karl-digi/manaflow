import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatShortcut,
  validateShortcut,
  type ShortcutConfig,
} from "@/lib/shortcuts";

interface ShortcutRecorderProps {
  value: ShortcutConfig;
  onChange: (config: ShortcutConfig) => void;
  label: string;
  description?: string;
}

export function ShortcutRecorder({
  value,
  onChange,
  label,
  description,
}: ShortcutRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isRecording) return;

      e.preventDefault();
      e.stopPropagation();

      // Ignore modifier-only presses
      if (
        ["Control", "Meta", "Shift", "Alt"].includes(e.key)
      ) {
        return;
      }

      const newConfig: ShortcutConfig = {
        key: e.key.toLowerCase(),
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      };

      const validation = validateShortcut(newConfig);
      if (!validation.valid) {
        setError(validation.error);
        return;
      }

      setError(undefined);
      onChange(newConfig);
      setIsRecording(false);
    },
    [isRecording, onChange]
  );

  const handleBlur = useCallback(() => {
    setIsRecording(false);
    setError(undefined);
  }, []);

  useEffect(() => {
    if (isRecording) {
      window.addEventListener("keydown", handleKeyDown, true);
      window.addEventListener("blur", handleBlur, true);
      return () => {
        window.removeEventListener("keydown", handleKeyDown, true);
        window.removeEventListener("blur", handleBlur, true);
      };
    }
    return undefined;
  }, [handleKeyDown, handleBlur, isRecording]);

  const displayValue = formatShortcut(value);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            {label}
          </label>
          {description && (
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              {description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            ref={inputRef}
            type="button"
            onClick={() => {
              setIsRecording(true);
              setError(undefined);
            }}
            className={`min-w-[120px] px-3 py-2 text-sm font-mono rounded-lg border transition-colors ${
              isRecording
                ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 animate-pulse"
                : "border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 hover:border-neutral-400 dark:hover:border-neutral-600"
            }`}
            aria-label={`Record keyboard shortcut for ${label}`}
          >
            {isRecording ? "Press keys..." : displayValue}
          </button>
          {!isRecording && (
            <button
              type="button"
              onClick={() => {
                setIsRecording(true);
                setError(undefined);
              }}
              className="px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
              aria-label={`Change shortcut for ${label}`}
            >
              Change
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 text-right">
          {error}
        </p>
      )}
    </div>
  );
}
