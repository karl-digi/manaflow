import type { RouteTitleStaticData } from "./route-metadata";
import { formatRouteTitle } from "./route-metadata";

const strParam = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

const withTeam = (
  params: Record<string, unknown>,
  ...parts: Array<string | undefined>
) =>
  formatRouteTitle(strParam(params.teamSlugOrId), ...parts) ??
  formatRouteTitle(...parts);

const withTaskContext = (
  params: Record<string, unknown>,
  ...parts: Array<string | undefined>
) =>
  formatRouteTitle(
    strParam(params.teamSlugOrId),
    strParam(params.taskId) ? `Task ${strParam(params.taskId)}` : undefined,
    ...parts
  );

const withRunContext = (
  params: Record<string, unknown>,
  ...parts: Array<string | undefined>
) =>
  formatRouteTitle(
    strParam(params.teamSlugOrId),
    strParam(params.taskId) ? `Task ${strParam(params.taskId)}` : undefined,
    strParam(params.runId) ? `Run ${strParam(params.runId)}` : undefined,
    ...parts
  );

export const ROUTE_TITLES: Record<string, RouteTitleStaticData> = {
  "/": {
    title: "Team Redirect",
  },
  "/sign-in": {
    title: "Sign In",
  },
  "/_layout": {
    title: "App Shell",
  },
  "/_layout/team-picker": {
    title: "Team Picker",
  },
  "/_layout/profile": {
    title: "Profile",
  },
  "/_layout/debug": {
    title: "Debug Console",
  },
  "/_layout/$teamSlugOrId": {
    title: "Team Workspace",
    formatTitle: ({ params }) =>
      withTeam(params, "Workspace") || "Team Workspace",
  },
  "/_layout/$teamSlugOrId/connect-complete": {
    title: "GitHub Connect Complete",
    formatTitle: ({ params }) =>
      withTeam(params, "GitHub Connect") || "GitHub Connect Complete",
  },
  "/_layout/$teamSlugOrId/dashboard": {
    title: "Dashboard",
    formatTitle: ({ params }) =>
      withTeam(params, "Dashboard") || "Dashboard",
  },
  "/_layout/$teamSlugOrId/diff": {
    title: "Team Diff",
    formatTitle: ({ params }) =>
      withTeam(params, "Diff Viewer") || "Team Diff",
  },
  "/_layout/$teamSlugOrId/environments": {
    title: "Environments",
    formatTitle: ({ params }) =>
      withTeam(params, "Environments") || "Environments",
  },
  "/_layout/$teamSlugOrId/environments/": {
    title: "Environment Overview",
    formatTitle: ({ params }) =>
      withTeam(params, "Environment Overview") || "Environment Overview",
  },
  "/_layout/$teamSlugOrId/environments/$environmentId": {
    title: "Environment Details",
    formatTitle: ({ params }) => {
      const envId = strParam(params.environmentId);
      return (
        formatRouteTitle(
          strParam(params.teamSlugOrId),
          envId ? `Environment ${envId}` : "Environment"
        ) || "Environment Details"
      );
    },
  },
  "/_layout/$teamSlugOrId/environments/new": {
    title: "New Environment",
    formatTitle: ({ params }) =>
      withTeam(params, "New Environment") || "New Environment",
  },
  "/_layout/$teamSlugOrId/environments/new-version": {
    title: "New Environment Version",
    formatTitle: ({ params }) =>
      withTeam(params, "New Environment Version") ||
      "New Environment Version",
  },
  "/_layout/$teamSlugOrId/logs": {
    title: "Run Logs",
    formatTitle: ({ params }) => withTeam(params, "Run Logs") || "Run Logs",
  },
  "/_layout/$teamSlugOrId/prs": {
    title: "Pull Requests",
    formatTitle: ({ params }) =>
      withTeam(params, "Pull Requests") || "Pull Requests",
  },
  "/_layout/$teamSlugOrId/prs/$owner/$repo/$number": {
    title: "Pull Request",
    formatTitle: ({ params }) =>
      formatRouteTitle(
        strParam(params.teamSlugOrId),
        strParam(params.owner),
        strParam(params.repo),
        `#${strParam(params.number) ?? ""}`
      ) || "Pull Request",
  },
  "/_layout/$teamSlugOrId/prs-only/$owner/$repo/$number": {
    title: "Pull Request (Diff Only)",
    formatTitle: ({ params }) =>
      formatRouteTitle(
        strParam(params.teamSlugOrId),
        strParam(params.owner),
        strParam(params.repo),
        `#${strParam(params.number) ?? ""}`,
        "Diff"
      ) || "Pull Request (Diff Only)",
  },
  "/_layout/$teamSlugOrId/settings": {
    title: "Team Settings",
    formatTitle: ({ params }) =>
      withTeam(params, "Settings") || "Team Settings",
  },
  "/_layout/$teamSlugOrId/workspaces": {
    title: "Workspaces",
    formatTitle: ({ params }) =>
      withTeam(params, "Workspaces") || "Workspaces",
  },
  "/_layout/$teamSlugOrId/task/$taskId": {
    title: "Task",
    formatTitle: ({ params }) =>
      withTaskContext(params, "Workspace") || "Task",
  },
  "/_layout/$teamSlugOrId/task/$taskId/": {
    title: "Task Overview",
    formatTitle: ({ params }) =>
      withTaskContext(params, "Overview") || "Task Overview",
  },
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/": {
    title: "Run Overview",
    formatTitle: ({ params }) =>
      withRunContext(params, "Overview") || "Run Overview",
  },
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/browser": {
    title: "Run Browser",
    formatTitle: ({ params }) =>
      withRunContext(params, "Browser") || "Run Browser",
  },
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/diff": {
    title: "Run Diff",
    formatTitle: ({ params }) =>
      withRunContext(params, "Diff") || "Run Diff",
  },
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/pr": {
    title: "Run Pull Request",
    formatTitle: ({ params }) =>
      withRunContext(params, "Pull Request") || "Run Pull Request",
  },
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/preview/$previewId": {
    title: "Preview",
    formatTitle: ({ params }) => {
      const previewId = strParam(params.previewId);
      return (
        formatRouteTitle(
          withRunContext(params),
          previewId ? `Preview ${previewId}` : "Preview"
        ) || "Preview"
      );
    },
  },
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/terminals": {
    title: "Terminals",
    formatTitle: ({ params }) =>
      withRunContext(params, "Terminals") || "Terminals",
  },
  "/_layout/$teamSlugOrId/task/$taskId/run/$runId/vscode": {
    title: "VS Code",
    formatTitle: ({ params }) =>
      withRunContext(params, "VS Code") || "VS Code",
  },
  "/debug-icon": {
    title: "Icon Debugger",
  },
  "/debug-monaco": {
    title: "Monaco Debugger",
  },
  "/debug-webcontents": {
    title: "WebContents Debugger",
  },
  "/electron-error": {
    title: "Electron Error",
  },
  "/electron-web-contents": {
    title: "Embedded WebContents",
  },
  "/handler/$": {
    title: "Protocol Handler",
  },
  "/monaco-single-buffer": {
    title: "Monaco Single Buffer",
  },
};

export function getRouteTitleDescriptor(fullPath: string) {
  return ROUTE_TITLES[fullPath];
}
