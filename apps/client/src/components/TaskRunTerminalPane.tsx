import { MonitorUp } from "lucide-react";
import { TaskRunTerminalsPane } from "@/routes/_layout.$teamSlugOrId.task.$taskId.run.$runId.terminals";

export interface TaskRunTerminalPaneProps {
  teamSlugOrId: string;
  taskRunId: string | null;
}

export function TaskRunTerminalPane({
  teamSlugOrId,
  taskRunId,
}: TaskRunTerminalPaneProps) {
  if (!taskRunId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
        <MonitorUp className="size-4" aria-hidden />
        <span>Select a run to open the terminal.</span>
      </div>
    );
  }

  return (
    <TaskRunTerminalsPane teamSlugOrId={teamSlugOrId} taskRunId={taskRunId} />
  );
}
