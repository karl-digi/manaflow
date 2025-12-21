/**
 * Framework Preset Select component - shared between client and www apps.
 *
 * This component provides a dropdown selector for framework presets that
 * auto-fills maintenance and dev scripts based on the selected framework.
 */

import type { ReactNode } from "react";
import clsx from "clsx";
import {
  type FrameworkPreset,
  type FrameworkIconKey,
  getAllFrameworkPresets,
} from "../../environment-config/types";
import {
  AngularLogo,
  NextLogo,
  NuxtLogo,
  ReactLogo,
  RemixLogo,
  SvelteLogo,
  ViteLogo,
  VueLogo,
  SparklesIcon,
} from "./framework-logos";

const FRAMEWORK_ICON_META: Record<
  FrameworkIconKey,
  { icon: ReactNode; bgClass: string; textClass: string }
> = {
  other: {
    icon: <SparklesIcon className="h-4 w-4" />,
    bgClass: "bg-neutral-200 dark:bg-neutral-800",
    textClass: "text-neutral-700 dark:text-neutral-100",
  },
  next: {
    icon: <NextLogo className="h-5 w-5" aria-hidden="true" />,
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  vite: {
    icon: <ViteLogo className="h-5 w-5" aria-hidden="true" />,
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  remix: {
    icon: <RemixLogo className="h-5 w-5" aria-hidden="true" />,
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  nuxt: {
    icon: <NuxtLogo className="h-5 w-5" aria-hidden="true" />,
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  svelte: {
    icon: <SvelteLogo className="h-5 w-5" aria-hidden="true" />,
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  angular: {
    icon: <AngularLogo className="h-5 w-5" aria-hidden="true" />,
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  react: {
    icon: <ReactLogo className="h-5 w-5" aria-hidden="true" />,
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  vue: {
    icon: <VueLogo className="h-5 w-5" aria-hidden="true" />,
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
};

export interface FrameworkIconBubbleProps {
  preset: FrameworkPreset;
  className?: string;
}

export function FrameworkIconBubble({ preset, className }: FrameworkIconBubbleProps) {
  const presets = getAllFrameworkPresets();
  const config = presets[preset];
  const meta = FRAMEWORK_ICON_META[config.icon] ?? FRAMEWORK_ICON_META.other;

  return (
    <span
      className={clsx(
        "flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 dark:border-neutral-800",
        meta.bgClass,
        meta.textClass,
        className
      )}
      aria-hidden="true"
    >
      {meta.icon}
    </span>
  );
}

export interface FrameworkPresetSelectProps {
  value: FrameworkPreset;
  onValueChange: (value: FrameworkPreset) => void;
  isLoading?: boolean;
  /**
   * Whether this is for multi-repo mode (workspace root above repo roots)
   * vs single-repo mode (workspace root === repo root).
   * Affects the helper text description.
   */
  isMultiRepo?: boolean;
  className?: string;
}

/**
 * A simple native select for framework presets.
 * This version uses a native select element for maximum compatibility
 * between React 18/19 and different environments.
 */
export function FrameworkPresetSelect({
  value,
  onValueChange,
  isLoading = false,
  isMultiRepo = true,
  className,
}: FrameworkPresetSelectProps) {
  const presets = getAllFrameworkPresets();
  const frameworkOptions = Object.keys(presets) as FrameworkPreset[];
  const config = presets[value];

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-2">
        <label
          id="framework-preset-label"
          className="block text-sm font-medium text-neutral-900 dark:text-neutral-100"
        >
          Framework Preset
        </label>
        {isLoading && (
          <span className="text-xs text-neutral-500 dark:text-neutral-400 animate-pulse">
            Detecting...
          </span>
        )}
      </div>
      <div className="relative">
        <div className="flex w-full items-center gap-3 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2.5 text-sm">
          <FrameworkIconBubble preset={value} />
          <div className="flex-1 min-w-0">
            <span className="block font-medium text-neutral-900 dark:text-neutral-100">
              {config.name}
            </span>
            <span className="block text-xs text-neutral-500 dark:text-neutral-400">
              Autofills install and dev scripts
            </span>
          </div>
          <ChevronDownIcon className="h-4 w-4 text-neutral-400 flex-shrink-0" />
        </div>
        <select
          aria-labelledby="framework-preset-label"
          value={value}
          onChange={(e) => onValueChange(e.target.value as FrameworkPreset)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        >
          {frameworkOptions.map((preset) => (
            <option key={preset} value={preset}>
              {presets[preset].name}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
        {isMultiRepo ? (
          <>
            Workspace root{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 text-[11px] text-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
              /root/workspace
            </code>{" "}
            contains your repos as subdirectories.
          </>
        ) : (
          <>
            Workspace root{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 text-[11px] text-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
              /root/workspace
            </code>{" "}
            maps directly to your repository root.
          </>
        )}
      </p>
    </div>
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

export { getAllFrameworkPresets };
