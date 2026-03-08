/**
 * ProjectProgress Component
 *
 * Displays project progress with a circular indicator and status counts.
 */

import { CheckCircle2, Clock, Play, XCircle, Slash } from "lucide-react";
import clsx from "clsx";

interface ProjectProgressProps {
  total: number;
  completed: number;
  running: number;
  failed: number;
  pending: number;
  cancelled?: number;
  progressPercent: number;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const STATUS_CONFIG = [
  {
    key: "completed",
    label: "Completed",
    icon: CheckCircle2,
    color: "text-green-500",
    bgColor: "bg-green-500",
  },
  {
    key: "running",
    label: "Running",
    icon: Play,
    color: "text-blue-500",
    bgColor: "bg-blue-500",
  },
  {
    key: "pending",
    label: "Pending",
    icon: Clock,
    color: "text-amber-500",
    bgColor: "bg-amber-500",
  },
  {
    key: "failed",
    label: "Failed",
    icon: XCircle,
    color: "text-red-500",
    bgColor: "bg-red-500",
  },
  {
    key: "cancelled",
    label: "Cancelled",
    icon: Slash,
    color: "text-neutral-500",
    bgColor: "bg-neutral-500",
  },
] as const;

const SIZE_CONFIG = {
  sm: {
    container: "size-16",
    text: "text-lg",
    ring: 8,
  },
  md: {
    container: "size-24",
    text: "text-2xl",
    ring: 10,
  },
  lg: {
    container: "size-32",
    text: "text-3xl",
    ring: 12,
  },
};

export function ProjectProgress({
  total,
  completed,
  running,
  failed,
  pending,
  cancelled = 0,
  progressPercent,
  className,
  size = "md",
}: ProjectProgressProps) {
  const sizeConfig = SIZE_CONFIG[size];
  const radius = size === "sm" ? 24 : size === "md" ? 40 : 56;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  const counts = {
    completed,
    running,
    pending,
    failed,
    cancelled,
  };

  // Determine color based on status
  const getProgressColor = () => {
    if (failed > 0) return "#ef4444"; // red
    if (running > 0) return "#3b82f6"; // blue
    if (completed === total && total > 0) return "#22c55e"; // green
    return "#a3a3a3"; // neutral
  };

  return (
    <div className={clsx("flex items-center gap-4", className)}>
      {/* Circular Progress */}
      <div className={clsx("relative", sizeConfig.container)}>
        <svg className="size-full -rotate-90" viewBox="0 0 100 100">
          {/* Background circle */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={sizeConfig.ring}
            className="text-neutral-200 dark:text-neutral-800"
          />
          {/* Progress circle */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={getProgressColor()}
            strokeWidth={sizeConfig.ring}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-500 ease-out"
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={clsx("font-semibold text-neutral-900 dark:text-neutral-100", sizeConfig.text)}>
            {progressPercent}%
          </span>
        </div>
      </div>

      {/* Status counts */}
      <div className="flex flex-col gap-1">
        {STATUS_CONFIG.map(({ key, label, icon: Icon, color }) => {
          const count = counts[key];
          if (count === 0) return null;

          return (
            <div key={key} className="flex items-center gap-2">
              <Icon className={clsx("size-4", color)} />
              <span className="text-sm text-neutral-600 dark:text-neutral-400">
                {count} {label.toLowerCase()}
              </span>
            </div>
          );
        })}
        {total === 0 && (
          <span className="text-sm text-neutral-500 dark:text-neutral-500">
            No tasks yet
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Compact progress bar variant
 */
interface ProgressBarProps {
  completed: number;
  running: number;
  failed: number;
  pending: number;
  total: number;
  className?: string;
}

export function ProjectProgressBar({
  completed,
  running,
  failed,
  pending: _pending,
  total,
  className,
}: ProgressBarProps) {
  if (total === 0) {
    return (
      <div className={clsx("h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-800", className)} />
    );
  }

  const completedPct = (completed / total) * 100;
  const runningPct = (running / total) * 100;
  const failedPct = (failed / total) * 100;

  return (
    <div className={clsx("flex h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800", className)}>
      {completedPct > 0 && (
        <div
          className="bg-green-500 transition-all duration-300"
          style={{ width: `${completedPct}%` }}
        />
      )}
      {runningPct > 0 && (
        <div
          className="bg-blue-500 transition-all duration-300"
          style={{ width: `${runningPct}%` }}
        />
      )}
      {failedPct > 0 && (
        <div
          className="bg-red-500 transition-all duration-300"
          style={{ width: `${failedPct}%` }}
        />
      )}
    </div>
  );
}
