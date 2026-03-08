import {
  Clock,
  CheckCircle2,
  XCircle,
  Play,
} from "lucide-react";
import clsx from "clsx";

interface OrchestrationSummary {
  totalTasks: number;
  statusCounts: Record<string, number>;
  activeAgentCount: number;
  activeAgents: string[];
}

interface OrchestrationSummaryCardsProps {
  summary?: OrchestrationSummary;
  loading: boolean;
  onFilterChange: (status: string) => void;
  activeFilter: string;
}

const SUMMARY_CARDS = [
  {
    key: "pending",
    label: "Pending",
    icon: Clock,
    color: "text-amber-500",
    bgColor: "bg-amber-50 dark:bg-amber-900/20",
    borderColor: "border-amber-200 dark:border-amber-800/50",
  },
  {
    key: "running",
    label: "Running",
    icon: Play,
    color: "text-blue-500",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
    borderColor: "border-blue-200 dark:border-blue-800/50",
  },
  {
    key: "completed",
    label: "Completed",
    icon: CheckCircle2,
    color: "text-green-500",
    bgColor: "bg-green-50 dark:bg-green-900/20",
    borderColor: "border-green-200 dark:border-green-800/50",
  },
  {
    key: "failed",
    label: "Failed",
    icon: XCircle,
    color: "text-red-500",
    bgColor: "bg-red-50 dark:bg-red-900/20",
    borderColor: "border-red-200 dark:border-red-800/50",
  },
] as const;

export function OrchestrationSummaryCards({
  summary,
  loading,
  onFilterChange,
  activeFilter,
}: OrchestrationSummaryCardsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {SUMMARY_CARDS.map((card) => (
          <div
            key={card.key}
            className="animate-pulse rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="mb-2 h-4 w-16 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-8 w-12 rounded bg-neutral-200 dark:bg-neutral-700" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {SUMMARY_CARDS.map((card) => {
        const count = summary?.statusCounts[card.key] ?? 0;
        const isActive = activeFilter === card.key;
        const Icon = card.icon;

        return (
          <button
            key={card.key}
            type="button"
            onClick={() => onFilterChange(isActive ? "all" : card.key)}
            className={clsx(
              "rounded-lg border p-4 text-left transition-all hover:shadow-sm",
              isActive
                ? `${card.bgColor} ${card.borderColor}`
                : "border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
            )}
          >
            <div className="flex items-center gap-2">
              <Icon className={clsx("size-4", card.color)} />
              <span className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                {card.label}
              </span>
            </div>
            <div className="mt-2 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
              {count}
            </div>
          </button>
        );
      })}
    </div>
  );
}
