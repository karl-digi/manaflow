import { useEffect } from "react";
import { useTheme } from "@/components/theme/use-theme";
import { useSocket } from "@/contexts/socket/use-socket";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@cmux/convex/api";
import { useParams } from "@tanstack/react-router";

/**
 * Hook that syncs the current theme to all active VSCode instances
 * when the user changes the theme in cmux settings.
 */
export function useThemeSync() {
  const { resolvedTheme } = useTheme();
  const { socket } = useSocket();
  const params = useParams({ strict: false });
  const teamSlugOrId = "teamSlugOrId" in params ? params.teamSlugOrId : undefined;

  // Get all active task runs for the current team
  const { data: tasks } = useQuery(
    teamSlugOrId
      ? convexQuery(api.tasks.getAll, { teamSlugOrId })
      : { enabled: false }
  );

  useEffect(() => {
    if (!socket || !tasks || resolvedTheme === undefined) {
      return;
    }

    // Get all active (non-archived) task runs
    const activeTaskRuns = tasks
      .filter((task) => !task.archivedAt)
      .flatMap((task) => task.runs || [])
      .filter((run) => run.vscode?.workspaceUrl); // Only runs with VSCode instances

    // Send theme update to all active VSCode instances
    activeTaskRuns.forEach((run) => {
      socket.emit(
        "set-theme",
        {
          taskRunId: run._id,
          theme: resolvedTheme,
        },
        (response) => {
          if (!response.success) {
            console.warn(
              `Failed to set theme for task run ${run._id}:`,
              response.error
            );
          }
        }
      );
    });
  }, [resolvedTheme, socket, tasks]);
}
