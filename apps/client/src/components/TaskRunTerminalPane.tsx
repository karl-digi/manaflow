import { TaskRunTerminals } from "@/routes/_layout.$teamSlugOrId.task.$taskId.run.$runId.terminals";

export interface TaskRunTerminalPaneProps {
  workspaceUrl: string | null;
}

export function TaskRunTerminalPane(_props: TaskRunTerminalPaneProps) {
  return <TaskRunTerminals />;
}
