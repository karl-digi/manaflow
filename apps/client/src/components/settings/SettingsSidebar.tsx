import { useSidebar } from "@/contexts/sidebar/SidebarContext";
import {
  disableDragPointerEvents,
  restoreDragPointerEvents,
} from "@/lib/drag-pointer-events";
import { isElectron } from "@/lib/electron";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";
import { ArrowLeft, KeyRound, Settings } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";

export type SettingsSection = "general" | "ai-providers";

interface SettingsSidebarProps {
  teamSlugOrId: string;
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}

interface SettingsSidebarNavItem {
  label: string;
  section: SettingsSection;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

const navItems: SettingsSidebarNavItem[] = [
  {
    label: "General",
    section: "general",
    icon: Settings,
  },
  {
    label: "AI Providers",
    section: "ai-providers",
    icon: KeyRound,
  },
];

export function SettingsSidebar({
  teamSlugOrId,
  activeSection,
  onSectionChange,
}: SettingsSidebarProps) {
  const DEFAULT_WIDTH = 256;
  const MIN_WIDTH = 240;
  const MAX_WIDTH = 600;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const containerLeftRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const [width, setWidth] = useState<number>(() => {
    const stored = localStorage.getItem("sidebarWidth");
    const parsed = stored ? Number.parseInt(stored, 10) : DEFAULT_WIDTH;
    if (Number.isNaN(parsed)) return DEFAULT_WIDTH;
    return Math.min(Math.max(parsed, MIN_WIDTH), MAX_WIDTH);
  });
  const [isResizing, setIsResizing] = useState(false);
  const { isHidden } = useSidebar();

  useEffect(() => {
    localStorage.setItem("sidebarWidth", String(width));
  }, [width]);

  const onMouseMove = useCallback((event: MouseEvent) => {
    if (rafIdRef.current != null) return;
    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      const containerLeft = containerLeftRef.current;
      const clientX = event.clientX;
      const newWidth = Math.min(
        Math.max(clientX - containerLeft, MIN_WIDTH),
        MAX_WIDTH
      );
      setWidth(newWidth);
    });
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.classList.remove("select-none");
    document.body.classList.remove("cmux-sidebar-resizing");
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    restoreDragPointerEvents();
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", stopResizing);
  }, [onMouseMove]);

  const startResizing = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.classList.add("select-none");
      document.body.classList.add("cmux-sidebar-resizing");
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        containerLeftRef.current = rect.left;
      }
      disableDragPointerEvents();
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

  const resetWidth = useCallback(() => setWidth(DEFAULT_WIDTH), []);

  return (
    <div
      ref={containerRef}
      className="relative flex h-dvh shrink-0 grow snap-always snap-start flex-col bg-neutral-50 pr-1 pt-1.5 dark:bg-neutral-900/50 md:w-auto md:snap-align-none"
      style={
        {
          display: isHidden ? "none" : "flex",
          width: undefined,
          minWidth: undefined,
          maxWidth: undefined,
          userSelect: isResizing ? ("none" as const) : undefined,
          "--sidebar-width": `${width}px`,
        } as CSSProperties
      }
    >
      <div
        className={`h-[38px] shrink-0 pr-2 ${isElectron ? "" : "pl-3"}`}
        style={{ WebkitAppRegion: "drag" } as CSSProperties}
      >
        {isElectron && <div className="w-[80px]" />}
      </div>

      <nav className="flex grow flex-col overflow-hidden pb-8">
        <Link
          to="/$teamSlugOrId/dashboard"
          params={{ teamSlugOrId }}
          className="pointer-default cursor-default group mb-1 ml-2 flex w-[calc(100%-8px)] items-center gap-2 rounded-sm pl-2 pr-2 py-1 text-left text-[13px] text-neutral-700 select-none hover:bg-neutral-200/45 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800/45 dark:hover:text-neutral-100"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <ArrowLeft
            className="size-[15px] text-neutral-500 group-hover:text-neutral-800 dark:group-hover:text-neutral-100"
            aria-hidden
          />
          <span>Back to app</span>
        </Link>

        <ul className="flex flex-col gap-px">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.section;
            return (
              <li key={item.section}>
                <button
                  type="button"
                  data-active={isActive ? "true" : undefined}
                  onClick={() => onSectionChange(item.section)}
                  className={clsx(
                    "pointer-default cursor-default group ml-2 flex w-[calc(100%-8px)] items-center gap-2 rounded-sm pl-2 pr-2 py-1 text-left text-[13px] text-neutral-900 select-none hover:bg-neutral-200/45 dark:text-neutral-100 dark:hover:bg-neutral-800/45",
                    isActive &&
                      "bg-neutral-200/75 text-black dark:bg-neutral-800/65 dark:text-white"
                  )}
                >
                  <Icon
                    className={clsx(
                      "size-[15px] text-neutral-500 group-hover:text-neutral-800 dark:group-hover:text-neutral-100",
                      isActive && "text-neutral-900 dark:text-neutral-100"
                    )}
                    aria-hidden
                  />
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
        onMouseDown={startResizing}
        onDoubleClick={resetWidth}
        className="absolute right-0 top-0 h-full cursor-col-resize"
        style={
          {
            width: "14px",
            transform: "translateX(7px)",
            background: "transparent",
            zIndex: "var(--z-sidebar-resize-handle)",
          } as CSSProperties
        }
      />
    </div>
  );
}
