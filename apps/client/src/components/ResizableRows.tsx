import clsx from "clsx";
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

interface ResizableRowsProps {
  top: React.ReactNode;
  bottom: React.ReactNode;
  storageKey?: string | null;
  defaultTopHeight?: number; // percentage (0-100)
  minTop?: number; // percentage (0-100)
  maxTop?: number; // percentage (0-100)
  separatorHeight?: number; // px
  className?: string;
  separatorClassName?: string;
}

export function ResizableRows({
  top,
  bottom,
  storageKey = "resizableRowsHeight",
  defaultTopHeight = 50,
  minTop = 20,
  maxTop = 80,
  separatorHeight = 6,
  className,
  separatorClassName,
}: ResizableRowsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const containerTopRef = useRef<number>(0);
  const containerHeightRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [topHeightPercent, setTopHeightPercent] = useState<number>(() => {
    if (!storageKey) {
      return defaultTopHeight;
    }
    const stored = localStorage.getItem(storageKey);
    const parsed = stored ? Number.parseFloat(stored) : defaultTopHeight;
    if (Number.isNaN(parsed)) return defaultTopHeight;
    return Math.min(Math.max(parsed, minTop), maxTop);
  });

  useEffect(() => {
    if (!storageKey) return;
    localStorage.setItem(storageKey, String(topHeightPercent));
  }, [topHeightPercent, storageKey]);

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (rafIdRef.current != null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        const containerTop = containerTopRef.current;
        const containerHeight = containerHeightRef.current;
        const clientY = e.clientY;
        const offsetY = clientY - containerTop;
        const newHeightPercent = Math.min(
          Math.max((offsetY / containerHeight) * 100, minTop),
          maxTop
        );
        setTopHeightPercent(newHeightPercent);
      });
    },
    [maxTop, minTop]
  );

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.classList.remove("select-none");
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    // Restore iframe pointer events
    const iframes = Array.from(document.querySelectorAll("iframe"));
    for (const el of iframes) {
      if (el instanceof HTMLIFrameElement) {
        const prev = el.dataset.prevPointerEvents;
        if (prev !== undefined) {
          if (prev === "__unset__") el.style.removeProperty("pointer-events");
          else el.style.pointerEvents = prev;
          delete el.dataset.prevPointerEvents;
        } else {
          el.style.removeProperty("pointer-events");
        }
      }
    }
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", stopResizing);
  }, [onMouseMove]);

  const startResizing = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsResizing(true);
      document.body.style.cursor = "row-resize";
      document.body.classList.add("select-none");
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        containerTopRef.current = rect.top;
        containerHeightRef.current = rect.height;
      }
      // Disable pointer events on iframes while dragging
      const iframes = Array.from(document.querySelectorAll("iframe"));
      for (const el of iframes) {
        if (el instanceof HTMLIFrameElement) {
          const current = el.style.pointerEvents;
          el.dataset.prevPointerEvents = current ? current : "__unset__";
          el.style.pointerEvents = "none";
        }
      }
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", stopResizing);
    },
    [onMouseMove, stopResizing]
  );

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [onMouseMove, stopResizing]);

  return (
    <div
      ref={containerRef}
      className={clsx(`flex flex-col h-full relative`, className)}
    >
      <div
        className="shrink-0 w-full"
        style={
          {
            height: `${topHeightPercent}%`,
            minHeight: `${topHeightPercent}%`,
            maxHeight: `${topHeightPercent}%`,
            userSelect: isResizing ? ("none" as const) : undefined,
          } as CSSProperties
        }
      >
        {top}
      </div>
      <div className="w-full block bg-neutral-200 dark:bg-neutral-800 h-[1px]"></div>
      <div className="flex-1 w-full">{bottom}</div>
      <div
        role="separator"
        aria-orientation="horizontal"
        onMouseDown={startResizing}
        className={clsx(
          "absolute inset-x-0 cursor-row-resize bg-transparent hover:bg-neutral-200 dark:hover:bg-neutral-800 active:bg-neutral-300 dark:active:bg-neutral-800",
          separatorClassName
        )}
        style={{
          height: `${separatorHeight}px`,
          minHeight: `${separatorHeight}px`,
          transform: `translateY(calc(${topHeightPercent}% - 50%))`,
          zIndex: "var(--z-sidebar-resize-handle)",
        }}
        title="Resize"
      />
    </div>
  );
}

export default ResizableRows;
