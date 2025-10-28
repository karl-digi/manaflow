"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useConvexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { Loader2, ShieldAlert, ExternalLink, RefreshCw } from "lucide-react";

import { api } from "@cmux/convex/api";

import { ErrorPanel } from "./review-diff-content";

type PrivateRepoGateProps = {
  teamSlugOrId: string;
  repoFullName: string;
  fallback: {
    title: string;
    message: string;
    documentationUrl?: string;
  };
};

export function PrivateRepoInstallGate({
  teamSlugOrId,
  repoFullName,
  fallback,
}: PrivateRepoGateProps) {
  const router = useRouter();
  const repoDoc = useConvexQuery(api.github.getRepoByFullName, {
    teamSlugOrId,
    fullName: repoFullName,
  });
  const mintInstallState = useMutation(api.github_app.mintInstallState);
  const closeWatcherRef = useRef<number | null>(null);
  const [isLaunchingInstall, setIsLaunchingInstall] = useState(false);
  const installSlug =
    process.env.NEXT_PUBLIC_GITHUB_APP_SLUG?.trim() || null;
  const installBaseUrl = useMemo(() => {
    if (!installSlug) {
      return null;
    }

    return `https://github.com/apps/${installSlug}/installations/new`;
  }, [installSlug]);

  useEffect(() => {
    return () => {
      if (closeWatcherRef.current !== null) {
        window.clearInterval(closeWatcherRef.current);
        closeWatcherRef.current = null;
      }
    };
  }, []);

  const handleInstallComplete = useCallback(() => {
    setIsLaunchingInstall(false);
    router.refresh();
  }, [router]);

  const watchPopupClosed = useCallback(
    (win: Window | null) => {
      if (!win) {
        return;
      }
      if (closeWatcherRef.current !== null) {
        window.clearInterval(closeWatcherRef.current);
        closeWatcherRef.current = null;
      }

      closeWatcherRef.current = window.setInterval(() => {
        try {
          if (win.closed) {
            if (closeWatcherRef.current !== null) {
              window.clearInterval(closeWatcherRef.current);
              closeWatcherRef.current = null;
            }
            handleInstallComplete();
          }
        } catch {
          // Cross-origin access can fail while the window is open.
        }
      }, 750);
    },
    [handleInstallComplete],
  );

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (
        typeof event.data === "object" &&
        event.data !== null &&
        (event.data as { type?: string }).type ===
          "cmux/github-install-complete"
      ) {
        handleInstallComplete();
      }
    };

    window.addEventListener("message", handler);

    return () => {
      window.removeEventListener("message", handler);
    };
  }, [handleInstallComplete]);

  const openCenteredPopup = useCallback((url: string) => {
    const width = 980;
    const height = 780;
    const dualScreenLeft = window.screenLeft ?? window.screenX ?? 0;
    const dualScreenTop = window.screenTop ?? window.screenY ?? 0;
    const outerWidth = window.outerWidth || window.innerWidth || width;
    const outerHeight = window.outerHeight || window.innerHeight || height;
    const left = Math.max(0, dualScreenLeft + (outerWidth - width) / 2);
    const top = Math.max(0, dualScreenTop + (outerHeight - height) / 2);
    const features = [
      `width=${Math.floor(width)}`,
      `height=${Math.floor(height)}`,
      `left=${Math.floor(left)}`,
      `top=${Math.floor(top)}`,
      "resizable=yes",
      "scrollbars=yes",
      "toolbar=no",
      "location=no",
      "status=no",
      "menubar=no",
    ].join(",");

    const win = window.open(
      url,
      "cmux-github-install",
      features,
    );

    return win;
  }, []);

  const handleContinue = useCallback(async () => {
    if (!installBaseUrl) {
      console.error(
        "[private-repo-gate] Missing NEXT_PUBLIC_GITHUB_APP_SLUG; cannot launch install flow",
      );
      alert(
        "GitHub installation is not configured for this environment. Please contact the cmux team.",
      );
      return;
    }

    setIsLaunchingInstall(true);
    try {
      const { state } = await mintInstallState({ teamSlugOrId });
      const url = `${installBaseUrl}${
        installBaseUrl.includes("?") ? "&" : "?"
      }state=${encodeURIComponent(state)}`;
      const popup = openCenteredPopup(url);
      watchPopupClosed(popup);
    } catch (error) {
      console.error("Failed to start GitHub installation", error);
      alert(
        "We couldn't open the GitHub installation flow. Please try again.",
      );
      setIsLaunchingInstall(false);
    }
  }, [
    installBaseUrl,
    mintInstallState,
    openCenteredPopup,
    teamSlugOrId,
    watchPopupClosed,
  ]);

  const handleManualRefresh = useCallback(() => {
    router.refresh();
  }, [router]);

  if (repoDoc === undefined) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="h-4 w-48 animate-pulse rounded bg-neutral-200" />
        <div className="mt-4 space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-neutral-200" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-neutral-200" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-200" />
        </div>
      </div>
    );
  }

  const isPrivateRepo =
    repoDoc === null || repoDoc.visibility === "private";

  if (!isPrivateRepo) {
    return (
      <ErrorPanel
        title={fallback.title}
        message={fallback.message}
        documentationUrl={fallback.documentationUrl}
      />
    );
  }

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-6 text-sm text-sky-900 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-sky-100 p-2 text-sky-700">
          <ShieldAlert className="h-5 w-5" aria-hidden />
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <h2 className="text-base font-semibold text-sky-900">
              Grant cmux access to this private repository
            </h2>
            <p className="mt-1 leading-relaxed text-sky-900/90">
              <span className="font-medium">{repoFullName}</span> is a
              private GitHub repository. Connect GitHub and install the
              cmux agent so we can fetch pull requests and run automated
              reviews.
            </p>
          </div>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              A GitHub window opens so you can confirm the installation for
              <span className="mx-1 rounded bg-sky-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-sky-800">
                {repoFullName}
              </span>
              .
            </li>
            <li>Follow the prompts to add the cmux agent to that repo.</li>
            <li>
              When you return to this tab, we refresh the page and continue
              the pull request review.
            </li>
          </ol>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleContinue}
              disabled={!installBaseUrl || isLaunchingInstall}
              className="inline-flex items-center gap-2 rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-sky-300"
            >
              {isLaunchingInstall ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              Continue
            </button>
            <button
              type="button"
              onClick={handleManualRefresh}
              className="inline-flex items-center gap-2 rounded-md border border-sky-200 bg-white px-3 py-2 text-sm font-medium text-sky-900 transition hover:border-sky-300 hover:bg-sky-100"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Already installed? Refresh
            </button>
            <a
              className="inline-flex items-center gap-1 text-sm font-medium text-sky-800 underline-offset-4 hover:underline"
              href="https://github.com/manaflow-ai/cmux"
              target="_blank"
              rel="noreferrer"
            >
              Need help?
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>
          {installBaseUrl ? (
            <p className="text-xs text-sky-800/80">
              We will refresh this view automatically once the GitHub window
              closes.
            </p>
          ) : (
            <p className="text-xs font-medium text-rose-700">
              GitHub App configuration is missing. Please contact support.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
