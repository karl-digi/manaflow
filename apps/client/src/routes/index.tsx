import { createFileRoute, redirect } from "@tanstack/react-router";
import { getLastTeamSlugOrId } from "@/lib/lastTeam";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (typeof window !== "undefined") {
      const last = getLastTeamSlugOrId();
      if (last && last.trim().length > 0) {
        throw redirect({
          to: "/$teamSlugOrId/dashboard",
          params: { teamSlugOrId: last },
        });
      }
    }
    throw redirect({ to: "/team-picker" });
  },
  component: () => null,
});
