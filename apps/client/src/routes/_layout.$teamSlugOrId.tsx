import { CmuxComments } from "@/components/cmux-comments";
import { CommandBar } from "@/components/CommandBar";
import { Sidebar } from "@/components/Sidebar";
import { SidebarContext } from "@/contexts/sidebar/SidebarContext";
import {
  SettingsSidebar,
  type SettingsSection,
} from "@/components/settings/SettingsSidebar";
import { SIDEBAR_PRS_DEFAULT_LIMIT } from "@/components/sidebar/const";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";
import { ExpandTasksProvider } from "@/contexts/expand-tasks/ExpandTasksProvider";
import { cachedGetUser } from "@/lib/cachedGetUser";
import { isElectron } from "@/lib/electron";
import { setLastTeamSlugOrId } from "@/lib/lastTeam";
import { stackClientApp } from "@/lib/stack";
import { api } from "@cmux/convex/api";
import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { env } from "@/client-env";

export const Route = createFileRoute("/_layout/$teamSlugOrId")({
  component: LayoutComponentWrapper,
  beforeLoad: async ({ params, location }) => {
    const user = await cachedGetUser(stackClientApp);
    if (!user) {
      throw redirect({
        to: "/sign-in",
        search: {
          after_auth_return_to: location.pathname,
        },
      });
    }
    const { teamSlugOrId } = params;
    let teamMemberships;
    try {
      teamMemberships = await convexQueryClient.convexClient.query(
        api.teams.listTeamMemberships
      );
    } catch (error) {
      // Auth token may be invalid/expired - redirect to sign-in
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Not authenticated")) {
        console.error("[beforeLoad] Convex auth failed, redirecting to sign-in:", message);
        throw redirect({
          to: "/sign-in",
          search: {
            after_auth_return_to: location.pathname,
          },
        });
      }
      throw error;
    }
    const teamMembership = teamMemberships.find((membership) => {
      const team = membership.team;
      const membershipTeamId = team?.teamId ?? membership.teamId;
      const membershipSlug = team?.slug;
      return (
        membershipSlug === teamSlugOrId || membershipTeamId === teamSlugOrId
      );
    });
    if (!teamMembership) {
      throw redirect({ to: "/team-picker" });
    }
  },
  loader: async ({ params }) => {
    // Prewarm PR query (paginated task query doesn't support prewarm)
    convexQueryClient.convexClient.prewarmQuery({
      query: api.github_prs.listPullRequests,
      args: {
        teamSlugOrId: params.teamSlugOrId,
        state: "open",
        limit: SIDEBAR_PRS_DEFAULT_LIMIT,
      },
    });
  },
});

function LayoutComponent() {
  const { teamSlugOrId } = Route.useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [isSidebarHidden, setIsSidebarHidden] = useState(
    () => localStorage.getItem("sidebarHidden") === "true"
  );
  // In web mode, exclude local workspaces
  const excludeLocalWorkspaces = env.NEXT_PUBLIC_WEB_MODE || undefined;
  // Fetch all tasks - now efficient with by_team_user_active index
  // Sorted by lastActivityAt desc
  const tasks = useQuery(
    api.tasks.getWithNotificationOrder,
    { teamSlugOrId, excludeLocalWorkspaces }
  );
  const settingsPath = `/${teamSlugOrId}/settings`;
  const isSettingsRoute =
    location.pathname === settingsPath || location.pathname === `${settingsPath}/`;
  const sectionFromSearch = (location.search as { section?: unknown })?.section;
  const activeSettingsSection: SettingsSection =
    sectionFromSearch === "ai-providers" ? "ai-providers" :
    sectionFromSearch === "git" ? "git" :
    sectionFromSearch === "worktrees" ? "worktrees" :
    sectionFromSearch === "archived" ? "archived" : "general";

  useEffect(() => {
    localStorage.setItem("sidebarHidden", String(isSidebarHidden));
  }, [isSidebarHidden]);

  useEffect(() => {
    setIsSidebarHidden(localStorage.getItem("sidebarHidden") === "true");
  }, [isSettingsRoute]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "sidebarHidden" && event.newValue !== null) {
        setIsSidebarHidden(event.newValue === "true");
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (isElectron && window.cmux?.on) {
      const off = window.cmux.on("shortcut:sidebar-toggle", () => {
        setIsSidebarHidden((prev) => !prev);
      });
      return () => {
        if (typeof off === "function") off();
      };
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.ctrlKey &&
        event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        (event.code === "KeyS" || event.key.toLowerCase() === "s")
      ) {
        event.preventDefault();
        event.stopPropagation();
        setIsSidebarHidden((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const handleSettingsSectionChange = useCallback(
    (section: SettingsSection) => {
      if (isSettingsRoute && section === activeSettingsSection) return;
      void navigate({
        to: "/$teamSlugOrId/settings",
        params: { teamSlugOrId },
        search: {
          section: section === "general" ? undefined : section,
        },
        replace: true,
      });
    },
    [activeSettingsSection, isSettingsRoute, navigate, teamSlugOrId]
  );

  const sidebarContextValue = useMemo(
    () => ({
      isHidden: isSidebarHidden,
      setIsHidden: setIsSidebarHidden,
      toggle: () => setIsSidebarHidden((prev) => !prev),
    }),
    [isSidebarHidden]
  );

  return (
    <ExpandTasksProvider>
      <SidebarContext.Provider value={sidebarContextValue}>
        <CommandBar teamSlugOrId={teamSlugOrId} />

        <div className="flex flex-row grow min-h-0 h-dvh bg-white dark:bg-black overflow-x-auto snap-x snap-mandatory md:overflow-x-visible md:snap-none">
          {isSettingsRoute ? (
            <SettingsSidebar
              teamSlugOrId={teamSlugOrId}
              activeSection={activeSettingsSection}
              onSectionChange={handleSettingsSectionChange}
            />
          ) : isSidebarHidden ? null : (
            <Sidebar
              tasks={tasks}
              teamSlugOrId={teamSlugOrId}
              onToggleHidden={() => setIsSidebarHidden(true)}
            />
          )}

          <div className="min-w-full md:min-w-0 grow snap-start snap-always flex flex-col">
            <Suspense fallback={<div>Loading...</div>}>
              <Outlet />
            </Suspense>
          </div>
        </div>

        <button
          onClick={() => {
            const msg = window.prompt("Enter debug note");
            if (msg) {
              // Prefix allows us to easily grep in the console.
              console.log(`[USER NOTE] ${msg}`);
            }
          }}
          className="hidden"
          style={{
            position: "fixed",
            bottom: "16px",
            right: "16px",
            zIndex: "var(--z-overlay)",
            background: "#ffbf00",
            color: "#000",
            border: "none",
            borderRadius: "4px",
            padding: "8px 12px",
            cursor: "default",
            fontSize: "12px",
            fontWeight: 600,
            boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
          }}
        >
          Add Debug Note
        </button>
      </SidebarContext.Provider>
    </ExpandTasksProvider>
  );
}

// ConvexClientProvider is already applied in the top-level `/_layout` route.
// Avoid nesting providers here to prevent auth/loading thrash.
function LayoutComponentWrapper() {
  const { teamSlugOrId } = Route.useParams();
  useEffect(() => {
    setLastTeamSlugOrId(teamSlugOrId);
  }, [teamSlugOrId]);
  return (
    <>
      <LayoutComponent />
      <CmuxComments teamSlugOrId={teamSlugOrId} />
    </>
  );
}
