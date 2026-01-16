import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { stackServerApp } from "@/lib/utils/stack";
import {
  getTeamDisplayName,
  getTeamSlugOrId,
  getTeamSlug,
  type StackTeam,
} from "@/lib/team-utils";
import { PreviewTestDashboard } from "@/components/preview/preview-test-dashboard";

export const metadata: Metadata = {
  title: "Preview.new Testing",
  description: "Test preview.new jobs without GitHub integration",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type TeamOption = {
  slugOrId: string;
  slug: string | null;
  displayName: string;
};

export default async function PreviewTestPage({ searchParams }: PageProps) {
  const user = await stackServerApp.getUser();
  const resolvedSearch = await searchParams;

  if (!user) {
    const signInUrl = `/handler/sign-in?after_auth_return_to=${encodeURIComponent("/preview/test")}`;
    return redirect(signInUrl);
  }

  const [auth, teamsResult] = await Promise.all([
    user.getAuthJson(),
    user.listTeams(),
  ]);
  const teams: StackTeam[] = teamsResult;
  let accessToken = auth.accessToken;

  // If accessToken is null, try creating a fresh session to get valid tokens
  // This can happen right after OAuth sign-in when tokens aren't fully propagated
  if (!accessToken) {
    console.log("[PreviewTestPage] accessToken is null, attempting to create fresh session");
    try {
      const freshSession = await user.createSession({ expiresInMillis: 24 * 60 * 60 * 1000 });
      const freshTokens = await freshSession.getTokens();
      if (freshTokens.accessToken) {
        accessToken = freshTokens.accessToken;
        console.log("[PreviewTestPage] Got fresh access token from new session");
      }
    } catch (error) {
      console.error("[PreviewTestPage] Failed to create fresh session", error);
    }
  }

  // If we still don't have an access token, redirect to sign-in
  if (!accessToken) {
    console.error("[PreviewTestPage] No access token available after retry, redirecting to sign-in");
    const signInUrl = `/handler/sign-in?after_auth_return_to=${encodeURIComponent("/preview/test")}`;
    return redirect(signInUrl);
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
  const teamOptions: TeamOption[] = teams.map((team) => ({
    slugOrId: getTeamSlugOrId(team),
    slug: getTeamSlug(team),
    displayName: getTeamDisplayName(team),
  }));

  return (
    <div className="relative isolate min-h-dvh bg-[#05050a] text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PreviewTestDashboard
          selectedTeamSlugOrId={selectedTeamSlugOrId}
          teamOptions={teamOptions}
        />
      </div>
    </div>
  );
}
