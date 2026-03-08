import { Users } from "lucide-react";
import { OrchestrationTaskRow } from "./OrchestrationTaskRow";
import type { OrchestrationTaskWithDeps } from "./OrchestrationDashboard";

interface OrchestrationTaskListProps {
  teamSlugOrId: string;
  tasks?: OrchestrationTaskWithDeps[];
  loading: boolean;
}

export function OrchestrationTaskList({
  teamSlugOrId,
  tasks,
  loading,
}: OrchestrationTaskListProps) {
  if (loading) {
    return (
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="animate-pulse px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="h-5 w-16 rounded bg-neutral-200 dark:bg-neutral-700" />
              <div className="h-4 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
            </div>
            <div className="mt-2 h-4 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="mt-2 h-3 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
          </div>
        ))}
      </div>
    );
  }

  if (!tasks || tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-neutral-500 dark:text-neutral-400">
        <Users className="size-8 text-neutral-400 dark:text-neutral-500" />
        <div className="text-sm font-medium text-neutral-600 dark:text-neutral-200">
          No orchestration tasks
        </div>
        <p className="text-xs">
          Spawn an agent or use the CLI to create tasks
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {tasks.map((task) => (
        <OrchestrationTaskRow
          key={task._id}
          task={task}
          teamSlugOrId={teamSlugOrId}
        />
      ))}
    </div>
  );
}
