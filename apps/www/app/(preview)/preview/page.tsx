import { stackServerApp } from "@/lib/utils/stack";
import { getConvex } from "@/lib/utils/get-convex";
import { api } from "@cmux/convex/api";
import { PreviewDashboard } from "@/components/preview/preview-dashboard";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type StackTeam = Awaited<ReturnType<typeof stackServerApp.listTeams>>[number];

function getTeamSlugOrId(team: StackTeam): string {
  const candidate = team as unknown as {
    slug?: string | null;
    teamId?: string;
    id?: string;
  };
  return candidate.slug ?? candidate.teamId ?? candidate.id ?? "";
}

function serializeProviderConnections(
  connections: Array<{
    installationId: number;
    accountLogin: string | null | undefined;
    accountType: string | null | undefined;
    type: string | null | undefined;
    isActive: boolean;
  }>
) {
  return connections.map((conn) => ({
    installationId: conn.installationId,
    accountLogin: conn.accountLogin ?? null,
    accountType: conn.accountType ?? null,
    isActive: conn.isActive,
  }));
}

export default async function PreviewLandingPage({ searchParams }: PageProps) {
  const user = await stackServerApp.getUser();
  const resolvedSearch = await searchParams;

  if (!user) {
    return (
      <div className="relative isolate min-h-dvh bg-[#05050a] text-white">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(4,120,255,0.3),_transparent_45%)]" />

        <PreviewDashboard
          selectedTeamSlugOrId=""
          hasGithubAppInstallation={false}
          providerConnections={[]}
          isAuthenticated={false}
        />
      </div>
    );
  }

  const [{ accessToken }, teams] = await Promise.all([
    user.getAuthJson(),
    user.listTeams(),
  ]);

  if (!accessToken) {
    throw new Error("Missing Stack access token");
  }

  const searchTeam = (() => {
    if (!resolvedSearch) {
      return null;
    }
    const value = resolvedSearch.team;
    if (Array.isArray(value)) {
      return value[0] ?? null;
    }
    return value ?? null;
  })();

  const selectedTeam =
    teams.find((team) => getTeamSlugOrId(team) === searchTeam) ?? teams[0];
  const selectedTeamSlugOrId = selectedTeam ? getTeamSlugOrId(selectedTeam) : "";

  const convex = getConvex({ accessToken });
  const providerConnections = selectedTeamSlugOrId
    ? await convex.query(api.github.listProviderConnections, {
        teamSlugOrId: selectedTeamSlugOrId,
      })
    : [];

  const hasGithubAppInstallation = providerConnections.some(
    (connection) => connection.isActive,
  );

  return (
    <div className="relative isolate min-h-dvh bg-[#05050a] text-white">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(4,120,255,0.3),_transparent_45%)]" />

      <PreviewDashboard
        selectedTeamSlugOrId={selectedTeamSlugOrId}
        hasGithubAppInstallation={hasGithubAppInstallation}
        providerConnections={serializeProviderConnections(providerConnections)}
        isAuthenticated={true}
      />
    </div>
  );
}
