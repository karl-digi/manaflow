import { WebShell } from "@/components/web-ui/WebShell";
import {
  ConversationsSidebar,
  type ConversationScope,
} from "@/components/web-ui/ConversationsSidebar";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";
import { cachedGetUser } from "@/lib/cachedGetUser";
import { setLastTeamSlugOrId } from "@/lib/lastTeam";
import { stackClientApp } from "@/lib/stack";
import { api } from "@cmux/convex/api";
import {
  createFileRoute,
  Outlet,
  redirect,
  useMatch,
} from "@tanstack/react-router";
import { useAction, usePaginatedQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

const searchSchema = z.object({
  scope: z.enum(["mine", "all"]).optional(),
});

type SearchParams = z.infer<typeof searchSchema>;

const DEFAULT_SCOPE: ConversationScope = "mine";
const PAGE_SIZE = 30;

export const Route = createFileRoute("/_layout/t/$teamSlugOrId")({
  component: ConversationsLayout,
  validateSearch: (search: Record<string, unknown>): SearchParams =>
    searchSchema.parse(search),
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
    const teamMemberships = await convexQueryClient.convexClient.query(
      api.teams.listTeamMemberships
    );
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
});

function ConversationsLayout() {
  const { teamSlugOrId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const scope = search.scope ?? DEFAULT_SCOPE;
  const { results, status, loadMore } = usePaginatedQuery(
    api.conversations.listPagedWithLatest,
    { teamSlugOrId, scope },
    { initialNumItems: PAGE_SIZE }
  );

  const match = useMatch({
    from: "/_layout/t/$teamSlugOrId/$conversationId",
    shouldThrow: false,
  });
  const activeConversationId = match?.params.conversationId;

  const startConversation = useAction(api.acp.startConversation);
  const [isCreating, setIsCreating] = useState(false);

  const entries = useMemo(() => results ?? [], [results]);

  useEffect(() => {
    setLastTeamSlugOrId(teamSlugOrId);
  }, [teamSlugOrId]);

  const handleScopeChange = (next: ConversationScope) => {
    if (next === scope) return;
    void navigate({
      search: { scope: next },
    });
  };

  const handleNewConversation = async () => {
    setIsCreating(true);
    try {
      const result = await startConversation({
        teamSlugOrId,
        providerId: "claude",
        cwd: "/root",
      });
      await navigate({
        to: "/t/$teamSlugOrId/$conversationId",
        params: {
          teamSlugOrId,
          conversationId: result.conversationId,
        },
      });
    } catch (error) {
      console.error("Failed to start conversation", error);
      toast.error("Failed to start conversation");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <WebShell
      sidebar={
        <ConversationsSidebar
          teamSlugOrId={teamSlugOrId}
          scope={scope}
          onScopeChange={handleScopeChange}
          entries={entries}
          status={status}
          onLoadMore={loadMore}
          activeConversationId={activeConversationId}
          onNewConversation={handleNewConversation}
          isCreating={isCreating}
        />
      }
    >
      <Outlet />
    </WebShell>
  );
}
