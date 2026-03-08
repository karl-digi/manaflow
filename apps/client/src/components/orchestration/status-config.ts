import {
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Pause,
  Play,
} from "lucide-react";

export type TaskStatus = "pending" | "assigned" | "running" | "completed" | "failed" | "cancelled";

export const STATUS_CONFIG: Record<TaskStatus, { icon: React.ElementType; color: string; label: string; bgColor: string }> = {
  pending: { icon: Clock, color: "text-neutral-500", bgColor: "bg-neutral-100 dark:bg-neutral-800", label: "Pending" },
  assigned: { icon: Play, color: "text-blue-500", bgColor: "bg-blue-50 dark:bg-blue-900/20", label: "Assigned" },
  running: { icon: Loader2, color: "text-blue-500", bgColor: "bg-blue-100 dark:bg-blue-900/30", label: "Running" },
  completed: { icon: CheckCircle2, color: "text-green-500", bgColor: "bg-green-100 dark:bg-green-900/30", label: "Completed" },
  failed: { icon: XCircle, color: "text-red-500", bgColor: "bg-red-100 dark:bg-red-900/30", label: "Failed" },
  cancelled: { icon: Pause, color: "text-neutral-400", bgColor: "bg-neutral-100 dark:bg-neutral-800", label: "Cancelled" },
};
