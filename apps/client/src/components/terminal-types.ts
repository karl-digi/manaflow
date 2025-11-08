export type TerminalConnectionState =
  | "connecting"
  | "open"
  | "closed"
  | "error";

export const CONNECTION_STATE_COLORS: Record<TerminalConnectionState, string> = {
  open: "bg-emerald-500",
  connecting: "bg-amber-500",
  closed: "bg-neutral-400 dark:bg-neutral-600",
  error: "bg-red-500",
};
