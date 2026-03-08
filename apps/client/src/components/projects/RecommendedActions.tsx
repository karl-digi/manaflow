/**
 * RecommendedActions Component
 *
 * Displays recommended actions from Obsidian vault with dispatch capability.
 * Currently shows a placeholder - will be fully functional when vault API is integrated.
 */

import {
  CheckSquare,
  FolderOpen,
} from "lucide-react";
import clsx from "clsx";
import { Button } from "@/components/ui/button";

interface RecommendedAction {
  type: "todo" | "stale_note" | "missing_docs" | "broken_link";
  source: string;
  description: string;
  priority: "high" | "medium" | "low";
  suggestedPrompt?: string;
}

interface RecommendedActionsProps {
  teamSlugOrId: string;
  className?: string;
  limit?: number;
  showDispatch?: boolean;
  onActionDispatch?: (action: RecommendedAction, taskId: string) => void;
}

export function RecommendedActions({
  teamSlugOrId: _teamSlugOrId,
  className,
  limit: _limit = 10,
  showDispatch: _showDispatch = true,
  onActionDispatch: _onActionDispatch,
}: RecommendedActionsProps) {
  // Placeholder implementation - vault API integration coming soon
  return (
    <div className={clsx("rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
          Recommended Actions
        </h3>
      </div>

      {/* Placeholder */}
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <FolderOpen className="size-8 text-neutral-400" />
        <div>
          <p className="font-medium text-neutral-900 dark:text-neutral-100">
            Obsidian Integration
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            Configure your vault to see recommendations.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled>
          <CheckSquare className="mr-2 size-4" />
          Coming Soon
        </Button>
      </div>
    </div>
  );
}
