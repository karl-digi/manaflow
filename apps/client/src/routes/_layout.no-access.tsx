import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isElectron } from "@/lib/electron";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Lock, ExternalLink } from "lucide-react";
import type React from "react";
import z from "zod";

const CMUX_BASE_URL = "https://cmux.sh";

export const Route = createFileRoute("/_layout/no-access")({
  validateSearch: z.object({
    team: z.string().optional(),
    reason: z.enum(["not-member", "not-authenticated"]).optional(),
  }),
  component: NoAccessPage,
});

function NoAccessPage() {
  const { team, reason } = Route.useSearch();

  const title =
    reason === "not-authenticated"
      ? "Sign in required"
      : "Team membership required";

  const description =
    reason === "not-authenticated"
      ? "You need to sign in to access this workspace."
      : team
        ? `You're not a member of the team "${team}".`
        : "You're not a member of the team that owns this workspace.";

  return (
    <div className="min-h-dvh w-full bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center p-6">
      {isElectron ? (
        <div
          className="fixed top-0 left-0 right-0 h-[24px]"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
      ) : null}
      <div className="mx-auto w-full max-w-lg">
        <Card className="border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/70 backdrop-blur">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <Lock className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </div>
            <CardTitle className="text-neutral-900 dark:text-neutral-50">
              {title}
            </CardTitle>
            <CardDescription className="text-neutral-600 dark:text-neutral-400">
              {description}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 p-4">
              <h3 className="font-medium text-neutral-900 dark:text-neutral-100 mb-2">
                What can I access?
              </h3>
              <ul className="text-sm text-neutral-600 dark:text-neutral-400 space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-green-600 dark:text-green-400 mt-0.5">✓</span>
                  <span>
                    <strong>Diff Heatmap</strong> — Available to anyone with
                    access to the GitHub repository
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-amber-600 dark:text-amber-400 mt-0.5">🔐</span>
                  <span>
                    <strong>Workspace & Dev Browser</strong> — Requires cmux
                    team membership
                  </span>
                </li>
              </ul>
            </div>

            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
              <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                Want these features for your own repos?
              </h3>
              <p className="text-sm text-blue-700 dark:text-blue-300 mb-3">
                Set up cmux on your repositories to get automated preview
                screenshots, live workspaces, and browser previews on every PR.
              </p>
              <a
                href={`${CMUX_BASE_URL}?utm_source=app&utm_medium=no_access_page&utm_campaign=setup_cta`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                Learn more about cmux
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              {reason === "not-authenticated" ? (
                <Button asChild>
                  <Link
                    to="/sign-in"
                    search={{ after_auth_return_to: window.location.pathname }}
                  >
                    Sign in
                  </Link>
                </Button>
              ) : (
                <Button asChild>
                  <Link to="/team-picker">Go to your teams</Link>
                </Button>
              )}
              <Button variant="ghost" asChild>
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Return to GitHub
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
