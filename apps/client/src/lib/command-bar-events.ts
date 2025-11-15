export const COMMAND_BAR_OPEN_EVENT = "cmux:command-bar:open" as const;

export type CommandBarOpenPage =
  | "root"
  | "teams"
  | "local-workspaces"
  | "cloud-workspaces";

export type CommandBarOpenEventDetail = {
  page?: CommandBarOpenPage;
  search?: string;
  resetSearch?: boolean;
  openWithShift?: boolean;
};

export function dispatchCommandBarOpenEvent(
  detail?: CommandBarOpenEventDetail
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(COMMAND_BAR_OPEN_EVENT, {
      detail,
    })
  );
}
