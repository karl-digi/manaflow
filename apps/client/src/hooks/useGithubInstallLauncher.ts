import { env } from "@/client-env";
import { isElectron } from "@/lib/electron";
import { api } from "@cmux/convex/api";
import { useMutation } from "convex/react";
import { useCallback } from "react";

interface GithubInstallLauncherOptions {
  teamSlugOrId: string;
  onAfterClose?: () => void;
  windowName?: string;
  width?: number;
  height?: number;
}

export function useGithubInstallLauncher({
  teamSlugOrId,
  onAfterClose,
  windowName = "github-install",
  width = 980,
  height = 780,
}: GithubInstallLauncherOptions) {
  const mintState = useMutation(api.github_app.mintInstallState);

  const watchPopupClosed = useCallback(
    (win: Window | null) => {
      if (!win || !onAfterClose) {
        return;
      }

      const timer = window.setInterval(() => {
        try {
          if (win.closed) {
            window.clearInterval(timer);
            onAfterClose();
          }
        } catch (_error) {
          window.clearInterval(timer);
        }
      }, 600);
    },
    [onAfterClose],
  );

  const openCenteredPopup = useCallback(
    (url: string) => {
      if (isElectron) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }

      const popupWidth = Math.floor(width);
      const popupHeight = Math.floor(height);
      const dualScreenLeft = window.screenLeft ?? window.screenX ?? 0;
      const dualScreenTop = window.screenTop ?? window.screenY ?? 0;
      const outerWidth = window.outerWidth || window.innerWidth || popupWidth;
      const outerHeight = window.outerHeight || window.innerHeight || popupHeight;
      const left = Math.max(0, dualScreenLeft + (outerWidth - popupWidth) / 2);
      const top = Math.max(0, dualScreenTop + (outerHeight - popupHeight) / 2);
      const features = [
        `width=${popupWidth}`,
        `height=${popupHeight}`,
        `left=${Math.floor(left)}`,
        `top=${Math.floor(top)}`,
        "resizable=yes",
        "scrollbars=yes",
        "toolbar=no",
        "location=no",
        "status=no",
        "menubar=no",
      ].join(",");

      const win = window.open("about:blank", windowName, features);
      if (!win) {
        window.open(url, "_blank");
        return;
      }

      try {
        (win as Window & { opener: null | Window }).opener = null;
      } catch (_error) {
        /* noop */
      }

      try {
        win.location.href = url;
      } catch (_error) {
        window.open(url, "_blank");
      }

      win.focus?.();
      watchPopupClosed(win);
    },
    [height, watchPopupClosed, width, windowName],
  );

  const launchGithubInstall = useCallback(async () => {
    if (!env.NEXT_PUBLIC_GITHUB_APP_SLUG) {
      console.warn(
        "[useGithubInstallLauncher] NEXT_PUBLIC_GITHUB_APP_SLUG is not configured",
      );
      return;
    }

    try {
      const slug = env.NEXT_PUBLIC_GITHUB_APP_SLUG;
      const baseUrl = `https://github.com/apps/${slug}/installations/new`;
      const { state } = await mintState({ teamSlugOrId });
      const sep = baseUrl.includes("?") ? "&" : "?";
      const url = `${baseUrl}${sep}state=${encodeURIComponent(state)}`;
      openCenteredPopup(url);
    } catch (error) {
      console.error(
        "[useGithubInstallLauncher] Failed to launch GitHub install",
        error,
      );
    }
  }, [mintState, openCenteredPopup, teamSlugOrId]);

  return { launchGithubInstall };
}
