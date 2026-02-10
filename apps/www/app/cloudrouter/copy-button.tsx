"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }).catch((err: unknown) => {
          console.error("Failed to copy:", err);
        });
      }}
      className="absolute right-2 top-2 rounded border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-500 transition hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:text-white"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
