"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  GitPullRequest,
  ExternalLink,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";

interface ReviewHeaderProps {
  repoFullName: string;
  pullNumber: number;
  status: "idle" | "running" | "completed" | "failed" | "partial";
  selectedAgents: string[];
}

export function ReviewHeader({
  repoFullName,
  pullNumber,
  status,
  selectedAgents,
}: ReviewHeaderProps) {
  const [owner, repo] = repoFullName.split("/");
  const prUrl = `https://github.com/${repoFullName}/pull/${pullNumber}`;

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-neutral-200 bg-white px-6 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center gap-4">
        {/* Logo/Back link */}
        <Link
          href={`/${owner}/${repo}/pull/${pullNumber}`}
          className="flex items-center gap-2 text-neutral-500 transition hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          <GitPullRequest className="h-5 w-5" />
          <span className="text-sm font-medium">Back to PR</span>
        </Link>

        <div className="h-6 w-px bg-neutral-200 dark:bg-neutral-800" />

        {/* PR info */}
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {repoFullName}
              </span>
              <span className="text-sm text-neutral-500 dark:text-neutral-400">
                #{pullNumber}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <span>Multi-Agent Review</span>
              <span>·</span>
              <span>{selectedAgents.length} agents</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Status indicator */}
        <ReviewStatusBadge status={status} />

        {/* External link to GitHub */}
        <a
          href={prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:border-neutral-600 dark:hover:bg-neutral-700"
        >
          GitHub
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </header>
  );
}

function ReviewStatusBadge({
  status,
}: {
  status: ReviewHeaderProps["status"];
}) {
  const config = {
    idle: {
      icon: Clock,
      label: "Not Started",
      className:
        "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
    },
    running: {
      icon: Loader2,
      label: "Reviewing",
      className:
        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
      iconClassName: "animate-spin",
    },
    completed: {
      icon: CheckCircle2,
      label: "Complete",
      className:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    },
    partial: {
      icon: CheckCircle2,
      label: "Partial",
      className:
        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    },
    failed: {
      icon: XCircle,
      label: "Failed",
      className: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
    },
  };

  const {
    icon: Icon,
    label,
    className,
    iconClassName,
  } = config[status] as {
    icon: typeof Clock;
    label: string;
    className: string;
    iconClassName?: string;
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium",
        className
      )}
    >
      <Icon className={cn("h-4 w-4", iconClassName)} />
      {label}
    </div>
  );
}
