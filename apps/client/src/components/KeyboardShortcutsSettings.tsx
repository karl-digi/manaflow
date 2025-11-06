import {
  DEFAULT_SHORTCUTS,
  formatShortcutForDisplay,
  SHORTCUTS_CONFIG,
} from "@cmux/shared";
import { useEffect, useRef, useState } from "react";

interface KeyboardShortcutsSettingsProps {
  shortcuts: Record<string, string>;
  onChange: (key: string, value: string) => void;
  isElectron: boolean;
}

export function KeyboardShortcutsSettings({
  shortcuts,
  onChange,
  isElectron,
}: KeyboardShortcutsSettingsProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!editingKey) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const keys: string[] = [];
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

      // Add modifiers
      if (e.metaKey && isMac) {
        keys.push("mod");
      } else if (e.ctrlKey && !isMac && !e.metaKey) {
        keys.push("mod");
      } else if (e.ctrlKey) {
        keys.push("ctrl");
      }

      if (e.shiftKey) keys.push("shift");
      if (e.altKey) keys.push("alt");

      // Add the actual key (ignore modifier keys themselves)
      if (
        e.key !== "Control" &&
        e.key !== "Shift" &&
        e.key !== "Alt" &&
        e.key !== "Meta"
      ) {
        let key = e.key.toLowerCase();
        // Normalize arrow keys
        if (key.startsWith("arrow")) {
          key = key.replace("arrow", "");
        }
        keys.push(key);
      }

      if (keys.length > 0) {
        setRecordedKeys(keys);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Only commit the shortcut if we have at least one modifier and a key
      if (recordedKeys.length >= 2) {
        const shortcut = recordedKeys.join("+");
        onChange(editingKey, shortcut);
        setEditingKey(null);
        setRecordedKeys([]);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [editingKey, recordedKeys, onChange]);

  const handleEdit = (key: string) => {
    setEditingKey(key);
    setRecordedKeys([]);
    setTimeout(() => {
      inputRefs.current[key]?.focus();
    }, 0);
  };

  const handleCancel = () => {
    setEditingKey(null);
    setRecordedKeys([]);
  };

  const handleReset = (key: string) => {
    onChange(
      key,
      DEFAULT_SHORTCUTS[key as keyof typeof DEFAULT_SHORTCUTS]
    );
  };

  const getDisplayValue = (key: string) => {
    if (editingKey === key) {
      return recordedKeys.length > 0
        ? recordedKeys.join("+")
        : "Press keys...";
    }
    return formatShortcutForDisplay(
      shortcuts[key] ||
        DEFAULT_SHORTCUTS[key as keyof typeof DEFAULT_SHORTCUTS]
    );
  };

  const filteredShortcuts = Object.entries(SHORTCUTS_CONFIG).filter(
    ([_, config]) => !config.electronOnly || isElectron
  );

  return (
    <div className="space-y-3">
      {filteredShortcuts.map(([key, config]) => {
        const currentValue =
          shortcuts[key] ||
          DEFAULT_SHORTCUTS[key as keyof typeof DEFAULT_SHORTCUTS];
        const isDefault =
          currentValue ===
          DEFAULT_SHORTCUTS[key as keyof typeof DEFAULT_SHORTCUTS];
        const isEditing = editingKey === key;

        return (
          <div
            key={key}
            className="flex items-center justify-between gap-4 py-2"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {config.label}
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                {config.description}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={(el) => {
                  inputRefs.current[key] = el;
                }}
                type="text"
                value={getDisplayValue(key)}
                readOnly
                onClick={() => !isEditing && handleEdit(key)}
                className={`w-40 px-3 py-1.5 text-sm font-mono text-center border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer ${
                  isEditing
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                    : "border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 hover:border-neutral-400 dark:hover:border-neutral-600"
                }`}
              />
              {isEditing ? (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-2 py-1.5 text-xs text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                >
                  Cancel
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleEdit(key)}
                    className="px-2 py-1.5 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    Edit
                  </button>
                  {!isDefault && (
                    <button
                      type="button"
                      onClick={() => handleReset(key)}
                      className="px-2 py-1.5 text-xs text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                    >
                      Reset
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
