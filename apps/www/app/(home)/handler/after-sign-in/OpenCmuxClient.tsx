"use client";

import { JetBrains_Mono } from "next/font/google";
import { useCallback, useEffect, useRef, useState } from "react";

const jetbrains = JetBrains_Mono({ subsets: ["latin"], preload: true });

export function OpenCmuxClient({ href }: { href: string }) {
  const [showFallback, setShowFallback] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      window.location.href = href;
    } catch {
      console.error("Failed to open Manaflow", href);
    }
    // Show fallback after a delay if the page is still visible
    const timer = setTimeout(() => {
      setShowFallback(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, [href]);

  // Cleanup copied timer on unmount
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      console.error("Failed to copy to clipboard");
    }
  }, [href]);

  return (
    <div className={`min-h-dvh flex items-center justify-center p-6 bg-neutral-50 dark:bg-black ${jetbrains.className}`}>
      <div className="w-full max-w-md text-center rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-8 shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Opening Manaflow…
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
          If it doesn&apos;t open automatically, click the button below.
        </p>
        <div className="mt-5">
          <a
            href={href}
            className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 hover:opacity-90"
          >
            Open Manaflow
          </a>
        </div>

        {showFallback && (
          <div className="mt-6 pt-6 border-t border-neutral-200 dark:border-neutral-800">
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">
              Dev mode: If the link doesn&apos;t work, copy it and paste in terminal:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-neutral-100 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 px-3 py-2 rounded text-left overflow-hidden text-ellipsis whitespace-nowrap">
                open &quot;{href}&quot;
              </code>
              <button
                onClick={copyToClipboard}
                className="shrink-0 px-3 py-2 text-xs rounded bg-neutral-200 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-300 dark:hover:bg-neutral-700"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
