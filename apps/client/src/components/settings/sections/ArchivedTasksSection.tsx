import { env } from "@/client-env";
import { TaskItem } from "@/components/dashboard/TaskItem";
import { SettingSection } from "@/components/settings/SettingSection";
import { api } from "@cmux/convex/api";
import { usePaginatedQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";

const ARCHIVED_PAGE_SIZE = 20;

interface ArchivedTasksSectionProps {
  teamSlugOrId: string;
}

export function ArchivedTasksSection({ teamSlugOrId }: ArchivedTasksSectionProps) {
  // In web mode, exclude local workspaces
  const excludeLocalWorkspaces = env.NEXT_PUBLIC_WEB_MODE || undefined;

  const {
    results: archivedTasks,
    status: archivedStatus,
    loadMore: loadMoreArchived,
  } = usePaginatedQuery(
    api.tasks.getArchivedPaginated,
    { teamSlugOrId, excludeLocalWorkspaces },
    { initialNumItems: ARCHIVED_PAGE_SIZE },
  );

  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);

  // Infinite scroll for archived tasks
  useEffect(() => {
    if (archivedStatus !== "CanLoadMore") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMoreArchived(ARCHIVED_PAGE_SIZE);
        }
      },
      { threshold: 0.1 },
    );

    const trigger = loadMoreTriggerRef.current;
    if (trigger) {
      observer.observe(trigger);
    }

    return () => {
      if (trigger) {
        observer.unobserve(trigger);
      }
    };
  }, [archivedStatus, loadMoreArchived]);

  return (
    <div className="space-y-4">
      <SettingSection
        title="Archived Tasks"
        description="Tasks that have been archived. You can unarchive them from the task detail page."
      >
        <div className="max-h-[600px] overflow-y-auto">
          {archivedStatus === "LoadingFirstPage" ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-500 dark:text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading archived tasks...</span>
            </div>
          ) : archivedTasks.length === 0 ? (
            <div className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
              No archived tasks
            </div>
          ) : (
            <div className="flex flex-col">
              {archivedTasks.map((task) => (
                <TaskItem
                  key={task._id}
                  task={task}
                  teamSlugOrId={teamSlugOrId}
                />
              ))}
              {/* Infinite scroll trigger */}
              <div ref={loadMoreTriggerRef} className="w-full py-2">
                {archivedStatus === "LoadingMore" && (
                  <div className="flex items-center justify-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Loading more...</span>
                  </div>
                )}
                {archivedStatus === "CanLoadMore" && (
                  <div className="h-1" />
                )}
              </div>
            </div>
          )}
        </div>
      </SettingSection>
    </div>
  );
}
