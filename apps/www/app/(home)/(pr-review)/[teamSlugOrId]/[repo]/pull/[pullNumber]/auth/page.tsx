import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isRepoPublic } from "@/lib/github/check-repo-visibility";
import { stackServerApp } from "@/lib/utils/stack";
import { PrivateRepoPrompt } from "../../../_components/private-repo-prompt";
import { AnonymousToSignInPrompt } from "../../../_components/anonymous-to-signin-prompt";
import { env } from "@/lib/utils/www-env";

type PageParams = {
  teamSlugOrId: string;
  repo: string;
  pullNumber: string;
};

type PageProps = {
  params: Promise<PageParams>;
};

function parsePullNumber(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }

  const numericValue = Number.parseInt(raw, 10);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return numericValue;
}

export default async function AuthPage({ params }: PageProps) {
  const resolvedParams = await params;
  const {
    teamSlugOrId: githubOwner,
    repo,
    pullNumber: pullNumberRaw,
  } = resolvedParams;

  const pullNumber = parsePullNumber(pullNumberRaw);
  if (pullNumber === null) {
    redirect(`/${githubOwner}/${repo}/pull/${pullNumberRaw}`);
  }

  // Check if repository is public
  const repoIsPublic = await isRepoPublic(githubOwner, repo);

  // Always use return-null to handle redirects manually (so we can preserve return URL)
  const user = await stackServerApp.getUser({
    or: "return-null"
  });

  // For private repos without authenticated user, show sign-in prompt
  if (!repoIsPublic && (!user || !user.primaryEmail)) {
    console.log("[AuthPage] Private repo requires authentication, showing sign-in prompt");
    return (
      <AnonymousToSignInPrompt
        returnUrl={`/${githubOwner}/${repo}/pull/${pullNumber}`}
      />
    );
  }

  // If user exists and has email, they're authenticated - redirect back to PR page
  if (user && user.primaryEmail) {
    console.log("[AuthPage] User already authenticated, redirecting to PR page");
    redirect(`/${githubOwner}/${repo}/pull/${pullNumber}`);
  }

  // For public repos with anonymous users or no user, automatically create anonymous user
  if (repoIsPublic) {
    console.log("[AuthPage] Public repo detected, automatically creating anonymous user");

    try {
      // Create anonymous user using Stack Auth API
      const response = await fetch("https://api.stack-auth.com/api/v1/auth/anonymous/sign-up", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stack-project-id": env.NEXT_PUBLIC_STACK_PROJECT_ID,
          "x-stack-publishable-client-key": env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
          "x-stack-secret-server-key": env.STACK_SECRET_SERVER_KEY,
          "x-stack-access-type": "server",
        },
        body: JSON.stringify({}),
      });

      if (response.ok) {
        const data = await response.json();

        // Set Stack Auth cookies
        if (data.access_token && data.refresh_token) {
          const projectId = env.NEXT_PUBLIC_STACK_PROJECT_ID;
          const cookieStore = await cookies();

          const cookieOptions = {
            path: "/",
            maxAge: 31536000, // 1 year
            sameSite: "lax" as const,
            secure: process.env.NODE_ENV === "production",
            httpOnly: false,
          };

          cookieStore.set("stack-access", data.access_token, cookieOptions);
          cookieStore.set(`stack-refresh-${projectId}`, data.refresh_token, cookieOptions);
          cookieStore.set("stack-is-https", "true", cookieOptions);

          console.log("[AuthPage] Anonymous user created successfully, redirecting to PR page");
          redirect(`/${githubOwner}/${repo}/pull/${pullNumber}`);
        }
      }

      console.error("[AuthPage] Failed to create anonymous user, status:", response.status);
    } catch (error) {
      console.error("[AuthPage] Error creating anonymous user:", error);
    }

    // If we reach here, anonymous user creation failed - still redirect to PR page
    // The main PR page will handle showing appropriate error messages
    redirect(`/${githubOwner}/${repo}/pull/${pullNumber}`);
  }

  // Fallback: show GitHub app install prompt (shouldn't reach here normally)
  return (
    <PrivateRepoPrompt
      teamSlugOrId={githubOwner}
      repo={repo}
      githubOwner={githubOwner}
      githubAppSlug={env.NEXT_PUBLIC_GITHUB_APP_SLUG}
    />
  );
}
